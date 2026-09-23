// ============================================================
// Planificador de rutas: decide las 8 visitas de cada vendedor.
//
// No toca la base ni la red directamente: todo acceso externo entra por
// `PlanDeps`, así el recorrido completo se testea con datos armados
// (planificador_test.ts reproduce los casos reales del piloto).
//
// Orden de decisión por vendedor:
//   1. Núcleo de la ruta: el cluster de su cartera (filtrada por estado) con más valor.
//   2. Candidatos dentro de 2,5 km → 3,5 km (cartera y prospectos de la zona).
//   3. Si faltan prospectos: pausa de 15 días relajada y búsqueda en Google Maps.
//   4. Composición 5-2-1 (o por estados elegidos). La IA solo ordena y redacta.
//   5. GARANTÍA DE 8: si todavía faltan, se amplía el radio (5 → 8 → 15 km) y,
//      como último recurso, se sale de la zona elegida. Siempre avisado.
// ============================================================

import { type AnchorPoint, calcularDistanciaKm, findDensestHotspot } from "./geo-hotspot.ts";
import { pickBestCluster, prioridadBase } from "./portfolio-ranking.ts";
import { composeRoute, type Cupos, DEFAULT_CUPOS } from "./recommendation-composition.ts";
import {
  dedupeByIdentity,
  isValidCoord,
  type RevisitInfo,
  type ScoredCandidate,
  scoreClients,
  scoreProspects,
} from "./candidatos.ts";
import { diasDesdeUltimaCompra, type EstadoComercial, estadoPorDias } from "./reglas.ts";

export const VISITAS_POR_DIA = 8;
export const RADIO_OPERATIVO_KM = 2.5;
export const RADIO_AMPLIADO_KM = 3.5;
/** Escalones de la garantía de 8 (último recurso, fuera de la ruta caminable). */
export const RADIOS_GARANTIA_KM = [5, 8, 15];
export const COOLDOWN_DIAS = 15;
export const MAX_ROUTE_SPREAD_KM = 3.0;
/** Último punto de referencia posible: vendedor sin cartera, sin área y sin otros datos. */
export const CENTRO_CABA: AnchorPoint = { lat: -34.6037, lng: -58.3816 };

export interface Vendedor { user_id: string; nombre: string; }

export interface PlanInput {
  vendedores: Vendedor[];
  /** Cartera propia de cada vendedor DENTRO del área pedida (o toda, si no hay área). */
  carteraEnZona: Map<string, any[]>;
  /** Cartera propia completa (incluye fuera del área): solo para la garantía de 8. */
  carteraTotal: Map<string, any[]>;
  placesMap: Map<string, any>;
  /** Prospectos del área, ya filtrados por rubro y por el gate prospecto↔cartera. */
  prospectosZona: any[];
  feedbacksClientes: Map<string, any[]>;
  feedbacksProspectos: Map<string, any[]>;
  revisitClientes: Map<string, RevisitInfo>;
  revisitProspectos: Map<string, RevisitInfo>;
  posiblesClientes: Map<string, unknown>;
  estados: Set<EstadoComercial>;
  precioCajaCanal: number;
  /** Centro de la zona pedida (para vendedores sin cartera en ella). */
  centroZona: AnchorPoint | null;
  /** ¿El prospecto/cliente pertenece al área elegida? */
  enArea: (p: { barrio?: string | null; comuna?: string | null; ciudad?: string | null }) => boolean;
  areaActiva: boolean;
  /** IDs ya asignados hoy (no se vuelven a recomendar). */
  asignadosHoy: Set<string>;
  cupos?: Cupos;
  now?: Date;
}

export interface PlanDeps {
  /** Prospectos de la base dentro de `radioKm` del punto (sin filtrar por área). */
  prospectosCerca(lat: number, lng: number, radioKm: number): Promise<any[]>;
  /** Busca y guarda prospectos nuevos en Google Maps; devuelve las filas guardadas. */
  descubrirEnGoogle?(lat: number, lng: number, radioKm: number, objetivo: number, excluir: Set<string>): Promise<any[]>;
  /** Gate prospecto↔cartera para prospectos que aparecen durante la corrida. */
  pasaGate(p: any): boolean;
  /** Orden sugerido por la IA (IDs), opcional. */
  preferidosIA?: Map<string, string[]>;
  log?: (msg: string) => void;
}

export interface Cobertura {
  vendedor: string;
  total: number;
  objetivo: { cartera_activa: number; reactivacion: number; prospectos: number };
  obtenido: { cartera_activa: number; reactivacion: number; potencial: number; prospectos: number };
  estados_elegidos: string[];
  fuera_de_seleccion: number;
  fuera_de_zona: number;
  prospectos_de_maps: number;
  radio_final_km: number;
  clientes_propios_en_zona: number;
  cuentas_prioritarias_fuera_de_zona: { nombre: string; barrio: string | null; dias_sin_comprar: number | null }[];
  error_google?: string;
}

export interface PlanVendedor {
  vendedor: Vendedor;
  hotspot: AnchorPoint | null;
  elegidos: ScoredCandidate[];
  fueraDeSeleccion: Set<string>;
  cobertura: Cobertura;
  /** Todos los candidatos evaluados (para enriquecer y auditar). */
  pool: Map<string, ScoredCandidate>;
}

export interface PlanResult {
  porVendedor: PlanVendedor[];
  descubiertosGoogle: any[];
}

/** Pool de candidatos de un vendedor, sin duplicados por ID. */
class Pool {
  private byId = new Map<string, ScoredCandidate>();
  add(cands: ScoredCandidate[], marca?: Partial<ScoredCandidate>) {
    let n = 0;
    for (const c of cands) {
      if (this.byId.has(c.client_id)) continue;
      this.byId.set(c.client_id, marca ? { ...c, ...marca } : c);
      n++;
    }
    return n;
  }
  get clients() { return [...this.byId.values()].filter((c) => !c.es_prospecto); }
  get prospects() { return [...this.byId.values()].filter((c) => c.es_prospecto); }
  get map() { return this.byId; }
  has(id: string) { return this.byId.has(id); }
}

const estadoCliente = (c: any, now: Date): EstadoComercial => estadoPorDias(diasDesdeUltimaCompra(c, now));

export async function planificarRutas(input: PlanInput, deps: PlanDeps): Promise<PlanResult> {
  const now = input.now ?? new Date();
  const log = deps.log ?? (() => {});
  const cupos = input.cupos ?? DEFAULT_CUPOS;
  const hayFiltroEstados = input.estados.size > 0;
  const hotspots = new Map<string, AnchorPoint>();
  const usadosIds = new Set<string>(input.asignadosHoy);
  const usadosIdentidades = new Set<string>();
  const descubiertos: any[] = [];
  const descubiertosIds = new Set<string>();
  let googleDisponible = Boolean(deps.descubrirEnGoogle);
  const porVendedor: PlanVendedor[] = [];

  const baseOpts = {
    precioCajaCanal: input.precioCajaCanal,
    posiblesClientes: input.posiblesClientes,
    now,
  };

  const carteraDe = (vendedorId: string) => {
    const cartera = input.carteraEnZona.get(vendedorId) || [];
    const carteraElegible = hayFiltroEstados
      ? cartera.filter((c) => input.estados.has(estadoCliente(c, now)))
      : cartera;
    return { cartera, carteraElegible };
  };

  // ---- 1. Núcleo de la ruta de cada vendedor (todos antes de armar pools) ----
  // Primero los que tienen cartera elegible (su núcleo sale de sus propias cuentas);
  // después los que no, ubicados en la zona libre que dejan los demás.
  const nucleoPorCartera = (vendedorId: string): AnchorPoint | null => {
    const puntos = carteraDe(vendedorId).carteraElegible
      .map((c) => ({ c, place: input.placesMap.get(c.client_id) }))
      .filter(({ place }) => place && isValidCoord(place.lat, place.long))
      .map(({ c, place }) => ({
        lat: Number(place.lat), lng: Number(place.long),
        prioridad: prioridadBase({ ...c, dias_desde_ultima_compra: diasDesdeUltimaCompra(c, now) }, input.precioCajaCanal),
      }));
    const cluster = pickBestCluster(puntos, RADIO_OPERATIVO_KM, cupos.cartera);
    return cluster?.anchor || findDensestHotspot(puntos, 2.0) || null;
  };
  const densoDe = (clientes: any[]): AnchorPoint | null => findDensestHotspot(
    clientes
      .map((c) => input.placesMap.get(c.client_id))
      .filter((pl) => pl && isValidCoord(pl.lat, pl.long))
      .map((pl) => ({ lat: Number(pl.lat), lng: Number(pl.long) })),
    RADIO_OPERATIVO_KM,
  );
  const nucleoSinCartera = (vendedorId: string): AnchorPoint | null => {
    // 1) Sin cuentas del estado elegido: su cartera en la zona, aunque sea de otro estado
    //    (la ruta tiene que caer donde trabaja ESE vendedor, no en el núcleo de otro).
    const propia = densoDe(carteraDe(vendedorId).cartera);
    if (propia) return propia;
    // 2) Sin cartera en la zona pedida: prospectos del área o su centro.
    const otros = [...hotspots.values()];
    const pts = input.prospectosZona
      .filter((p) => isValidCoord(p.latitud, p.longitud))
      .map((p) => ({ lat: Number(p.latitud), lng: Number(p.longitud) }));
    const libres = pts.filter((p) => otros.every((o) => calcularDistanciaKm(o.lat, o.lng, p.lat, p.lng) > RADIO_OPERATIVO_KM));
    const deProspectos = findDensestHotspot(libres.length > 0 ? libres : pts, RADIO_OPERATIVO_KM);
    if (deProspectos) return deProspectos;
    // 3) Sin área: núcleo de toda su cartera. Con área: el centro del área.
    if (!input.areaActiva) {
      const total = densoDe(input.carteraTotal.get(vendedorId) || []);
      if (total) return total;
    }
    return input.centroZona || densoDe(input.carteraTotal.get(vendedorId) || []) || CENTRO_CABA;
  };
  for (const v of input.vendedores) {
    const hs = nucleoPorCartera(v.user_id);
    if (hs) hotspots.set(v.user_id, hs);
  }
  for (const v of input.vendedores) {
    if (hotspots.has(v.user_id)) continue;
    const hs = nucleoSinCartera(v.user_id);
    if (hs) hotspots.set(v.user_id, hs);
  }

  for (const vendedor of input.vendedores) {
    const { carteraElegible } = carteraDe(vendedor.user_id);
    const cartera = carteraDe(vendedor.user_id).cartera.filter((c) => !usadosIds.has(c.client_id));
    const hotspot = hotspots.get(vendedor.user_id) || null;

    const cobertura: Cobertura = {
      vendedor: vendedor.nombre,
      total: 0,
      objetivo: { cartera_activa: cupos.cartera, reactivacion: cupos.reactivacion, prospectos: cupos.prospectos },
      obtenido: { cartera_activa: 0, reactivacion: 0, potencial: 0, prospectos: 0 },
      estados_elegidos: [...input.estados],
      fuera_de_seleccion: 0,
      fuera_de_zona: 0,
      prospectos_de_maps: 0,
      radio_final_km: 0,
      clientes_propios_en_zona: cartera.length,
      cuentas_prioritarias_fuera_de_zona: [],
    };

    if (!hotspot) {
      log(`⚠️ ${vendedor.nombre}: no hay ningún punto de referencia (sin cartera ni zona).`);
      porVendedor.push({ vendedor, hotspot: null, elegidos: [], fueraDeSeleccion: new Set(), cobertura, pool: new Map() });
      continue;
    }
    const h = hotspot;
    const otherAnchors = [...hotspots.entries()].filter(([id]) => id !== vendedor.user_id).map(([, a]) => a);

    // Cuentas valiosas del vendedor que quedan fuera del núcleo (aviso, no entran).
    cobertura.cuentas_prioritarias_fuera_de_zona = carteraElegible
      .map((c) => ({ c, place: input.placesMap.get(c.client_id), dias: diasDesdeUltimaCompra(c, now) }))
      .filter(({ place }) => place && isValidCoord(place.lat, place.long))
      .filter(({ place }) => calcularDistanciaKm(h.lat, h.lng, Number(place.lat), Number(place.long)) > RADIO_AMPLIADO_KM)
      .map(({ c, place, dias }) => ({ c, place, dias, prio: prioridadBase({ ...c, dias_desde_ultima_compra: dias }, input.precioCajaCanal) }))
      .filter((x) => x.prio > 0)
      .sort((a, b) => b.prio - a.prio)
      .slice(0, 3)
      .map(({ c, place, dias }) => ({ nombre: c.fantasia || c.razon_social || c.client_id, barrio: place.barrio_principal || null, dias_sin_comprar: dias }));

    const pool = new Pool();
    const libre = (c: ScoredCandidate) => !usadosIds.has(c.client_id);
    /** Caminable desde el núcleo y dentro del área elegida. */
    const idsEnArea = new Set<string>([
      ...cartera.map((c) => c.client_id),
      ...input.prospectosZona.map((p) => p.place_id),
    ]);
    const registrarArea = (filas: any[]) => {
      for (const f of filas) if (f?.place_id && input.enArea(f)) idsEnArea.add(f.place_id);
      return filas;
    };
    const dentroDeRuta = (c: ScoredCandidate) =>
      c.distancia_km <= RADIO_AMPLIADO_KM && (!input.areaActiva || idsEnArea.has(c.client_id));
    const clientOpts = { ...baseOpts, revisitMap: input.revisitClientes, otherAnchors };
    const prospOpts = { ...baseOpts, revisitMap: input.revisitProspectos, otherAnchors };
    const cuenta = () => {
      const clientes = pool.clients.filter(libre);
      const elegiblesCli = hayFiltroEstados ? clientes.filter((c) => input.estados.has(c.estado_comercial)) : clientes;
      const prosp = pool.prospects.filter(libre);
      return { clientes: elegiblesCli.length, prospectos: prosp.length, total: clientes.length + prosp.length };
    };

    // ---- 2. Candidatos en radio caminable ----
    for (const radio of [RADIO_OPERATIVO_KM, RADIO_AMPLIADO_KM]) {
      pool.add(scoreClients(cartera, input.placesMap, input.feedbacksClientes, h, radio, { ...clientOpts, cooldownDays: COOLDOWN_DIAS }).filter(libre));
      pool.add(scoreProspects(input.prospectosZona, input.feedbacksProspectos, h, radio, { ...prospOpts, cooldownDays: COOLDOWN_DIAS }).filter(libre));
    }
    // Prospectos de la base cercanos al núcleo aunque figuren con otro barrio (misma cuadra, otra etiqueta).
    const cercanos = registrarArea((await deps.prospectosCerca(h.lat, h.lng, RADIO_AMPLIADO_KM)).filter(deps.pasaGate));
    const cercanosEnArea = input.areaActiva ? cercanos.filter((p) => idsEnArea.has(p.place_id)) : cercanos;
    pool.add(scoreProspects(cercanosEnArea, input.feedbacksProspectos, h, RADIO_AMPLIADO_KM, { ...prospOpts, cooldownDays: COOLDOWN_DIAS }).filter(libre));

    // ---- 3. Si faltan: cartera sin pausa, prospectos sin pausa, Google ----
    const faltanProspectos = () => {
      const n = cuenta();
      const potencialesPropios = pool.clients.filter((c) => libre(c) && c.estado_comercial === "POTENCIAL").length;
      const cupoPotencial = !hayFiltroEstados || input.estados.has("POTENCIAL")
        ? Math.max(0, cupos.prospectos - potencialesPropios) : 0;
      const necesitados = Math.max(cupoPotencial, VISITAS_POR_DIA - n.clientes);
      // Una selección completa (p. ej., ocho perdidos) no necesita búsquedas pagas.
      return n.prospectos < necesitados;
    };
    if (cuenta().clientes < VISITAS_POR_DIA) {
      pool.add(scoreClients(cartera, input.placesMap, input.feedbacksClientes, h, RADIO_AMPLIADO_KM, { ...clientOpts, cooldownDays: 0 }).filter(libre));
    }
    if (faltanProspectos()) {
      pool.add(scoreProspects([...input.prospectosZona, ...cercanosEnArea], input.feedbacksProspectos, h, RADIO_AMPLIADO_KM, { ...prospOpts, cooldownDays: 0 }).filter(libre));
    }
    if (faltanProspectos() && googleDisponible && deps.descubrirEnGoogle) {
      const n = cuenta();
      const objetivo = Math.max(cupos.prospectos, VISITAS_POR_DIA - n.clientes) + 6;
      const excluir = new Set<string>([...pool.map.keys(), ...usadosIds, ...descubiertosIds]);
      try {
        const nuevos = registrarArea((await deps.descubrirEnGoogle(h.lat, h.lng, RADIO_AMPLIADO_KM, objetivo, excluir)).filter(deps.pasaGate));
        nuevos.forEach((p) => { if (!descubiertosIds.has(p.place_id)) { descubiertosIds.add(p.place_id); descubiertos.push(p); } });
        const live = scoreProspects(nuevos, input.feedbacksProspectos, h, RADIO_AMPLIADO_KM, { ...prospOpts, cooldownDays: 0, ignorarTerritorio: true }).filter(libre);
        const n2 = pool.add(live.filter(dentroDeRuta), { origen: "maps_live" })
          + pool.add(live, { origen: "maps_live", fuera_de_zona: true });
        log(`🔎 ${vendedor.nombre}: Google Maps sumó ${n2} prospectos cercanos.`);
      } catch (e) {
        cobertura.error_google = e instanceof Error ? e.message : String(e);
        googleDisponible = false; // clave inválida o sin cuota: no insistir con los demás vendedores
        log(`⚠️ Google Maps no disponible: ${cobertura.error_google}`);
      }
    }

    // ---- 4. Composición ----
    const componer = () => {
      const clients = dedupeByIdentity(pool.clients.filter(libre), usadosIdentidades)
        .sort((a, b) => Number(a.fuera_de_zona ?? false) - Number(b.fuera_de_zona ?? false) || b.score_total - a.score_total);
      const idsCli = new Set(clients.map((c) => c.identity_key));
      const prospects = dedupeByIdentity(pool.prospects.filter(libre), new Set([...usadosIdentidades, ...idsCli]))
        .sort((a, b) => Number(a.fuera_de_zona ?? false) - Number(b.fuera_de_zona ?? false) || a.distancia_km - b.distancia_km);
      return composeRoute({
        preferredIds: deps.preferidosIA?.get(vendedor.user_id) || [],
        clients,
        prospects,
        unavailableIds: usadosIds,
        limit: VISITAS_POR_DIA,
        cupos,
        estados: input.estados,
      });
    };
    let compuesto = componer();

    // ---- 5. Garantía de 8 ----
    for (const radio of RADIOS_GARANTIA_KM) {
      if (compuesto.ids.length >= VISITAS_POR_DIA) break;
      log(`🚨 ${vendedor.nombre}: ${compuesto.ids.length}/8. Ampliando a ${radio} km.`);
      // Cartera propia (toda) y prospectos de la base en el radio, sin pausa ni territorio.
      // Lo que queda lejos del núcleo o fuera del área se marca para avisarlo.
      const carteraTotal = input.carteraTotal.get(vendedor.user_id) || cartera;
      const cli = scoreClients(carteraTotal, input.placesMap, input.feedbacksClientes, h, radio, { ...clientOpts, cooldownDays: 0 }).filter(libre);
      pool.add(cli.filter(dentroDeRuta));
      pool.add(cli, { fuera_de_zona: true });
      const cerca = registrarArea((await deps.prospectosCerca(h.lat, h.lng, radio)).filter(deps.pasaGate));
      const pr = scoreProspects(cerca, input.feedbacksProspectos, h, radio, { ...prospOpts, cooldownDays: 0, ignorarTerritorio: true }).filter(libre);
      pool.add(pr.filter(dentroDeRuta));
      pool.add(pr, { fuera_de_zona: true });
      compuesto = componer();
      if (compuesto.ids.length < VISITAS_POR_DIA && googleDisponible && deps.descubrirEnGoogle && radio === RADIOS_GARANTIA_KM[0]) {
        try {
          const excluir = new Set<string>([...pool.map.keys(), ...usadosIds, ...descubiertosIds]);
          const nuevos = registrarArea((await deps.descubrirEnGoogle(h.lat, h.lng, radio, VISITAS_POR_DIA - compuesto.ids.length + 6, excluir)).filter(deps.pasaGate));
          nuevos.forEach((p) => { if (!descubiertosIds.has(p.place_id)) { descubiertosIds.add(p.place_id); descubiertos.push(p); } });
          const live = scoreProspects(nuevos, input.feedbacksProspectos, h, radio, { ...prospOpts, cooldownDays: 0, ignorarTerritorio: true }).filter(libre);
          pool.add(live.filter(dentroDeRuta), { origen: "maps_live" });
          pool.add(live, { origen: "maps_live", fuera_de_zona: true });
          compuesto = componer();
        } catch (e) {
          cobertura.error_google = e instanceof Error ? e.message : String(e);
          googleDisponible = false;
        }
      }
    }

    // El límite de 15 km es operativo. Un déficit se informa al asignador;
    // no se agregan cuentas a distancia ilimitada para aparentar ocho visitas.

    // ---- Resultado del vendedor ----
    const elegidos = compuesto.ids.map((id) => pool.map.get(id)!).filter(Boolean);
    elegidos.forEach((c) => { usadosIds.add(c.client_id); usadosIdentidades.add(c.identity_key); });
    for (const c of elegidos) {
      if (c.es_prospecto) cobertura.obtenido.prospectos++;
      else if (c.estado_comercial === "ACTIVO") cobertura.obtenido.cartera_activa++;
      else if (c.estado_comercial === "POTENCIAL") cobertura.obtenido.potencial++;
      else cobertura.obtenido.reactivacion++;
      if (c.fuera_de_zona) cobertura.fuera_de_zona++;
      if (c.origen === "maps_live") cobertura.prospectos_de_maps++;
      cobertura.radio_final_km = Math.max(cobertura.radio_final_km, c.distancia_km);
    }
    cobertura.total = elegidos.length;
    cobertura.fuera_de_seleccion = compuesto.fueraDeSeleccion.length;
    log(`✅ ${vendedor.nombre}: ${elegidos.length} visitas (${cobertura.obtenido.cartera_activa} activos, ${cobertura.obtenido.reactivacion} reactivación, ${cobertura.obtenido.potencial + cobertura.obtenido.prospectos} potenciales).`);

    porVendedor.push({
      vendedor,
      hotspot: h,
      elegidos,
      fueraDeSeleccion: new Set(compuesto.fueraDeSeleccion),
      cobertura,
      pool: pool.map,
    });
  }

  return { porVendedor, descubiertosGoogle: descubiertos };
}
