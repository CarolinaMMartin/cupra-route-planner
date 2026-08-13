// ============================================================
// Ranking de cartera y saneamiento de candidatos.
// Se decide PRIMERO qué cuentas merecen la visita (a nivel vendedor,
// sin filtro geográfico) y RECIÉN DESPUÉS dónde se arma la ruta.
// ============================================================

import { type AnchorPoint, calcularDistanciaKm } from "./geo-hotspot.ts";

/** Cuando el cliente tiene una sola compra no hay cadencia propia: se usa la del canal. */
export const CADENCIA_FALLBACK_DIAS = 45;

export interface CarteraClientLike {
  monto_total_historico?: number | null;
  ticket_promedio?: number | null;
  cantidad_ordenes?: number | null;
  dias_desde_ultima_compra?: number | null;
  cadencia_dias?: number | null;
  precio_promedio_caja?: number | null;
  monto_notas_credito?: number | null;
  fecha_ultima_nc?: string | null;
}

/** Cadencia propia del cliente, con piso y fallback al canal. */
export function cadenciaCliente(c: CarteraClientLike): number {
  const propia = Number(c.cadencia_dias);
  if (Number.isFinite(propia) && propia > 0) return Math.max(7, propia);
  return CADENCIA_FALLBACK_DIAS;
}

/** Cuán vencido está el cliente contra su propio ritmo de compra (0 = al día). */
export function urgenciaCliente(c: CarteraClientLike): number {
  const dias = Number(c.dias_desde_ultima_compra);
  if (!Number.isFinite(dias) || dias <= 0) return 0;
  return Math.min(6, dias / cadenciaCliente(c));
}

/** Margen realizado: precio por caja del cliente contra el promedio del canal. */
export function margenRealizado(c: CarteraClientLike, precioCajaCanal: number): number {
  const propio = Number(c.precio_promedio_caja);
  if (!Number.isFinite(propio) || propio <= 0 || !Number.isFinite(precioCajaCanal) || precioCajaCanal <= 0) {
    return 1;
  }
  return Math.min(1.6, Math.max(0.6, propio / precioCajaCanal));
}

/** Parte de la prioridad que NO depende de la ruta (sirve para rankear la cartera entera). */
export function prioridadBase(c: CarteraClientLike, precioCajaCanal = 0): number {
  const valorRaw = Number(c.monto_total_historico);
  const valor = Number.isFinite(valorRaw) && valorRaw > 0 ? valorRaw : 0;
  const valorMM = valor / 1_000_000; // en millones, para que la escala sea legible
  const urgencia = urgenciaCliente(c);
  if (valorMM <= 0 || urgencia <= 0) return valorMM * 0.1; // nunca negativo, pero sin urgencia casi no pesa
  return valorMM * urgencia * margenRealizado(c, precioCajaCanal);
}

/** Prioridad final de una visita: la base penalizada por lo lejos que queda de la ruta. */
export function prioridadVisita(
  c: CarteraClientLike,
  distanciaKm: number,
  precioCajaCanal = 0,
): number {
  const base = prioridadBase(c, precioCajaCanal);
  const km = Number.isFinite(distanciaKm) && distanciaKm > 0 ? distanciaKm : 0;
  return base * (1 / (1 + km));
}

/** Lleva la prioridad a una escala 0-100 comparable entre clientes. */
export function prioridadEscala100(prioridad: number): number {
  if (!Number.isFinite(prioridad) || prioridad <= 0) return 0;
  return Math.round((100 * prioridad) / (prioridad + 4));
}

/** Cliente con devolución significativa: hay que avisarlo antes de mandar a visitar. */
export function alertaNotaCredito(c: CarteraClientLike): { ratio: number; fecha: string | null } | null {
  const facturado = Number(c.monto_total_historico) || 0;
  const nc = Number(c.monto_notas_credito) || 0;
  if (facturado <= 0 || nc <= 0) return null;
  const ratio = nc / facturado;
  if (ratio < 0.3) return null;
  return { ratio, fecha: c.fecha_ultima_nc ?? null };
}

// ============================================================
// Clusterizado: se elige la zona DESPUÉS de rankear las cuentas.
// ============================================================

export interface ClusterPoint extends AnchorPoint {
  prioridad: number;
}

export interface ClusterResult {
  anchor: AnchorPoint;
  propios: number;
  valor: number;
  cumpleMinimo: boolean;
}

/**
 * Elige el núcleo de la ruta maximizando el valor recuperable dentro del radio.
 * Prefiere siempre un cluster que llegue al mínimo de cuentas propias: cambiar de
 * zona antes que rellenar el día con prospectos fríos.
 */
export function pickBestCluster(
  points: ClusterPoint[],
  radiusKm: number,
  minPropios: number,
): ClusterResult | null {
  if (points.length === 0) return null;

  let best: ClusterResult | null = null;
  for (const center of points) {
    const dentro = points.filter((p) =>
      calcularDistanciaKm(center.lat, center.lng, p.lat, p.lng) <= radiusKm
    );
    const valor = dentro.reduce((acc, p) => acc + (p.prioridad || 0), 0);
    const candidate: ClusterResult = {
      anchor: {
        lat: dentro.reduce((a, p) => a + p.lat, 0) / dentro.length,
        lng: dentro.reduce((a, p) => a + p.lng, 0) / dentro.length,
      },
      propios: dentro.length,
      valor,
      cumpleMinimo: dentro.length >= minPropios,
    };
    if (!best) { best = candidate; continue; }
    // 1) el que llega al mínimo de cartera manda; 2) después el de más valor.
    if (candidate.cumpleMinimo !== best.cumpleMinimo) {
      if (candidate.cumpleMinimo) best = candidate;
      continue;
    }
    if (candidate.valor > best.valor) best = candidate;
    else if (candidate.valor === best.valor && candidate.propios > best.propios) best = candidate;
  }
  return best;
}

// ============================================================
// Identidad de negocio: gate prospecto ↔ cartera
// ============================================================

const RUIDO_NOMBRE = new Set([
  "vinoteca", "vinos", "vino", "bodega", "bodegas", "almacen", "distribuidora",
  "srl", "sa", "sas", "s", "a", "l", "sh", "the", "el", "la", "los", "las", "de", "del", "y",
  "bar", "resto", "restaurante", "cava", "wine", "store", "shop", "club",
]);

/** Nombre de fantasía comparable: sin acentos, sin razón social, sin palabras de rubro. */
export function normalizeFantasyName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !RUIDO_NOMBRE.has(token.toLowerCase()))
    .join(" ")
    .trim();
}

export interface ClienteRef {
  name: string;
  lat: number;
  lng: number;
  vendedor?: string | null;
  diasDesdeUltimaCompra?: number | null;
}

export type ProspectGate =
  | { estado: "nuevo" }
  | { estado: "duplicado"; cliente: ClienteRef; distanciaKm: number }
  | { estado: "posible_cliente"; cliente: ClienteRef; distanciaKm: number };

/** < 200 m con el mismo nombre = mismo negocio. 200-800 m = hay que verificar antes de tocar timbre. */
export function evaluarProspectoContraCartera(
  prospecto: { nombre?: string | null; latitud?: number | null; longitud?: number | null; barrio?: string | null },
  clientes: ClienteRef[],
  barrioDeCliente?: (cliente: ClienteRef) => string | null,
): ProspectGate {
  const nombre = normalizeFantasyName(prospecto.nombre);
  if (!nombre) return { estado: "nuevo" };
  const lat = Number(prospecto.latitud);
  const lng = Number(prospecto.longitud);
  const tieneCoords = Number.isFinite(lat) && Number.isFinite(lng);

  for (const cliente of clientes) {
    const nombreCliente = normalizeFantasyName(cliente.name);
    if (!nombreCliente) continue;
    const mismoNombre = nombreCliente === nombre
      || nombreCliente.startsWith(`${nombre} `)
      || nombre.startsWith(`${nombreCliente} `);
    if (!mismoNombre) continue;

    if (!tieneCoords) return { estado: "posible_cliente", cliente, distanciaKm: 0 };
    const dist = calcularDistanciaKm(cliente.lat, cliente.lng, lat, lng);
    if (dist < 0.2) return { estado: "duplicado", cliente, distanciaKm: dist };
    if (dist <= 0.8) return { estado: "posible_cliente", cliente, distanciaKm: dist };

    const barrioProspecto = (prospecto.barrio || "").trim().toLowerCase();
    const barrioCliente = (barrioDeCliente?.(cliente) || "").trim().toLowerCase();
    if (barrioProspecto && barrioProspecto === barrioCliente) {
      return { estado: "posible_cliente", cliente, distanciaKm: dist };
    }
  }
  return { estado: "nuevo" };
}

// ============================================================
// Calidad de prospectos de Google
// ============================================================

export const MIN_RESENAS_PROSPECTO = 15;
export const MIN_RATING_PROSPECTO = 3.8;

const TIPOS_INCOHERENTES = new Set([
  "tourist_attraction", "night_club", "cultural_center", "performing_arts_theater",
  "art_gallery", "museum", "cafe", "coffee_shop", "bakery", "fast_food_restaurant",
  "ice_cream_shop", "movie_theater", "park", "lodging", "hotel",
]);

const TIPOS_PREFERIDOS = ["liquor_store", "wine_bar", "restaurant", "bar", "meal_takeaway"];

/** Un 5.0 con 3 reseñas no es potencial: filtramos por volumen de reseñas y coherencia de rubro. */
export function esProspectoComercialmenteValido(p: {
  rating?: number | null;
  total_ratings?: number | null;
  userRatingCount?: number | null;
  tipo_principal?: string | null;
  tipos?: string[] | null;
}): boolean {
  const reseñas = Number(p.total_ratings ?? p.userRatingCount ?? 0);
  if (!Number.isFinite(reseñas) || reseñas < MIN_RESENAS_PROSPECTO) return false;
  const rating = Number(p.rating ?? 0);
  if (Number.isFinite(rating) && rating > 0 && rating < MIN_RATING_PROSPECTO) return false;

  const tipos = [p.tipo_principal || "", ...(p.tipos || [])].map((t) => String(t).toLowerCase());
  if (tipos.some((t) => TIPOS_PREFERIDOS.includes(t))) return true;
  if (tipos.some((t) => TIPOS_INCOHERENTES.has(t))) return false;
  return true;
}

/** Potencial de compra mayorista: manda el volumen de reseñas, no la nota. */
export function potencialProspecto(p: { rating?: number | null; total_ratings?: number | null }): number {
  const reseñas = Math.min(Number(p.total_ratings ?? 0) || 0, 200);
  const rating = Number(p.rating ?? 0) || 0;
  return Math.min(100, (reseñas / 200) * 85 + (rating >= MIN_RATING_PROSPECTO ? 15 : 0));
}

// ============================================================
// Normalización de barrios
// ============================================================

export function normalizeBarrio(value: string | null | undefined): string {
  const limpio = (value || "").trim().replace(/\s+/g, " ");
  if (!limpio) return "";
  return limpio
    .toLocaleLowerCase("es-AR")
    .split(" ")
    .map((word, i) =>
      i > 0 && ["de", "del", "la", "las", "los", "y"].includes(word)
        ? word
        : word.charAt(0).toLocaleUpperCase("es-AR") + word.slice(1)
    )
    .join(" ");
}

/** Agrupa barrios equivalentes ignorando mayúsculas y acentos. */
export function dedupeBarrios(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const pretty = normalizeBarrio(raw);
    if (!pretty) continue;
    const key = pretty.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pretty);
  }
  return out;
}
