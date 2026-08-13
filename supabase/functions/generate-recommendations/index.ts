import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { composeRecommendationIds } from "./recommendation-composition.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const HARD_RADIUS_KM = 1.5;
const MAX_EXPANSION_KM = 2.0;
const EXPANSION_STEPS_KM = [3.0, 5.0]; // Progressive expansion if 2km isn't enough
// Último recurso: nunca proponer visitas más lejos que esto del hotspot del vendedor.
const ZONE_FALLBACK_MAX_KM = 8.0;
// Clientes propios: antes de meter prospectos, se puede ir hasta acá dentro de la cartera.
const PORTFOLIO_FALLBACK_MAX_KM = 25.0;
// Un prospecto NUNCA puede estar más lejos que esto del hotspot del vendedor.
const MAX_PROSPECT_DISTANCE_KM = 12.0;
// Días mínimos entre dos recomendaciones del mismo negocio (regla dura, se relaja sólo si no se llega a 8).
const RECOMMENDATION_COOLDOWN_DAYS = 15;

interface RevisitInfo { dueAt: number; source: string; }

/**
 * Interpreta el feedback del vendedor para saber cuándo pidió volver.
 * Soporta "volver en 2 semanas", "revisitar en 10 días", "la semana que viene",
 * "el mes que viene", "volver mañana", etc.
 */
function parseRevisitDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const wantsReturn = /(volver|revisit|re visitar|regresar|pasar de nuevo|volvemos|contactar)/.test(t);
  if (!wantsReturn && !/(en \d+\s*(dia|semana|mes))/.test(t)) return null;

  const num = t.match(/(\d+)\s*(dias?|semanas?|meses?|mes)/);
  if (num) {
    const value = parseInt(num[1], 10);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (num[2].startsWith("dia")) return value;
    if (num[2].startsWith("semana")) return value * 7;
    return value * 30;
  }
  if (/(una semana|la semana que viene|proxima semana|semana proxima)/.test(t)) return 7;
  if (/(quincena|15 dias)/.test(t)) return 15;
  if (/(un mes|el mes que viene|proximo mes|mes proximo)/.test(t)) return 30;
  if (/(manana)/.test(t)) return 1;
  return null;
}

/** Mapa negocio -> fecha mínima de próxima visita según el feedback más reciente. */
function buildRevisitMap(feedbacksMap: Map<string, any[]>): Map<string, RevisitInfo> {
  const map = new Map<string, RevisitInfo>();
  for (const [id, feedbacks] of feedbacksMap) {
    for (const fb of feedbacks) {
      const days = parseRevisitDays(fb.feedback) ?? parseRevisitDays(fb.motivo_no_visita);
      if (days === null) continue;
      const base = fb.created_at ? new Date(fb.created_at).getTime() : Date.now();
      const dueAt = base + days * 24 * 60 * 60 * 1000;
      const prev = map.get(id);
      if (!prev || dueAt > prev.dueAt) {
        map.set(id, { dueAt, source: `${fb.feedback || fb.motivo_no_visita} (+${days}d)` });
      }
      break; // feedbacks vienen ordenados por fecha desc: vale el más reciente
    }
  }
  return map;
}

interface ScoreOptions {
  cooldownDays?: number;
  revisitMap?: Map<string, RevisitInfo>;
}


// ---- Identity dedup (evita recomendar el mismo negocio 2 veces) ----
function normalizeIdentityText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIdentityKey(opts: {
  esProspecto: boolean;
  cuit?: string | null;
  nombre?: string | null;
  direccion?: string | null;
  lat?: number | null;
  long?: number | null;
}): string {
  const cuit = (opts.cuit || "").replace(/\D/g, "");
  if (cuit.length >= 8) return `cuit:${cuit}`;
  const nombre = normalizeIdentityText(opts.nombre);
  const dir = normalizeIdentityText(opts.direccion).split(" ").slice(0, 4).join(" ");
  if (nombre && dir) return `nd:${nombre}|${dir}`;
  if (nombre && opts.lat != null && opts.long != null) {
    return `ng:${nombre}|${opts.lat.toFixed(3)},${opts.long.toFixed(3)}`;
  }
  return `n:${nombre || Math.random().toString(36)}`;
}

/** Deja un único candidato por identidad (el de mayor score) y descarta los ya usados. */
function dedupeByIdentity(
  candidates: ScoredCandidate[],
  usedIdentities: Set<string>,
): ScoredCandidate[] {
  const best = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    if (usedIdentities.has(c.identity_key)) continue;
    const prev = best.get(c.identity_key);
    if (!prev || c.score_total > prev.score_total) best.set(c.identity_key, c);
  }
  return Array.from(best.values()).sort((a, b) => b.score_total - a.score_total);
}

interface AnchorPoint { lat: number; lng: number; }


const CABA_VIEWPORT = {
  low: { latitude: -34.705, longitude: -58.531 },
  high: { latitude: -34.526, longitude: -58.335 },
};

const GOOGLE_PROSPECT_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
}

interface GoogleTextSearchResponse {
  places?: GooglePlace[];
  error?: { message?: string };
}

interface DiscoveredProspect {
  place_id: string;
  nombre: string;
  telefono: null;
  direccion: string;
  barrio: string | null;
  comuna: string | null;
  ciudad: string;
  provincia: string;
  latitud: number;
  longitud: number;
  rating: number;
  total_ratings: number;
  nivel_precio: string | null;
  tipo_principal: string | null;
  tipos: string[];
  sirve_vinos: boolean;
  website: null;
  estado_negocio: string | null;
  es_cliente_cupra: false;
}

const getAddressComponent = (place: GooglePlace, ...wantedTypes: string[]): string | null => {
  const component = place.addressComponents?.find((item) =>
    item.types?.some((type) => wantedTypes.includes(type))
  );
  return component?.longText || component?.shortText || null;
};

async function discoverProspectsFromGoogle(
  apiKey: string,
  zones: string[],
  targetCount: number,
  excludedPlaceIds: Set<string>,
  existingClientNames: Set<string>,
): Promise<DiscoveredProspect[]> {
  const discovered: DiscoveredProspect[] = [];
  const seenIds = new Set(excludedPlaceIds);
  const targetWithBuffer = Math.min(Math.max(targetCount + 8, 20), 100);
  const requestedZones = Array.from(new Set(zones.map((zone) => zone.trim()).filter(Boolean))).slice(0, 6);
  const zoneWaves = requestedZones.length > 0
    ? [requestedZones, ["Ciudad Autónoma de Buenos Aires"]]
    : [["Ciudad Autónoma de Buenos Aires"]];
  const searches = [
    { query: "vinoteca premium", includedType: "liquor_store" },
    { query: "wine bar", includedType: "wine_bar" },
    { query: "restaurante de vinos premium", includedType: "restaurant" },
    { query: "bar de vinos", includedType: "bar" },
  ];

  for (const zoneWave of zoneWaves) {
    for (const search of searches) {
      for (const zone of zoneWave) {
        const gatewayKey = Deno.env.get("LOVABLE_API_KEY") || "";
        const response = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${gatewayKey}`,
            "X-Connection-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_PROSPECT_FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: `${search.query}, ${zone}, Ciudad Autónoma de Buenos Aires, Argentina`,
            pageSize: 20,
            languageCode: "es",
            regionCode: "AR",
            includedType: search.includedType,
            strictTypeFiltering: true,
            locationRestriction: { rectangle: CABA_VIEWPORT },
          }),
        });


        const payload = await response.json() as GoogleTextSearchResponse;
        if (!response.ok) {
          const googleMessage = payload.error?.message || "respuesta inválida";
          console.error(`Google Places ${response.status}:`, googleMessage);
          if ([400, 401, 403, 429].includes(response.status)) {
            throw new Error(`Google Places rechazó la búsqueda (${response.status}): ${googleMessage}`);
          }
          continue;
        }

        for (const place of payload.places || []) {
          const placeId = place.id || "";
          const nombre = place.displayName?.text?.trim() || "";
          const latitud = Number(place.location?.latitude);
          const longitud = Number(place.location?.longitude);
          if (!placeId || !nombre || !Number.isFinite(latitud) || !Number.isFinite(longitud)) continue;
          if (place.businessStatus === "CLOSED_PERMANENTLY" || seenIds.has(placeId)) continue;
          if (existingClientNames.has(normalizeName(nombre))) continue;

          const barrio = getAddressComponent(place, "neighborhood", "sublocality_level_1", "sublocality");
          const comunaCandidate = getAddressComponent(place, "administrative_area_level_2");
          const types = place.types || [];

          discovered.push({
            place_id: placeId,
            nombre,
            telefono: null,
            direccion: place.formattedAddress || `${nombre}, Ciudad Autónoma de Buenos Aires`,
            barrio,
            comuna: comunaCandidate?.toLowerCase().startsWith("comuna") ? comunaCandidate : null,
            ciudad: "Ciudad Autónoma de Buenos Aires",
            provincia: "Ciudad Autónoma de Buenos Aires",
            latitud,
            longitud,
            rating: Number(place.rating || 0),
            total_ratings: Number(place.userRatingCount || 0),
            nivel_precio: place.priceLevel || null,
            tipo_principal: place.primaryType || null,
            tipos: types,
            sirve_vinos: types.includes("wine_bar") || types.includes("liquor_store"),
            website: null,
            estado_negocio: place.businessStatus || null,
            es_cliente_cupra: false,
          });
          seenIds.add(placeId);
        }
        if (discovered.length >= targetWithBuffer) break;
      }
      if (discovered.length >= targetWithBuffer) break;
    }
    if (discovered.length >= targetWithBuffer) break;
  }

  return discovered;
}

function isWithinRadius(
  lat: number | null,
  lng: number | null,
  center: AnchorPoint | null,
  maxDistanceKm: number,
): boolean {
  if (!center) return true;
  if (lat === null || lng === null) return false;
  return calcularDistanciaKm(center.lat, center.lng, lat, lng) <= maxDistanceKm;
}

function calculateCentroid(points: AnchorPoint[]): AnchorPoint | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

// Find the densest cluster: the point with the most neighbors within clusterRadius
function findDensestHotspot(points: AnchorPoint[], clusterRadius: number = 2.0): AnchorPoint | null {
  if (points.length === 0) return null;
  if (points.length <= 3) return calculateCentroid(points);

  let bestPoint: AnchorPoint | null = null;
  let bestCount = 0;
  let bestNeighbors: AnchorPoint[] = [];

  for (const p of points) {
    const neighbors = points.filter(q =>
      calcularDistanciaKm(p.lat, p.lng, q.lat, q.lng) <= clusterRadius
    );
    if (neighbors.length > bestCount) {
      bestCount = neighbors.length;
      bestPoint = p;
      bestNeighbors = neighbors;
    }
  }

  // Return centroid of the densest cluster (smoother than a single point)
  return bestNeighbors.length > 0 ? calculateCentroid(bestNeighbors) : bestPoint;
}

function buildSellerNameMap(vendedoresData: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of vendedoresData) {
    map.set(v.nombre.toUpperCase().trim(), v.user_id);
    const normalized = v.nombre.toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    map.set(normalized, v.user_id);
  }
  return map;
}

function resolveSellerUUID(sellerName: string | null, nameMap: Map<string, string>): string | null {
  if (!sellerName) return null;
  const upper = sellerName.toUpperCase().trim();
  if (nameMap.has(upper)) return nameMap.get(upper)!;
  const normalized = upper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (nameMap.has(normalized)) return nameMap.get(normalized)!;
  for (const [key, uuid] of nameMap) {
    if (key.includes(upper) || upper.includes(key)) return uuid;
  }
  return null;
}

function normalizeName(name: string): string {
  return name.toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9\s]/g, "");
}

function nameTokenOverlap(name1: string, name2: string): number {
  const tokens1 = new Set(normalizeName(name1).split(/\s+/).filter(t => t.length > 2));
  const tokens2 = new Set(normalizeName(name2).split(/\s+/).filter(t => t.length > 2));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  let overlap = 0;
  for (const t of tokens1) { if (tokens2.has(t)) overlap++; }
  return overlap / Math.min(tokens1.size, tokens2.size);
}

// ============================================================
// CLIENT STATE CLASSIFICATION
// ============================================================

type EstadoComercial = 'ACTIVO' | 'INACTIVO' | 'PERDIDO' | 'POTENCIAL';

function classifyEstado(diasDesdeUltimaCompra: number | null): 'ACTIVO' | 'INACTIVO' | 'PERDIDO' {
  if (diasDesdeUltimaCompra === null) return 'PERDIDO';
  if (diasDesdeUltimaCompra <= 30) return 'ACTIVO';
  if (diasDesdeUltimaCompra <= 90) return 'INACTIVO';
  return 'PERDIDO';
}

// ============================================================
// VENDOR AFFILIATION CHECK (strict)
// ============================================================

function isClientAffiliated(cliente: any, vendedorUserId: string, sellerNameMap: Map<string, string>): boolean {
  const actualUUID = resolveSellerUUID(cliente.vendedor_actual, sellerNameMap);
  if (actualUUID === vendedorUserId) return true;
  const principalUUID = resolveSellerUUID(cliente.vendedor_principal, sellerNameMap);
  if (principalUUID === vendedorUserId) return true;
  const todosVendedores = cliente.todos_vendedores || [];
  for (const v of todosVendedores) {
    if (resolveSellerUUID(v, sellerNameMap) === vendedorUserId) return true;
  }
  return false;
}

// ============================================================
// SCORED CANDIDATE TYPE
// ============================================================

interface ScoredCandidate {
  client_id: string;
  identity_key: string;
  razon_social: string;
  es_prospecto: boolean;
  estado_comercial: EstadoComercial;
  score_geo: number;
  score_comercial: number;
  score_rotacion: number;
  score_vendedor: number;
  score_total: number;
  distancia_km: number;
  lat: number | null;
  long: number | null;
  barrio: string | null;
  direccion: string | null;
  vendedor_actual: string | null;
  vendedor_principal: string | null;
  vendedor_anterior: string | null;
  dias_desde_ultima_compra: number | null;
  ticket_promedio: number | null;
  monto_total_historico: number | null;
  categoria_volumen: string | null;
  score_comercial_raw: number | null;
  feedbacks_recientes: any[];
  tipo_negocio?: string | null;
  rating?: number | null;
}

// ============================================================
// SCORING — v11-exact-eight
// Candidates are scored inside the radius requested by each selection wave.
// ============================================================

function scoreClients(
  clientes: any[],
  placesMap: Map<string, any>,
  feedbacksMap: Map<string, any[]>,
  vendedorUserId: string,
  sellerNameMap: Map<string, string>,
  hotspot: AnchorPoint,
  radiusKm: number,
  otherAnchors: AnchorPoint[],
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  for (const c of clientes) {
    const place = placesMap.get(c.client_id);
    const lat = place?.lat ? Number(place.lat) : null;
    const long = place?.long ? Number(place.long) : null;

    // HARD radius filter — always applied
    if (!isWithinRadius(lat, long, hotspot, radiusKm)) continue;

    const estado = classifyEstado(c.dias_desde_ultima_compra);
    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long) {
      distancia_km = calcularDistanciaKm(hotspot.lat, hotspot.lng, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km / radiusKm) * 100);
    }

    let overlapPenalty = 0;
    if (lat && long && otherAnchors.length > 0) {
      const minDistOther = Math.min(...otherAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      if (minDistOther < 0.3) overlapPenalty = -100;
    }

    const rawScore = c.score_comercial ?? 0;
    const score_comercial = Math.min(100, (rawScore / 5) * 100);

    let score_rotacion = 100;
    if (c.last_recommendation_at) {
      const daysSinceRec = (Date.now() - new Date(c.last_recommendation_at).getTime()) / (1000 * 60 * 60 * 24);
      score_rotacion = Math.min(100, daysSinceRec * 5);
    }

    const isOwn = isClientAffiliated(c, vendedorUserId, sellerNameMap);
    const score_vendedor = isOwn ? 100 : 0;

    let vendedor_anterior: string | null = null;
    if (c.vendedor_actual && c.vendedor_principal &&
      c.vendedor_actual.toUpperCase() !== c.vendedor_principal.toUpperCase()) {
      vendedor_anterior = c.vendedor_principal;
    }

    const feedbacks = feedbacksMap.get(c.client_id) || [];
    const hasNegativeFeedback = feedbacks.some((fb: any) =>
      fb.feedback?.toLowerCase().includes("no volver") ||
      fb.feedback?.toLowerCase().includes("cerrado") ||
      fb.motivo_no_visita?.toLowerCase().includes("cerrado")
    );
    if (hasNegativeFeedback) continue;

    const score_total = score_geo * 0.50 + score_vendedor * 0.25 + score_comercial * 0.15 + score_rotacion * 0.10 + overlapPenalty;

    candidates.push({
      client_id: c.client_id,
      identity_key: buildIdentityKey({
        esProspecto: false,
        cuit: c.cuit_dni,
        nombre: c.razon_social || c.fantasia,
        direccion: place?.direccion_principal || c.direccion_principal,
        lat, long,
      }),
      razon_social: c.razon_social || c.fantasia || 'Sin nombre',
      es_prospecto: false,
      estado_comercial: estado,
      score_geo: Math.round(score_geo),
      score_comercial: Math.round(score_comercial),
      score_rotacion: Math.round(score_rotacion),
      score_vendedor: Math.round(score_vendedor),
      score_total: Math.round(score_total),
      distancia_km: Math.round(distancia_km * 10) / 10,
      lat, long,
      barrio: place?.barrio_principal || c.barrio_principal,
      direccion: place?.direccion_principal || c.direccion_principal,
      vendedor_actual: c.vendedor_actual || c.vendedor_principal,
      vendedor_principal: c.vendedor_principal,
      vendedor_anterior,
      dias_desde_ultima_compra: c.dias_desde_ultima_compra,
      ticket_promedio: c.ticket_promedio,
      monto_total_historico: c.monto_total_historico,
      categoria_volumen: c.categoria_volumen,
      score_comercial_raw: c.score_comercial,
      feedbacks_recientes: feedbacks.slice(0, 2).map((fb: any) => ({
        feedback: fb.feedback,
        tipo: fb.tipo_interaccion,
        fecha: fb.created_at?.split('T')[0],
      })),
    });
  }

  candidates.sort((a, b) => b.score_total - a.score_total);
  return candidates;
}

function scoreProspects(
  prospectos: any[],
  feedbacksMap: Map<string, any[]>,
  hotspot: AnchorPoint,
  radiusKm: number,
  otherAnchors: AnchorPoint[],
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  for (const p of prospectos) {
    const lat = p.latitud ? Number(p.latitud) : null;
    const long = p.longitud ? Number(p.longitud) : null;

    // HARD radius filter
    if (!isWithinRadius(lat, long, hotspot, radiusKm)) continue;

    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long) {
      distancia_km = calcularDistanciaKm(hotspot.lat, hotspot.lng, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km / radiusKm) * 100);
    }

    let overlapPenalty = 0;
    if (lat && long && otherAnchors.length > 0) {
      const minDistOther = Math.min(...otherAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      if (minDistOther < 0.3) overlapPenalty = -100;
    }

    const score_comercial = Math.min(100, (p.rating || 3) * 20);

    let score_rotacion = 100;
    if (p.last_recommendation_at) {
      const daysSinceRec = (Date.now() - new Date(p.last_recommendation_at).getTime()) / (1000 * 60 * 60 * 24);
      score_rotacion = Math.min(100, daysSinceRec * 5);
    }

    const feedbacks = feedbacksMap.get(p.place_id) || [];
    const hasNegativeFeedback = feedbacks.some((fb: any) =>
      fb.feedback?.toLowerCase().includes("no volver") ||
      fb.feedback?.toLowerCase().includes("cerrado")
    );
    if (hasNegativeFeedback) continue;

    // Prospects: geo dominates scoring (sorted by proximity to hotspot)
    const score_total = score_geo * 0.70 + score_comercial * 0.15 + score_rotacion * 0.15 + overlapPenalty;

    candidates.push({
      client_id: p.place_id,
      identity_key: buildIdentityKey({
        esProspecto: true,
        cuit: null,
        nombre: p.nombre,
        direccion: p.direccion,
        lat, long,
      }),
      razon_social: p.nombre,
      es_prospecto: true,
      estado_comercial: 'POTENCIAL',
      score_geo: Math.round(score_geo),
      score_comercial: Math.round(score_comercial),
      score_rotacion: Math.round(score_rotacion),
      score_vendedor: 0,
      score_total: Math.round(score_total),
      distancia_km: Math.round(distancia_km * 10) / 10,
      lat, long,
      barrio: p.barrio,
      direccion: p.direccion,
      vendedor_actual: null,
      vendedor_principal: null,
      vendedor_anterior: null,
      dias_desde_ultima_compra: null,
      ticket_promedio: null,
      monto_total_historico: null,
      categoria_volumen: "NUEVO",
      score_comercial_raw: null,
      feedbacks_recientes: feedbacks.slice(0, 2).map((fb: any) => ({
        feedback: fb.feedback,
        tipo: fb.tipo_interaccion,
        fecha: fb.created_at?.split('T')[0],
      })),
      tipo_negocio: p.tipo_principal,
      rating: p.rating,
    });
  }

  // Sort by distance (closest first) — prospects fill gaps
  candidates.sort((a, b) => a.distancia_km - b.distancia_km);
  return candidates;
}

// ============================================================
// SYSTEM PROMPT — v11-exact-eight
// ============================================================

function buildSystemPrompt(instrucciones_adicionales?: string): string {
  const base = `Eres el Planificador Estratégico de CUPRA. Tu misión es armar rutas de visita densas y caminables para vendedores de vinos premium.

CONTEXTO: Vendemos vinos en canales ON_TRADE (restaurantes/bares) y OFF_TRADE (vinotecas/retailers).

${instrucciones_adicionales ? `
═══════════════════════════════════════════════════════════
INSTRUCCIONES ADICIONALES DEL CLIENTE (aplican dentro de cada grupo):
${instrucciones_adicionales}

Usá estas instrucciones para ordenar candidatos dentro de cada grupo. Nunca antepongas prospectos mientras queden clientes internos elegibles.
═══════════════════════════════════════════════════════════
` : ''}
REGLAS DE COMPOSICIÓN:
1. CUOTA OBLIGATORIA: Seleccioná EXACTAMENTE 8 visitas por vendedor.
2. PRIORIDAD NO NEGOCIABLE: agota primero todos los clientes internos elegibles del vendedor.
3. Si hay menos de 8 clientes internos elegibles, completa los lugares faltantes con PROSPECTOS.
4. Nunca reemplaces un cliente interno elegible por un prospecto.
5. Dentro de los clientes, prioriza ACTIVOS e INACTIVOS y luego oportunidades de recuperación.
6. CONCENTRACIÓN GEOGRÁFICA: rutas densas, sin viajes largos innecesarios.
7. Los candidatos ya fueron filtrados por cartera y radio geográfico.
8. JUSTIFICACIÓN: para cada visita, explica brevemente por qué fue seleccionada.
9. NUNCA repitas el mismo client_id para distintos vendedores.

IMPORTANTE: Las instrucciones adicionales pueden ordenar candidatos dentro de cada grupo, pero no pueden anteponer prospectos mientras queden clientes internos elegibles.

FORMATO: Usá la tool "generate_recommendations" con la estructura indicada.`;
  return base;
}

// ============================================================
// POST-IA VALIDATION — v11-exact-eight
// Rules:
//   1. Return exactly 8 recommendations or fail the request.
//   2. ACTIVO/INACTIVO clients first, then the remaining internal clients.
//   3. PROSPECTOS fill only the slots left after internal clients are exhausted.
// ============================================================

function validateAndFill(
  aiRecs: any[],
  clientPool: ScoredCandidate[],
  prospectPool: ScoredCandidate[],
  vendedorId: string,
  globalPickedIds: Set<string>,
  globalPickedIdentities: Set<string> = new Set<string>(),
): any[] {
  // DEDUP DURO por identidad de negocio (CUIT o nombre+dirección):
  // evita que el mismo cliente aparezca 2 veces por registros duplicados en DB.
  const usedIdentities = new Set(globalPickedIdentities);
  clientPool = dedupeByIdentity(clientPool, usedIdentities);
  clientPool.forEach(c => usedIdentities.add(c.identity_key));
  prospectPool = dedupeByIdentity(prospectPool, usedIdentities);

  const allCandidates = new Map<string, ScoredCandidate>();
  [...clientPool, ...prospectPool].forEach(c => allCandidates.set(c.client_id, c));

  const aiRecommendationById = new Map<string, any>();
  for (const r of aiRecs) {
    if (r.vendedor_id !== vendedorId) continue;
    if (globalPickedIds.has(r.client_id)) continue;
    if (!allCandidates.has(r.client_id)) continue;
    if (!aiRecommendationById.has(r.client_id)) aiRecommendationById.set(r.client_id, r);
  }

  const orderedIds = composeRecommendationIds({
    preferredIds: Array.from(aiRecommendationById.keys()),
    clients: clientPool,
    prospects: prospectPool,
    unavailableIds: globalPickedIds,
  });
  const pickedIds = new Set(orderedIds);
  const isAvailable = (id: string) => !pickedIds.has(id) && !globalPickedIds.has(id);
  const result = orderedIds.map((candidateId) => {
    const aiRecommendation = aiRecommendationById.get(candidateId);
    if (aiRecommendation) return aiRecommendation;
    const candidate = allCandidates.get(candidateId)!;
    const recoveryReason = candidate.estado_comercial === 'PERDIDO'
      ? `Recuperación: ${candidate.razon_social} (${candidate.dias_desde_ultima_compra} días sin compra)`
      : undefined;
    return makeRec(candidate, vendedorId, recoveryReason);
  });

  const selectedClientCount = orderedIds.filter((candidateId) => !allCandidates.get(candidateId)?.es_prospecto).length;
  console.log(`   📋 Composición validada: ${selectedClientCount} clientes internos + ${result.length - selectedClientCount} prospectos`);

  // STEP 3: recovery preference never introduces a prospect or changes the
  // client-first composition; it only reorders internal-client choices.
  if (result.length >= 8) {
    // Ensure at least 1 recovery if available
    const hasRecovery = result.some(r => {
      const c = allCandidates.get(r.client_id);
      return c && !c.es_prospecto && (c.dias_desde_ultima_compra ?? 0) > 90;
    });
    const lostClients = clientPool.filter(c => c.estado_comercial === 'PERDIDO');

    if (!hasRecovery && lostClients.length > 0) {
      const recovery = lostClients.find(c => isAvailable(c.client_id));
      if (recovery) {
        // Swap out a prospect if possible, otherwise last entry
        const swapIdx = result.findIndex(r => allCandidates.get(r.client_id)?.es_prospecto);
        const idx = swapIdx >= 0 ? swapIdx : result.length - 1;
        pickedIds.delete(result[idx].client_id);
        result[idx] = makeRec(recovery, vendedorId, `Recuperación estratégica: ${recovery.razon_social} (${recovery.dias_desde_ultima_compra} días sin compra)`);
        pickedIds.add(recovery.client_id);
      }
    }

  }

  if (result.length < 8) {
    console.warn(`⚠️ ${vendedorId.slice(0, 8)}: Solo ${result.length}/8 recs posibles. Pools agotados (${clientPool.length}C + ${prospectPool.length}P disponibles).`);
  }

  return result.slice(0, 8);
}

function makeRec(c: ScoredCandidate, vendedorId: string, justificacion?: string): any {
  return {
    client_id: c.client_id,
    vendedor_id: vendedorId,
    prioridad: c.estado_comercial === 'ACTIVO' ? 'alta' : 'media',
    justificacion: justificacion || `Auto: ${c.razon_social} (${c.estado_comercial}) - Score ${c.score_total}, dist ${c.distancia_km}km`,
    score_final: c.score_total,
    factores: {
      score_comercial: c.score_comercial,
      score_recencia: c.score_rotacion,
      score_proximidad: c.score_geo,
      distancia_km: c.distancia_km,
      potencial_venta: c.monto_total_historico || 0,
    },
  };
}

// ============================================================
// MAIN HANDLER — v11-exact-eight
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const {
      vendedores,
      provincia,
      comuna,
      barrio,
      area_id,
      max_recomendaciones = 8,
      instrucciones_adicionales,
    } = await req.json();

    console.log("🔧 Version: v11-exact-eight");
    console.log("📥 Request:", { vendedores, provincia, comuna, barrio, area_id, max_recomendaciones });

    // ---- 1. Resolve area filters ----
    let vendedoresFinales = vendedores || [];
    let barriosFinales = barrio || [];
    let comunasFinales = comuna || [];

    if (area_id) {
      console.log("🗺️ Cargando área:", area_id);
      const { data: areaVendedores } = await supabaseClient
        .from("areas_vendedores").select("vendedor_id").eq("area_id", area_id);
      if (areaVendedores?.length) vendedoresFinales = areaVendedores.map(av => av.vendedor_id);

      const { data: areaPlaces } = await supabaseClient
        .from("areas_places").select("place_id, places(barrio_principal, comuna)").eq("area_id", area_id);
      if (areaPlaces?.length) {
        barriosFinales = areaPlaces.map((ap: any) => ap.places?.barrio_principal).filter(Boolean);
        comunasFinales = areaPlaces.map((ap: any) => ap.places?.comuna).filter(Boolean);
      }
    }

    // ---- 2. Load vendor profiles ----
    const { data: vendedoresData, error: vendedoresError } = await supabaseClient
      .from("profiles")
      .select("user_id, nombre, email, id")
      .or(`user_id.in.(${vendedoresFinales.join(",")}),id.in.(${vendedoresFinales.join(",")})`);

    if (vendedoresError) throw vendedoresError;
    if (!vendedoresData?.length) {
      return new Response(JSON.stringify({
        recomendaciones: [], resumen: { total_recomendaciones: 0, descripcion: "No se encontraron vendedores.", distribucion_por_vendedor: {}, zonas_priorizadas: [] }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`✅ Vendedores: ${vendedoresData.map(v => v.nombre).join(', ')}`);

    // ALL vendor profiles for name resolution
    const { data: allVendorProfiles } = await supabaseClient
      .from("profiles").select("user_id, nombre").eq("rol", "vendedor").eq("activo", true);
    const sellerNameMap = buildSellerNameMap(allVendorProfiles || vendedoresData);

    // ---- 3. Load client_places (geography) ----
    let placesQuery = supabaseClient.from("client_places").select("*").eq("is_primary", true);
    if (provincia && provincia !== "all") placesQuery = placesQuery.ilike("provincia_principal", `%${provincia}%`);

    const geoConditions: string[] = [];
    if (comunasFinales.length > 0) comunasFinales.forEach((c: string) => geoConditions.push(`comuna.ilike.%${c}%`));
    if (barriosFinales.length > 0) barriosFinales.forEach((b: string) => geoConditions.push(`barrio_principal.ilike.%${b}%`));
    if (geoConditions.length > 0) placesQuery = placesQuery.or(geoConditions.join(","));

    const { data: clientPlaces, error: placesError } = await placesQuery;
    if (placesError) throw placesError;

    const clientIdsEnZona = Array.from(new Set(clientPlaces?.map(p => p.client_id) || []));
    const placesMap = new Map();
    clientPlaces?.forEach(place => placesMap.set(place.client_id, place));

    console.log(`📍 client_places en zona: ${clientPlaces?.length || 0}, unique: ${clientIdsEnZona.length}`);

    // ---- 4. Load clients in zone ----
    let allClientesEnZona: any[] = [];
    if (clientIdsEnZona.length > 0) {
      const { data, error } = await supabaseClient
        .from("clientes").select("*")
        .in("client_id", clientIdsEnZona)
        .or("excluir_recomendaciones.is.null,excluir_recomendaciones.eq.false")
        .order("monto_total_historico", { ascending: false })
        .limit(500);
      if (error) throw error;
      allClientesEnZona = data || [];
    }

    // ---- 4b. Load vendor portfolio clients outside zone (for hotspot calculation) ----
    let portfolioClients: any[] = [];
    {
      const excludeFilter = clientIdsEnZona.length > 0 ? clientIdsEnZona.join(",") : "NONE";
      const { data: extraClients } = await supabaseClient
        .from("clientes").select("*")
        .or("excluir_recomendaciones.is.null,excluir_recomendaciones.eq.false")
        .not("vendedor_actual", "is", null)
        .not("client_id", "in", `(${excludeFilter})`)
        .order("monto_total_historico", { ascending: false })
        .limit(500);

      const selectedVendorIds = new Set(vendedoresData.map(v => v.user_id));
      portfolioClients = (extraClients || []).filter(c => {
        for (const vid of selectedVendorIds) {
          if (isClientAffiliated(c, vid, sellerNameMap)) return true;
        }
        return false;
      });

      if (portfolioClients.length > 0) {
        const extraIds = portfolioClients.map(c => c.client_id);
        const { data: extraPlaces } = await supabaseClient
          .from("client_places").select("*").in("client_id", extraIds).eq("is_primary", true);
        extraPlaces?.forEach(place => placesMap.set(place.client_id, place));
      }
    }

    // ---- 5. Exclude already assigned today ----
    const now = new Date();
    now.setHours(now.getUTCHours() - 3);
    const hoy = now.toISOString().split('T')[0];

    const { data: asignacionesHoy } = await supabaseClient
      .from("asignaciones_vendedores_clientes")
      .select("client_id, prospecto_place_id")
      .gte("created_at", `${hoy}T00:00:00`)
      .neq("estado", "Visitado");

    const clientesAsignadosHoy = new Set(asignacionesHoy?.filter(a => a.client_id).map(a => a.client_id) || []);
    const prospectosAsignadosHoy = new Set(asignacionesHoy?.filter(a => a.prospecto_place_id).map(a => a.prospecto_place_id) || []);
    allClientesEnZona = allClientesEnZona.filter(c => !clientesAsignadosHoy.has(c.client_id));
    portfolioClients = portfolioClients.filter(c => !clientesAsignadosHoy.has(c.client_id));

    // ---- 6. Load prospects ----
    let prospectosQuery = supabaseClient
      .from("prospectos").select("*")
      .eq("es_cliente_cupra", false)
      .order("last_recommendation_at", { ascending: true, nullsFirst: true })
      .limit(200);

    if (provincia && provincia !== "all") prospectosQuery = prospectosQuery.ilike("provincia", `%${provincia}%`);
    const geoConditionsP: string[] = [];
    if (comunasFinales.length > 0) comunasFinales.forEach((c: string) => geoConditionsP.push(`comuna.ilike.%${c}%`));
    if (barriosFinales.length > 0) barriosFinales.forEach((b: string) => geoConditionsP.push(`barrio.ilike.%${b}%`));
    if (geoConditionsP.length > 0) prospectosQuery = prospectosQuery.or(geoConditionsP.join(","));

    const { data: prospectosData, error: prospectosError } = await prospectosQuery;
    if (prospectosError) throw prospectosError;
    let prospectos = (prospectosData || []).filter(p => !prospectosAsignadosHoy.has(p.place_id));

    // ---- 6b. Semantic dedup: exclude prospects that match existing clients ----
    const clientNamesAndCoords: { name: string; lat: number; lng: number }[] = [];
    for (const c of allClientesEnZona) {
      const place = placesMap.get(c.client_id);
      if (place?.lat && place?.long) {
        clientNamesAndCoords.push({ name: c.razon_social || c.fantasia || '', lat: Number(place.lat), lng: Number(place.long) });
      }
    }

    prospectos = prospectos.filter(p => {
      if (p.client_id) return false;
      if (!p.latitud || !p.longitud) return true;
      const pLat = Number(p.latitud);
      const pLng = Number(p.longitud);
      for (const c of clientNamesAndCoords) {
        const dist = calcularDistanciaKm(c.lat, c.lng, pLat, pLng);
        if (dist < 0.1 && nameTokenOverlap(p.nombre, c.name) >= 0.4) return false;
      }
      return true;
    });

    // If the internal portfolio cannot cover 8 visits per seller, discover
    // enough new prospects now and persist them in the operational repository.
    // Estimate the real shortage using only internal clients that can be routed
    // (valid coordinates) and without counting a shared client twice.
    const reservedInternalIds = new Set<string>();
    let totalClientDeficit = 0;
    for (const vendedor of vendedoresData) {
      const eligibleIds = allClientesEnZona
        .filter((cliente) => isClientAffiliated(cliente, vendedor.user_id, sellerNameMap))
        .filter((cliente) => (cliente.cantidad_ordenes && cliente.cantidad_ordenes > 0) || cliente.vendedor_actual)
        .filter((cliente) => {
          const place = placesMap.get(cliente.client_id);
          const lat = Number(place?.lat);
          const lng = Number(place?.long);
          return Number.isFinite(lat) && Number.isFinite(lng)
            && lat >= -60 && lat <= -20 && lng >= -80 && lng <= -40;
        })
        .map((cliente) => cliente.client_id)
        .filter((clientId) => !reservedInternalIds.has(clientId));

      const reservedForVendor = eligibleIds.slice(0, 8);
      reservedForVendor.forEach((clientId) => reservedInternalIds.add(clientId));
      totalClientDeficit += 8 - reservedForVendor.length;
    }

    const missingProspects = Math.max(0, totalClientDeficit - prospectos.length);
    if (missingProspects > 0) {
      const googleApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")
        || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY")
        || "";
      if (!googleApiKey) {
        throw new Error(`Faltan ${missingProspects} prospectos para completar 8 y Google Maps no está configurado.`);
      }

      const excludedPlaceIds = new Set<string>([
        ...prospectos.map((prospecto) => prospecto.place_id),
        ...Array.from(prospectosAsignadosHoy).filter((id): id is string => typeof id === "string"),
      ]);
      for (const place of clientPlaces || []) {
        const link = String(place.google_maps_link || "");
        const placeId = link.match(/[?&]query_place_id=([^&]+)/)?.[1];
        if (placeId) excludedPlaceIds.add(decodeURIComponent(placeId));
      }

      const existingClientNames = new Set(
        [...allClientesEnZona, ...portfolioClients]
          .map((cliente) => normalizeName(cliente.razon_social || cliente.fantasia || ""))
          .filter(Boolean),
      );
      const discoveryZones = [
        ...barriosFinales.map((value: string) => String(value)),
        ...comunasFinales.map((value: string) => String(value)),
      ];

      const discovered = await discoverProspectsFromGoogle(
        googleApiKey,
        discoveryZones,
        missingProspects,
        excludedPlaceIds,
        existingClientNames,
      );
      const newProspects = discovered.filter((prospecto) => !clientNamesAndCoords.some((cliente) => (
        calcularDistanciaKm(cliente.lat, cliente.lng, prospecto.latitud, prospecto.longitud) < 0.1
        && nameTokenOverlap(prospecto.nombre, cliente.name) >= 0.4
      )));

      if (newProspects.length > 0) {
        const { error: discoveryUpsertError } = await supabaseClient
          .from("prospectos")
          .upsert(newProspects, { onConflict: "place_id" });
        if (discoveryUpsertError) {
          throw new Error(`No se pudieron guardar los nuevos prospectos: ${discoveryUpsertError.message}`);
        }
        prospectos = [...prospectos, ...newProspects];
        console.log(`🔎 Google Maps agregó ${newProspects.length} prospectos al repositorio operativo.`);
      }
    }

    console.log(`🆕 Prospectos disponibles: ${prospectos.length}`);

    // ---- 7. Zone center fallback ----
    // Priority: client_places centroid; if none, use prospects centroid
    const clientZoneCoords: AnchorPoint[] = (clientPlaces || [])
      .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.long) }))
      .filter((p: AnchorPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -60 && p.lat <= -20 && p.lng >= -80 && p.lng <= -40);

    const prospectZoneCoords: AnchorPoint[] = (prospectos || [])
      .map((p: any) => ({ lat: Number(p.latitud), lng: Number(p.longitud) }))
      .filter((p: AnchorPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -60 && p.lat <= -20 && p.lng >= -80 && p.lng <= -40);

    const zoneCoords = clientZoneCoords.length > 0 ? clientZoneCoords : prospectZoneCoords;
    const zoneCenterFallback = calculateCentroid(zoneCoords);
    if (zoneCenterFallback) {
      const source = clientZoneCoords.length > 0 ? "clientes" : "prospectos";
      console.log(`🎯 Zone center fallback (${source}): ${zoneCenterFallback.lat.toFixed(4)}, ${zoneCenterFallback.lng.toFixed(4)}`);
    }

    if (allClientesEnZona.length === 0 && portfolioClients.length === 0 && prospectos.length === 0) {
      return new Response(JSON.stringify({
        recomendaciones: [], resumen: { total_recomendaciones: 0, descripcion: "No se encontraron candidatos en la zona.", distribucion_por_vendedor: {}, zonas_priorizadas: [] }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- 8. Load feedbacks ----
    const { data: feedbacks } = await supabaseClient
      .from("cliente_feedbacks")
      .select("client_id, prospecto_place_id, vendedor_id, visita_realizada, feedback, motivo_no_visita, tipo_interaccion, created_at")
      .order("created_at", { ascending: false });

    const feedbacksMapClientes = new Map<string, any[]>();
    const feedbacksMapProspectos = new Map<string, any[]>();
    feedbacks?.forEach(fb => {
      if (fb.client_id) {
        if (!feedbacksMapClientes.has(fb.client_id)) feedbacksMapClientes.set(fb.client_id, []);
        feedbacksMapClientes.get(fb.client_id)!.push(fb);
      }
      if (fb.prospecto_place_id) {
        if (!feedbacksMapProspectos.has(fb.prospecto_place_id)) feedbacksMapProspectos.set(fb.prospecto_place_id, []);
        feedbacksMapProspectos.get(fb.prospecto_place_id)!.push(fb);
      }
    });

    // ============================================================
    // 9. PER-VENDOR: Hotspot → Hard radius → Pool 1 + Pool 2
    // ============================================================
    const vendorClientPools: Map<string, ScoredCandidate[]> = new Map();
    const vendorProspectPools: Map<string, ScoredCandidate[]> = new Map();
    const vendorHotspots: Map<string, AnchorPoint> = new Map();
    const extraProspectosLoaded: any[] = [];

    for (const vendedor of vendedoresData) {
      // === Filter vendor's own clients ===
      const myClientsInZone = allClientesEnZona.filter(c => isClientAffiliated(c, vendedor.user_id, sellerNameMap));
      const myValidClients = myClientsInZone.filter(c =>
        (c.cantidad_ordenes && c.cantidad_ordenes > 0) || c.vendedor_actual
      );

      console.log(`👤 ${vendedor.nombre}: ${myValidClients.length} clientes propios en zona`);

      // === HOTSPOT: Centroid of THIS vendor's clients with coords ===
      const vendorCoords: AnchorPoint[] = [];
      for (const c of myValidClients) {
        const place = placesMap.get(c.client_id);
        if (place?.lat && place?.long) {
          const lat = Number(place.lat);
          const lng = Number(place.long);
          if (lat >= -60 && lat <= -20 && lng >= -80 && lng <= -40) {
            vendorCoords.push({ lat, lng });
          }
        }
      }

      // Hotspot = densest cluster of vendor's own clients
      // FALLBACK: if vendor has no clients, use zone center (clients or prospects)
      const vendorHotspot = findDensestHotspot(vendorCoords, 2.0) || zoneCenterFallback;

      if (!vendorHotspot) {
        console.log(`⚠️ ${vendedor.nombre}: Sin hotspot ni fallback. Saltando.`);
        vendorClientPools.set(vendedor.user_id, []);
        vendorProspectPools.set(vendedor.user_id, []);
        continue;
      }

      vendorHotspots.set(vendedor.user_id, vendorHotspot);
      const isConquestMode = vendorCoords.length === 0;
      console.log(`🔥 ${vendedor.nombre}: Hotspot ${vendorHotspot.lat.toFixed(4)}, ${vendorHotspot.lng.toFixed(4)}${isConquestMode ? ' (MODO CONQUISTA — fallback a centro de zona/prospectos)' : ` (${vendorCoords.length} clientes propios)`}`);

      // === Other vendors' hotspots for overlap penalty ===
      const otherHotspots = [...vendorHotspots.entries()]
        .filter(([id]) => id !== vendedor.user_id)
        .map(([, h]) => h);

      // === POOL 1: Clients within HARD_RADIUS_KM of hotspot ===
      let clientPool = scoreClients(
        myValidClients, placesMap, feedbacksMapClientes,
        vendedor.user_id, sellerNameMap,
        vendorHotspot, HARD_RADIUS_KM, otherHotspots,
      );

      // === POOL 2: Prospects within HARD_RADIUS_KM of hotspot ===
      let prospectPool = scoreProspects(
        prospectos, feedbacksMapProspectos,
        vendorHotspot, HARD_RADIUS_KM, otherHotspots,
      );

      console.log(`📊 ${vendedor.nombre}: ${clientPool.length} clientes + ${prospectPool.length} prospectos en radio ${HARD_RADIUS_KM}km`);

      // === CLIENT EXPANSION: exhaust internal clients before prospecting ===
      const expansionRadii = [MAX_EXPANSION_KM, ...EXPANSION_STEPS_KM];
      for (const expandRadius of expansionRadii) {
        if (clientPool.length >= 8) break;

        console.log(`⚠️ ${vendedor.nombre}: Solo ${clientPool.length} clientes internos. Expandiendo clientes a ${expandRadius}km...`);
        const existingClientIds = new Set(clientPool.map(c => c.client_id));

        const extraClientPool = scoreClients(
          myValidClients, placesMap, feedbacksMapClientes,
          vendedor.user_id, sellerNameMap,
          vendorHotspot, expandRadius, otherHotspots,
        ).filter(c => !existingClientIds.has(c.client_id));

        if (extraClientPool.length > 0) {
          clientPool = [...clientPool, ...extraClientPool];
          console.log(`🆕 ${vendedor.nombre}: +${extraClientPool.length} clientes en ${expandRadius}km`);
        }
      }

      // If fewer than 8 clients fit the walking radii, evaluate every routed
      // internal client in the selected zone before allowing any prospect.
      if (clientPool.length < 8) {
        const existingClientIds = new Set(clientPool.map(c => c.client_id));
        const remainingZoneClients = scoreClients(
          myValidClients, placesMap, feedbacksMapClientes,
          vendedor.user_id, sellerNameMap,
          vendorHotspot, ZONE_FALLBACK_MAX_KM, otherHotspots,
        )
          .filter(c => !existingClientIds.has(c.client_id))
          .sort((a, b) => a.distancia_km - b.distancia_km)
          .slice(0, Math.max(0, 8 - clientPool.length));
        clientPool = [...clientPool, ...remainingZoneClients];
        if (remainingZoneClients.length > 0) {
          console.log(`🆕 ${vendedor.nombre}: +${remainingZoneClients.length} clientes del resto de la zona (≤${ZONE_FALLBACK_MAX_KM}km)`);
        }
      }

      // === PROSPECT EXPANSION: only for the slots clients could not cover ===
      let currentTotal = clientPool.length + prospectPool.length;
      for (const expandRadius of expansionRadii) {
        if (currentTotal >= 8) break;

        console.log(`⚠️ ${vendedor.nombre}: Faltan ${8 - currentTotal} visitas. Expandiendo prospectos a ${expandRadius}km...`);
        const existingIds = new Set([...clientPool, ...prospectPool].map(c => c.client_id));

        const degPerKm = 0.009; // ~1km in degrees
        const deltaLat = expandRadius * degPerKm;
        const deltaLng = expandRadius * degPerKm * 1.2; // longitude correction

        const { data: geoProspectos } = await supabaseClient
          .from("prospectos").select("*")
          .eq("es_cliente_cupra", false)
          .gte("latitud", vendorHotspot.lat - deltaLat)
          .lte("latitud", vendorHotspot.lat + deltaLat)
          .gte("longitud", vendorHotspot.lng - deltaLng)
          .lte("longitud", vendorHotspot.lng + deltaLng)
          .order("rating", { ascending: false })
          .limit(50);

        const extraFiltered = (geoProspectos || []).filter(p =>
          !prospectosAsignadosHoy.has(p.place_id) &&
          !existingIds.has(p.place_id) &&
          !p.client_id
        );

        extraProspectosLoaded.push(...extraFiltered);

        const extraScored = scoreProspects(
          extraFiltered, feedbacksMapProspectos,
          vendorHotspot, expandRadius, otherHotspots,
        ).filter(c => !existingIds.has(c.client_id));

        prospectPool = [...prospectPool, ...extraScored];
        currentTotal = clientPool.length + prospectPool.length;
        console.log(`🆕 ${vendedor.nombre}: +${extraScored.length} prospectos en ${expandRadius}km. Total: ${clientPool.length}C + ${prospectPool.length}P`);
      }

      // === FINAL FALLBACK: if still < 8, score best prospects in whole selected zone ===
      currentTotal = clientPool.length + prospectPool.length;
      if (currentTotal < 8) {
        console.log(`🚨 ${vendedor.nombre}: Solo ${currentTotal} candidatos tras expansión. Buscando mejores prospectos de toda la zona...`);
        const existingIds = new Set([...clientPool, ...prospectPool].map(c => c.client_id));
        const needed = 8 - currentTotal;

        let fallbackQuery = supabaseClient
          .from("prospectos")
          .select("*")
          .eq("es_cliente_cupra", false)
          .order("rating", { ascending: false })
          .limit(Math.max(needed * 8, 80));

        if (provincia && provincia !== "all") {
          fallbackQuery = fallbackQuery.ilike("provincia", `%${provincia}%`);
        }

        const geoConditionsFallback: string[] = [];
        if (comunasFinales.length > 0) comunasFinales.forEach((c: string) => geoConditionsFallback.push(`comuna.ilike.%${c}%`));
        if (barriosFinales.length > 0) barriosFinales.forEach((b: string) => geoConditionsFallback.push(`barrio.ilike.%${b}%`));
        if (geoConditionsFallback.length > 0) {
          fallbackQuery = fallbackQuery.or(geoConditionsFallback.join(","));
        }

        const { data: fallbackProspectos } = await fallbackQuery;

        const fallbackById = new Map<string, any>();
        [...prospectos, ...(fallbackProspectos || [])].forEach((prospecto) => {
          if (prospecto?.place_id && !fallbackById.has(prospecto.place_id)) {
            fallbackById.set(prospecto.place_id, prospecto);
          }
        });
        const fallbackFiltered = Array.from(fallbackById.values()).filter(p =>
          !prospectosAsignadosHoy.has(p.place_id) &&
          !existingIds.has(p.place_id) &&
          !p.client_id
        );

        extraProspectosLoaded.push(...fallbackFiltered);

        // Radio acotado: la zona se evalúa por score pero sin salir del área caminable ampliada
        const fallbackRadius = ZONE_FALLBACK_MAX_KM;
        const fallbackScored = scoreProspects(
          fallbackFiltered,
          feedbacksMapProspectos,
          vendorHotspot,
          fallbackRadius,
          otherHotspots,
        )
          .filter(c => !existingIds.has(c.client_id))
          .sort((a, b) => a.distancia_km - b.distancia_km)
          .slice(0, Math.max(0, 8 - currentTotal));

        prospectPool = [...prospectPool, ...fallbackScored];
        currentTotal = clientPool.length + prospectPool.length;
        console.log(`🆕 ${vendedor.nombre}: +${fallbackScored.length} prospectos global fallback. Total final: ${clientPool.length}C + ${prospectPool.length}P`);
      }

      // === LIVE DISCOVERY: si el repositorio no alcanza, buscamos prospectos
      // nuevos en Google Maps dentro del barrio/comuna pedido y los guardamos ===
      currentTotal = clientPool.length + prospectPool.length;
      if (currentTotal < 8) {
        const googleApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")
          || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY")
          || "";
        if (!googleApiKey) {
          console.warn(`⚠️ ${vendedor.nombre}: faltan ${8 - currentTotal} candidatos y Google Maps no está configurado.`);
        } else {
          const existingIds = new Set([...clientPool, ...prospectPool].map(c => c.client_id));
          const excludedPlaceIds = new Set<string>([
            ...existingIds,
            ...prospectos.map((p: any) => p.place_id),
            ...extraProspectosLoaded.map((p: any) => p.place_id),
            ...Array.from(prospectosAsignadosHoy).filter((id): id is string => typeof id === "string"),
          ]);
          const existingClientNames = new Set(
            [...allClientesEnZona, ...portfolioClients]
              .map((cliente: any) => normalizeName(cliente.razon_social || cliente.fantasia || ""))
              .filter(Boolean),
          );
          const discoveryZones = [
            ...barriosFinales.map((value: string) => String(value)),
            ...comunasFinales.map((value: string) => String(value)),
          ];

          try {
            const discovered = await discoverProspectsFromGoogle(
              googleApiKey,
              discoveryZones,
              (8 - currentTotal) + 8,
              excludedPlaceIds,
              existingClientNames,
            );
            const newProspects = discovered.filter((prospecto) => !clientNamesAndCoords.some((cliente) => (
              calcularDistanciaKm(cliente.lat, cliente.lng, prospecto.latitud, prospecto.longitud) < 0.1
              && nameTokenOverlap(prospecto.nombre, cliente.name) >= 0.4
            )));

            if (newProspects.length > 0) {
              const { error: liveUpsertError } = await supabaseClient
                .from("prospectos")
                .upsert(newProspects, { onConflict: "place_id" });
              if (liveUpsertError) {
                console.error(`No se pudieron guardar los prospectos descubiertos: ${liveUpsertError.message}`);
              } else {
                extraProspectosLoaded.push(...newProspects);
                const liveScored = scoreProspects(
                  newProspects, feedbacksMapProspectos,
                  vendorHotspot, 100, otherHotspots,
                ).filter(c => !existingIds.has(c.client_id));
                prospectPool = [...prospectPool, ...liveScored];
                currentTotal = clientPool.length + prospectPool.length;
                console.log(`🔎 ${vendedor.nombre}: +${liveScored.length} prospectos nuevos desde Google Maps. Total: ${clientPool.length}C + ${prospectPool.length}P`);
              }
            }
          } catch (discoveryError) {
            console.error(`Google discovery falló para ${vendedor.nombre}:`, discoveryError);
          }
        }
      }



      // Cercanía primero: dentro de cada grupo la ruta arranca por lo más próximo.
      clientPool.sort((a, b) => a.distancia_km - b.distancia_km);
      prospectPool.sort((a, b) => a.distancia_km - b.distancia_km);
      vendorClientPools.set(vendedor.user_id, clientPool);
      vendorProspectPools.set(vendedor.user_id, prospectPool);
    }

    // ============================================================
    // 10. BUILD PROMPT
    // ============================================================
    const formatCandidate = (c: ScoredCandidate, i: number) =>
      `${i + 1}. [${c.client_id}] ${c.razon_social} | estado:${c.estado_comercial} | score:${c.score_total} | dist:${c.distancia_km}km | barrio:${c.barrio || '?'} | días_sin_compra:${c.dias_desde_ultima_compra ?? 'N/A'} | ticket:$${c.ticket_promedio ?? 0}${c.tipo_negocio ? ` | tipo:${c.tipo_negocio}` : ''}${c.feedbacks_recientes.length > 0 ? ` | feedbacks: ${c.feedbacks_recientes.map(f => f.feedback).join('; ')}` : ''}`;

    const vendorSections = vendedoresData.map(v => {
      const clients = vendorClientPools.get(v.user_id) || [];
      const prospects = vendorProspectPools.get(v.user_id) || [];
      const hotspot = vendorHotspots.get(v.user_id);

      return `
### VENDEDOR: ${v.nombre} (ID: ${v.user_id})
Hotspot: ${hotspot ? `${hotspot.lat.toFixed(4)}, ${hotspot.lng.toFixed(4)}` : 'N/A'} | Radio: ${HARD_RADIUS_KM}km
Elegí 8 visitas. PRIORIDAD: clientes existentes primero, prospectos solo para completar.
Si hay clientes con >90 días sin compra, incluí al menos 1 para recuperación.

CLIENTES DE LA CARTERA (${clients.length} — priorizá estos):
${clients.length > 0 ? clients.map(formatCandidate).join('\n') : '(sin clientes en zona)'}

PROSPECTOS DISPONIBLES (${prospects.length} — solo para completar):
${prospects.length > 0 ? prospects.slice(0, 15).map(formatCandidate).join('\n') : '(sin prospectos disponibles)'}`;
    }).join('\n\n');

    const hasCustomInstructions = !!(instrucciones_adicionales && instrucciones_adicionales.trim().length > 0);

    const prompt = `${hasCustomInstructions ? `
═══════════════════════════════════════════════════════════
⚡ INSTRUCCIONES ADICIONALES DEL CLIENTE:
${instrucciones_adicionales}
Aplicá estas instrucciones sin alterar la regla obligatoria: clientes internos primero y prospectos sólo para completar hasta 8.
═══════════════════════════════════════════════════════════
` : ''}${vendorSections}

TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor).
Cada client_id UNA SOLA VEZ en toda la respuesta. Concentración geográfica.${hasCustomInstructions ? `\nRECORDÁ: aplicá las instrucciones dentro de cada grupo, manteniendo clientes internos antes que prospectos.` : ' Priorizá clientes sobre prospectos.'}`;

    console.log(`📏 Prompt: ${prompt.length} chars`);

    // ============================================================
    // 11. CALL AI
    // ============================================================
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurado");

    console.log("🚀 Enviando a IA (gemini-2.5-flash)...");
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: buildSystemPrompt(instrucciones_adicionales) },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_recommendations",
            description: "Genera recomendaciones de visitas concentradas geográficamente, priorizando clientes existentes",
            parameters: {
              type: "object",
              properties: {
                recomendaciones: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      client_id: { type: "string" },
                      vendedor_id: { type: "string" },
                      prioridad: { type: "string", enum: ["alta", "media", "baja"] },
                      justificacion: { type: "string" },
                      score_final: { type: "number" },
                      factores: {
                        type: "object",
                        properties: {
                          score_comercial: { type: "number" },
                          score_recencia: { type: "number" },
                          score_proximidad: { type: "number" },
                          distancia_km: { type: "number" },
                          potencial_venta: { type: "number" },
                        },
                      },
                    },
                    required: ["client_id", "vendedor_id", "prioridad", "justificacion", "score_final", "factores"],
                  },
                },
                resumen_analisis: { type: "string" },
              },
              required: ["recomendaciones", "resumen_analisis"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_recommendations" } },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text().catch(() => "unreadable");
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: "Límite de consultas IA alcanzado." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`Lovable AI error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No se recibió tool call de la IA");

    const aiRecommendations = JSON.parse(toolCall.function.arguments);
    console.log(`🎯 IA seleccionó ${aiRecommendations.recomendaciones.length} recomendaciones`);

    // ============================================================
    // 12. VALIDATE + FILL — v11-exact-eight
    // ============================================================
    let validatedRecs: any[] = [];
    const globalPickedIds = new Set<string>();
    const globalPickedIdentities = new Set<string>();

    const googleApiKeyTopUp = Deno.env.get("GOOGLE_MAPS_API_KEY")
      || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY")
      || "";

    // Descubre prospectos nuevos en Google Maps para completar la cuota de 8
    // cuando el repositorio (ya descontando lo tomado por otros vendedores) no alcanza.
    const topUpFromGoogle = async (
      vendedorId: string,
      missing: number,
      takenIds: Set<string>,
    ): Promise<ScoredCandidate[]> => {
      if (!googleApiKeyTopUp || missing <= 0) return [];
      const hotspot = vendorHotspots.get(vendedorId) || zoneCenterFallback;
      if (!hotspot) return [];

      const otherHotspots = [...vendorHotspots.entries()]
        .filter(([id]) => id !== vendedorId)
        .map(([, h]) => h);

      const excludedPlaceIds = new Set<string>([
        ...takenIds,
        ...prospectos.map((p: any) => p.place_id),
        ...extraProspectosLoaded.map((p: any) => p.place_id),
        ...Array.from(prospectosAsignadosHoy).filter((id): id is string => typeof id === "string"),
      ]);
      const existingClientNames = new Set(
        [...allClientesEnZona, ...portfolioClients]
          .map((cliente: any) => normalizeName(cliente.razon_social || cliente.fantasia || ""))
          .filter(Boolean),
      );
      const discoveryZones = [
        ...barriosFinales.map((value: string) => String(value)),
        ...comunasFinales.map((value: string) => String(value)),
      ];

      try {
        const discovered = await discoverProspectsFromGoogle(
          googleApiKeyTopUp,
          discoveryZones,
          missing + 8,
          excludedPlaceIds,
          existingClientNames,
        );
        const newProspects = discovered.filter((prospecto) => !clientNamesAndCoords.some((cliente) => (
          calcularDistanciaKm(cliente.lat, cliente.lng, prospecto.latitud, prospecto.longitud) < 0.1
          && nameTokenOverlap(prospecto.nombre, cliente.name) >= 0.4
        )));
        if (newProspects.length === 0) return [];

        const { error: upsertError } = await supabaseClient
          .from("prospectos")
          .upsert(newProspects, { onConflict: "place_id" });
        if (upsertError) {
          console.error(`No se pudieron guardar los prospectos de top-up: ${upsertError.message}`);
          return [];
        }
        extraProspectosLoaded.push(...newProspects);

        const scored = scoreProspects(
          newProspects, feedbacksMapProspectos,
          hotspot, 100, otherHotspots,
        ).filter(c => !takenIds.has(c.client_id));
        console.log(`🔎 Top-up Google: +${scored.length} prospectos para completar cuota.`);
        return scored;
      } catch (discoveryError) {
        console.error(`Top-up Google falló:`, discoveryError);
        return [];
      }
    };

    for (const vendedor of vendedoresData) {
      let clientPool = (vendorClientPools.get(vendedor.user_id) || []).filter(c => !globalPickedIds.has(c.client_id));
      let prospectPool = (vendorProspectPools.get(vendedor.user_id) || []).filter(c => !globalPickedIds.has(c.client_id));

      const filteredAiRecs = aiRecommendations.recomendaciones.filter(
        (r: any) => !globalPickedIds.has(r.client_id)
      );

      let vendorRecs = validateAndFill(
        filteredAiRecs,
        clientPool,
        prospectPool,
        vendedor.user_id,
        globalPickedIds,
        globalPickedIdentities,
      );

      // Si tras el dedupe global no llegamos a 8, buscamos en Google Maps
      // con los criterios (barrios/comunas) y reintentamos.
      if (vendorRecs.length < 8) {
        const takenIds = new Set<string>([
          ...globalPickedIds,
          ...clientPool.map(c => c.client_id),
          ...prospectPool.map(c => c.client_id),
        ]);
        const extra = await topUpFromGoogle(vendedor.user_id, 8 - vendorRecs.length, takenIds);
        if (extra.length > 0) {
          prospectPool = [...prospectPool, ...extra];
          vendorProspectPools.set(vendedor.user_id, [
            ...(vendorProspectPools.get(vendedor.user_id) || []),
            ...extra,
          ]);
          vendorRecs = validateAndFill(
            filteredAiRecs,
            clientPool,
            prospectPool,
            vendedor.user_id,
            globalPickedIds,
            globalPickedIdentities,
          );
        }
      }


      if (vendorRecs.length === 0) {
        console.warn(`⚠️ ${vendedor.nombre}: sin candidatos disponibles (${clientPool.length}C / ${prospectPool.length}P). Se omite.`);
        continue;
      }
      if (vendorRecs.length < 8) {
        console.warn(
          `⚠️ Cuota parcial para ${vendedor.nombre}: ${vendorRecs.length}/8 `
          + `(${clientPool.length} clientes, ${prospectPool.length} prospectos disponibles).`,
        );
      }


      const vendorCandidateIndex = new Map<string, ScoredCandidate>();
      [...(vendorClientPools.get(vendedor.user_id) || []), ...(vendorProspectPools.get(vendedor.user_id) || [])]
        .forEach(c => { if (!vendorCandidateIndex.has(c.client_id)) vendorCandidateIndex.set(c.client_id, c); });
      vendorRecs.forEach((r: any) => {
        globalPickedIds.add(r.client_id);
        const key = vendorCandidateIndex.get(r.client_id)?.identity_key;
        if (key) globalPickedIdentities.add(key);
      });
      validatedRecs.push(...vendorRecs);

      // Log distribution
      const allCands = new Map<string, ScoredCandidate>();
      [...(vendorClientPools.get(vendedor.user_id) || []), ...(vendorProspectPools.get(vendedor.user_id) || [])].forEach(c => allCands.set(c.client_id, c));
      const dist = { clients: 0, prospects: 0, recovery: 0 };
      vendorRecs.forEach((r: any) => {
        const c = allCands.get(r.client_id);
        if (c?.es_prospecto) dist.prospects++;
        else {
          dist.clients++;
          if ((c?.dias_desde_ultima_compra ?? 0) > 90) dist.recovery++;
        }
      });
      console.log(`✅ ${vendedor.nombre}: ${vendorRecs.length} recs (${dist.clients}C/${dist.prospects}P, ${dist.recovery} recovery)`);
    }

    // ============================================================
    // 13. ENRICH & SAVE
    // ============================================================
    const request_id = crypto.randomUUID();
    const validVendedorIds = new Set(vendedoresData.map(v => v.user_id));
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const enrichedRecommendations: any[] = [];

    const vendedorNameLookup = new Map<string, string>();
    vendedoresData.forEach(v => vendedorNameLookup.set(v.user_id, v.nombre));

    const allClientes = [...allClientesEnZona, ...portfolioClients];
    const clienteLookup = new Map<string, any>();
    allClientes.forEach(c => { if (!clienteLookup.has(c.client_id)) clienteLookup.set(c.client_id, c); });

    const globalCandidateMap = new Map<string, ScoredCandidate>();
    for (const [, pool] of vendorClientPools) pool.forEach(c => { if (!globalCandidateMap.has(c.client_id)) globalCandidateMap.set(c.client_id, c); });
    for (const [, pool] of vendorProspectPools) pool.forEach(c => { if (!globalCandidateMap.has(c.client_id)) globalCandidateMap.set(c.client_id, c); });

    const allProspectosLookup = new Map<string, any>();
    prospectos.forEach(p => allProspectosLookup.set(p.place_id, p));
    extraProspectosLoaded.forEach(p => { if (!allProspectosLookup.has(p.place_id)) allProspectosLookup.set(p.place_id, p); });

    for (const rec of validatedRecs) {
      let vendedorId = rec.vendedor_id;
      if (!vendedorId || !uuidRegex.test(vendedorId) || !validVendedorIds.has(vendedorId)) {
        vendedorId = vendedoresData[0]?.user_id;
        if (!vendedorId) continue;
      }

      const vendedorNombre = vendedorNameLookup.get(vendedorId) || 'Desconocido';
      const clienteCompleto = clienteLookup.get(rec.client_id);
      const prospectoCompleto = !clienteCompleto ? allProspectosLookup.get(rec.client_id) : null;
      const candidateInfo = globalCandidateMap.get(rec.client_id);

      if (!clienteCompleto && !prospectoCompleto && !candidateInfo) {
        console.warn(`⚠️ Enrichment skip: ${rec.client_id} not found`);
        continue;
      }

      const esProspecto = !clienteCompleto;
      const place = !esProspecto ? placesMap.get(rec.client_id) : null;
      const estado_comercial = candidateInfo?.estado_comercial || (esProspecto ? 'POTENCIAL' : classifyEstado(clienteCompleto?.dias_desde_ultima_compra));

      if (esProspecto && prospectoCompleto) {
        enrichedRecommendations.push({
          request_id,
          client_id: null,
          prospecto_place_id: prospectoCompleto.place_id,
          vendedor_recomendado_id: vendedorId,
          vendedor_recomendado_nombre: vendedorNombre,
          razon_social: prospectoCompleto.nombre,
          cuit_dni: null,
          priority_score: Math.round(rec.score_final),
          score_geografico: Math.round(rec.factores?.score_proximidad || 0),
          ai_reasoning: rec.justificacion,
          factores_ia: { ...rec.factores, tipo_negocio: prospectoCompleto.tipo_principal, rating: prospectoCompleto.rating, website: prospectoCompleto.website },
          justificacion: rec.justificacion,
          es_prospecto: true,
          estado_comercial,
          monto_total_vendido: 0, orders_count: 0, avg_ticket: 0,
          first_purchase_at: null, last_purchase_at: null, days_since_last_purchase: null, participacion: 0,
          score_volumen_num: null, score_recencia_num: null,
          score_volumen: "NUEVO", score_recencia: "NUEVO", score_comercial: "NUEVO",
          lat: prospectoCompleto.latitud, long: prospectoCompleto.longitud,
          ciudades: [prospectoCompleto.ciudad], provincias: [prospectoCompleto.provincia],
          barrio_principal: prospectoCompleto.barrio,
          direccion_principal: prospectoCompleto.direccion,
          google_maps_link: `https://www.google.com/maps/search/?api=1&query=${prospectoCompleto.latitud},${prospectoCompleto.longitud}&query_place_id=${prospectoCompleto.place_id}`,
          vendedores: [], vendedor_principal: null,
          etiquetas: ["NUEVO", "PROSPECTO"],
          telefonos: prospectoCompleto.telefono ? [prospectoCompleto.telefono] : [],
          created_at: new Date().toISOString(),
          last_recomendation: new Date().toISOString(),
          ultima_sugerencia: new Date().toISOString(),
        });
      } else if (esProspecto && candidateInfo) {
        enrichedRecommendations.push({
          request_id,
          client_id: null,
          prospecto_place_id: candidateInfo.client_id,
          vendedor_recomendado_id: vendedorId,
          vendedor_recomendado_nombre: vendedorNombre,
          razon_social: candidateInfo.razon_social,
          cuit_dni: null,
          priority_score: Math.round(rec.score_final),
          score_geografico: Math.round(rec.factores?.score_proximidad || 0),
          ai_reasoning: rec.justificacion,
          factores_ia: { ...rec.factores, tipo_negocio: (candidateInfo as any).tipo_negocio, rating: (candidateInfo as any).rating },
          justificacion: rec.justificacion,
          es_prospecto: true,
          estado_comercial: candidateInfo.estado_comercial,
          monto_total_vendido: 0, orders_count: 0, avg_ticket: 0,
          first_purchase_at: null, last_purchase_at: null, days_since_last_purchase: null, participacion: 0,
          score_volumen_num: null, score_recencia_num: null,
          score_volumen: "NUEVO", score_recencia: "NUEVO", score_comercial: "NUEVO",
          lat: candidateInfo.lat, long: candidateInfo.long,
          ciudades: [], provincias: [],
          barrio_principal: candidateInfo.barrio,
          direccion_principal: candidateInfo.direccion,
          google_maps_link: candidateInfo.lat && candidateInfo.long ? `https://www.google.com/maps/search/?api=1&query=${candidateInfo.lat},${candidateInfo.long}` : null,
          vendedores: [], vendedor_principal: null,
          etiquetas: ["NUEVO", "PROSPECTO"],
          telefonos: [],
          created_at: new Date().toISOString(),
          last_recomendation: new Date().toISOString(),
          ultima_sugerencia: new Date().toISOString(),
        });
      } else if (clienteCompleto) {
        enrichedRecommendations.push({
          request_id,
          client_id: rec.client_id,
          prospecto_place_id: null,
          vendedor_recomendado_id: vendedorId,
          vendedor_recomendado_nombre: vendedorNombre,
          razon_social: clienteCompleto.razon_social,
          cuit_dni: clienteCompleto.cuit_dni,
          priority_score: Math.round(rec.score_final),
          score_geografico: Math.round(rec.factores?.score_proximidad || 0),
          ai_reasoning: rec.justificacion,
          factores_ia: rec.factores,
          justificacion: rec.justificacion,
          es_prospecto: false,
          estado_comercial,
          monto_total_vendido: clienteCompleto.monto_total_historico,
          orders_count: clienteCompleto.cantidad_ordenes,
          avg_ticket: clienteCompleto.ticket_promedio,
          first_purchase_at: clienteCompleto.primera_compra,
          last_purchase_at: clienteCompleto.ultima_compra,
          days_since_last_purchase: clienteCompleto.dias_desde_ultima_compra,
          participacion: clienteCompleto.participacion_mercado,
          score_volumen_num: clienteCompleto.score_volumen,
          score_recencia_num: clienteCompleto.score_recencia,
          score_volumen: clienteCompleto.categoria_volumen,
          score_recencia: clienteCompleto.categoria_recencia,
          score_comercial: clienteCompleto.score_comercial,
          lat: place?.lat || null, long: place?.long || null,
          ciudades: clienteCompleto.todas_ciudades || [clienteCompleto.ciudad_principal],
          provincias: [place?.provincia_principal || clienteCompleto.provincia_principal],
          barrio_principal: place?.barrio_principal || clienteCompleto.barrio_principal,
          direccion_principal: place?.direccion_principal || clienteCompleto.direccion_principal,
          google_maps_link: place?.google_maps_link || null,
          vendedores: clienteCompleto.todos_vendedores || [],
          vendedor_principal: clienteCompleto.vendedor_actual || clienteCompleto.vendedor_principal,
          etiquetas: clienteCompleto.etiquetas || [],
          telefonos: clienteCompleto.telefonos || [],
          created_at: new Date().toISOString(),
          last_recomendation: new Date().toISOString(),
          ultima_sugerencia: new Date().toISOString(),
        });
      }
    }

    const expectedRecommendationCount = vendedoresData.length * 8;
    const enrichedCountByVendor = new Map<string, number>();
    for (const recommendation of enrichedRecommendations) {
      enrichedCountByVendor.set(
        recommendation.vendedor_recomendado_id,
        (enrichedCountByVendor.get(recommendation.vendedor_recomendado_id) || 0) + 1,
      );
    }
    const incompleteVendors = vendedoresData.filter(
      (vendedor) => (enrichedCountByVendor.get(vendedor.user_id) || 0) !== 8,
    );
    if (enrichedRecommendations.length === 0) {
      throw new Error("No se encontraron candidatos disponibles para ningún vendedor con los filtros seleccionados.");
    }
    const cuotaIncompleta = incompleteVendors.length > 0
      ? `Cuota parcial: ${enrichedRecommendations.length}/${expectedRecommendationCount}. `
        + `Sin completar 8: ${incompleteVendors.map((v) => `${v.nombre} (${enrichedCountByVendor.get(v.user_id) || 0})`).join(', ')}.`
      : null;
    if (cuotaIncompleta) console.warn(`⚠️ ${cuotaIncompleta}`);


    // Save to DB
    const recommendationsForDb = enrichedRecommendations.map(({ lat, long, estado_comercial, vendedor_recomendado_nombre, ...rest }) => rest);
    const { error: insertError } = await supabaseClient.from("recomendaciones_ia").insert(recommendationsForDb);
    if (insertError) { console.error("❌ Error insertando:", insertError); throw insertError; }

    console.log(`✅ ${enrichedRecommendations.length} recomendaciones guardadas (v11-exact-eight)`);

    const distribucion: Record<string, number> = {};
    const zonas = new Set<string>();
    enrichedRecommendations.forEach(rec => {
      distribucion[rec.vendedor_recomendado_id] = (distribucion[rec.vendedor_recomendado_id] || 0) + 1;
      if (rec.barrio_principal) zonas.add(rec.barrio_principal);
    });

    return new Response(JSON.stringify({
      recomendaciones: enrichedRecommendations,
      resumen: {
        total_recomendaciones: enrichedRecommendations.length,
        descripcion: aiRecommendations.resumen_analisis,
        distribucion_por_vendedor: distribucion,
        zonas_priorizadas: Array.from(zonas).slice(0, 5),
        request_id,
        advertencia: cuotaIncompleta,

      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error("❌ Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Error desconocido",
      details: error instanceof Error ? error.stack : undefined,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
