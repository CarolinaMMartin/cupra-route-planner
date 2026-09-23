// ============================================================
// Reglas de negocio puras (sin I/O) del motor de recomendaciones.
// Todo lo que decide "quién entra" vive acá y tiene tests propios.
// Espejo en el frontend: src/lib/segmentos.ts (mismos umbrales).
// ============================================================

import { type EstadoComercial } from "../_shared/estado-comercial.ts";
export { type EstadoComercial, DIAS_ACTIVO, DIAS_INACTIVO, hoyArgentina, diasDesdeUltimaCompra, estadoPorDias } from "../_shared/estado-comercial.ts";
export const ESTADOS_COMERCIALES: EstadoComercial[] = ["ACTIVO", "INACTIVO", "PERDIDO", "POTENCIAL"];
const MS_DIA = 24 * 60 * 60 * 1000;

/** Normaliza la lista de estados que llega del frontend (acepta minúsculas y plurales). */
export function parseEstados(raw: unknown): Set<EstadoComercial> {
  const out = new Set<EstadoComercial>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    const key = String(v || "").trim().toUpperCase().replace(/ES$|S$/, "");
    const alias: Record<string, EstadoComercial> = {
      ACTIVO: "ACTIVO", INACTIVO: "INACTIVO", PERDIDO: "PERDIDO", POTENCIAL: "POTENCIAL", PROSPECTO: "POTENCIAL",
    };
    if (alias[key]) out.add(alias[key]);
  }
  return out;
}

// ------------------------------------------------------------
// Feedback del vendedor → exclusiones
// ------------------------------------------------------------

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Frases que significan "no se vuelve a visitar". */
const EXCLUSION_DEFINITIVA = [
  /cerrado definitiv/,
  /cerro definitiv/,
  /cerrado permanente/,
  /cerro permanente/,
  /cierre definitiv/,
  /no volver/,
  /no trabaja mas/,
  /cambio de rubro/,
  /ya no existe/,
];

/** Un "Cerrado" suelto (ese día estaba cerrado) solo aparta al negocio unos días. */
export const DIAS_EXCLUSION_CERRADO_TEMPORAL = 7;

export interface FeedbackLike {
  feedback?: string | null;
  motivo_no_visita?: string | null;
  created_at?: string | null;
}

/**
 * ¿El feedback del vendedor aparta a este negocio de la ruta de hoy?
 * - Definitivo ("Cerrado definitivo", "no volver"...) → siempre.
 * - "Cerrado" temporal → solo si fue en los últimos 7 días.
 * Antes cualquier texto con "cerrado" lo excluía para siempre.
 */
export function excluidoPorFeedback(feedbacks: FeedbackLike[], now: Date = new Date()): boolean {
  for (const fb of feedbacks || []) {
    const texto = sinAcentos(`${fb.feedback || ""} | ${fb.motivo_no_visita || ""}`);
    if (EXCLUSION_DEFINITIVA.some((re) => re.test(texto))) return true;
    if (/\bcerrad[oa]\b/.test(texto)) {
      const t = fb.created_at ? Date.parse(fb.created_at) : NaN;
      if (Number.isFinite(t) && now.getTime() - t < DIAS_EXCLUSION_CERRADO_TEMPORAL * MS_DIA) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------
// Dueño de la cuenta: nombre del Excel → perfil del vendedor
// ------------------------------------------------------------

export function normalizarNombrePersona(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s: string) => new Set(s.split(" ").filter((t) => t.length > 1));

export interface ResolvedorVendedores {
  resolver(nombre: string | null | undefined): string | null;
}

/**
 * Resuelve el nombre de vendedor que viene en el Excel al user_id del perfil.
 * 1) Coincidencia exacta normalizada ("LEANDRO PEREZ" = "Leandro Pérez").
 * 2) Mismas palabras en otro orden ("PEREZ LEANDRO").
 * 3) Todas las palabras del nombre corto están en el largo ("LEANDRO" → "Leandro Pérez"),
 *    SOLO si hay un único perfil posible.
 * Nunca por "contiene": "MARIANA" no es "ANA".
 */
export function crearResolvedorVendedores(perfiles: { user_id: string; nombre: string | null }[]): ResolvedorVendedores {
  const lista = perfiles
    .filter((p) => p?.user_id && p?.nombre)
    .map((p) => ({ id: p.user_id, key: normalizarNombrePersona(p.nombre), toks: tokens(normalizarNombrePersona(p.nombre)) }))
    .filter((p) => p.key);
  const cache = new Map<string, string | null>();

  const resolver = (nombre: string | null | undefined): string | null => {
    const key = normalizarNombrePersona(nombre);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key)!;

    let result: string | null = null;
    const exactos = new Set(lista.filter((p) => p.key === key).map((p) => p.id));
    if (exactos.size === 1) result = [...exactos][0];
    else if (exactos.size === 0) {
      const toks = tokens(key);
      const mismosTokens = new Set(lista
        .filter((p) => p.toks.size === toks.size && [...toks].every((t) => p.toks.has(t)))
        .map((p) => p.id));
      if (mismosTokens.size === 1) result = [...mismosTokens][0];
      else if (mismosTokens.size === 0 && toks.size > 0) {
        const contenidos = new Set(lista
          .filter((p) => {
            const [chico, grande] = toks.size <= p.toks.size ? [toks, p.toks] : [p.toks, toks];
            return chico.size > 0 && [...chico].every((t) => grande.has(t));
          })
          .map((p) => p.id));
        if (contenidos.size === 1) result = [...contenidos][0];
      }
    }
    cache.set(key, result);
    return result;
  };
  return { resolver };
}

// ------------------------------------------------------------
// Origen del prospecto
// ------------------------------------------------------------

export type OrigenProspecto = "google" | "excel" | "manual";

/**
 * Origen del prospecto, para decidir si se le exige volumen de reseñas.
 * Ojo: el importador de Excel guarda el place_id de Google cuando logra geocodificar,
 * así que el prefijo no alcanza. Un prospecto SIN datos de reseñas (rating y cantidad
 * vacíos o en cero) no vino de una búsqueda de Google Places: lo cargó el equipo.
 */
export function origenProspecto(p: {
  place_id?: string | null;
  tipo_principal?: string | null;
  total_ratings?: number | null;
  rating?: number | null;
}): OrigenProspecto {
  const id = String(p.place_id || "");
  if (id.startsWith("manual-") || String(p.tipo_principal || "").toLowerCase() === "manual") return "manual";
  if (id.startsWith("excel-")) return "excel";
  const conResenas = Number(p.total_ratings) > 0 || Number(p.rating) > 0;
  return conResenas ? "google" : "excel";
}

// ------------------------------------------------------------
// Rubro
// ------------------------------------------------------------

/** Clave comparable de rubro (el valor viene de la columna `rubro`, calculada en la base). */
export function rubroKey(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

/** Tipos de Google Places que corresponden a cada rubro normalizado (para buscar prospectos). */
export const TIPOS_GOOGLE_POR_RUBRO: Record<string, string[]> = {
  "VINOTECA": ["liquor_store"],
  "WINE BAR": ["wine_bar"],
  "RESTAURANTE": ["restaurant"],
  "BAR": ["bar", "pub"],
  "HOTEL": ["hotel"],
  "ALMACEN / SUPERMERCADO": ["grocery_store", "supermarket", "convenience_store"],
  "TIENDA GOURMET": ["food_store", "deli"],
};

export const TIPOS_GOOGLE_DEFAULT = ["liquor_store", "wine_bar", "restaurant", "bar"];

export function tiposGoogleParaRubros(rubros: Set<string>): string[] {
  if (rubros.size === 0) return TIPOS_GOOGLE_DEFAULT;
  const out = new Set<string>();
  for (const r of rubros) (TIPOS_GOOGLE_POR_RUBRO[r] || []).forEach((t) => out.add(t));
  return out.size > 0 ? [...out] : TIPOS_GOOGLE_DEFAULT;
}
