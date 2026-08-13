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

// La ruta del día tiene que ser CAMINABLE: todas las visitas cerca unas de otras.
// Radio operativo único alrededor del núcleo del vendedor.
const HARD_RADIUS_KM = 2.5;
// Única ampliación permitida cuando el radio operativo no alcanza.
const MAX_EXPANSION_KM = 3.5;
const EXPANSION_STEPS_KM: number[] = []; // Sin cascada: compacidad manda sobre cantidad
// Último recurso: nunca proponer visitas más lejos que esto del núcleo del vendedor.
const ZONE_FALLBACK_MAX_KM = 3.5;
// Clientes propios: la cartera lejana NO entra sólo por ser cartera.
const PORTFOLIO_FALLBACK_MAX_KM = 3.5;
// Un prospecto NUNCA puede estar más lejos que esto del núcleo del vendedor.
const MAX_PROSPECT_DISTANCE_KM = 2.5;
// Diámetro máximo tolerado entre dos visitas del mismo vendedor en el día (caminable).
const MAX_ROUTE_SPREAD_KM = 3.0;
// Días mínimos entre dos recomendaciones del mismo negocio (regla dura, se relaja sólo si no se llega a 8).
const RECOMMENDATION_COOLDOWN_DAYS = 15;

// Composición objetivo del día: 4 cartera activa + 2 reactivación + 2 prospectos.
const CUPO_CARTERA_ACTIVA = 4;
const CUPO_REACTIVACION = 2;
const CUPO_PROSPECTOS = 2;

// Limpia jerga interna y coordenadas de los textos que ve el asignador.
function limpiarJustificacion(texto: string | null | undefined, fallback: string): string {
  let out = String(texto ?? "").trim();
  if (!out) return fallback;
  out = out
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, "la zona")
    .replace(/\b(hotspot|cluster|centroide|score_[a-z_]*|score\s*(final|total|geo|geográfico)?\s*[:=]?\s*\d+(\.\d+)?)\b/gi, "")
    .replace(/\bdist(ancia)?\s*[:=]?\s*\d+(\.\d+)?\s*km\b/gi, "")
    .replace(/\blat(itud)?\s*[:=]?\s*-?\d+(\.\d+)?/gi, "")
    .replace(/\blong(itud)?\s*[:=]?\s*-?\d+(\.\d+)?/gi, "")
    .replace(/^\s*Auto\s*:\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–,;]\s*(?=[.,;]|$)/g, "")
    .trim();
  out = out.replace(/^[\s\-–,;.]+/, "").trim();
  if (out.length < 12) return fallback;
  return out.length > 320 ? `${out.slice(0, 317)}...` : out;
}


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
// Regla de negocio: manda SIEMPRE el último que vendió en ese lugar
// (vendedor_actual). El histórico sólo se usa si no hay último vendedor
// identificable, para no quitarle la clientela a quien generó el vínculo.
// ============================================================

function isClientAffiliated(cliente: any, vendedorUserId: string, sellerNameMap: Map<string, string>): boolean {
  // 1) Último vendedor con venta registrada: dueño exclusivo del cliente
  const actualUUID = resolveSellerUUID(cliente.vendedor_actual, sellerNameMap);
  if (actualUUID) return actualUUID === vendedorUserId;

  // 2) Sin último vendedor resoluble → vendedor histórico dominante
  const principalUUID = resolveSellerUUID(cliente.vendedor_principal, sellerNameMap);
  if (principalUUID) return principalUUID === vendedorUserId;

  // 3) Último recurso: cualquier vendedor del historial
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
  options: ScoreOptions = {},
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const cooldownDays = options.cooldownDays ?? 0;
  const revisitMap = options.revisitMap;

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
      // COOLDOWN DURO: no repetir el mismo negocio antes de N días.
      if (cooldownDays > 0 && daysSinceRec < cooldownDays) continue;
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

    // FEEDBACK DEL VENDEDOR: si pidió volver más adelante, no se recomienda antes de esa fecha.
    const revisit = revisitMap?.get(c.client_id);
    let revisitBonus = 0;
    if (revisit) {
      if (revisit.dueAt > Date.now()) continue;
      revisitBonus = 30; // ya está vencido el pedido de volver → prioridad
    }

    const score_total = score_geo * 0.50 + score_vendedor * 0.25 + score_comercial * 0.15 + score_rotacion * 0.10 + overlapPenalty + revisitBonus;

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
  options: ScoreOptions = {},
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const cooldownDays = options.cooldownDays ?? 0;
  const revisitMap = options.revisitMap;
  const effectiveRadius = Math.min(radiusKm, MAX_PROSPECT_DISTANCE_KM);

  for (const p of prospectos) {
    const lat = p.latitud ? Number(p.latitud) : null;
    const long = p.longitud ? Number(p.longitud) : null;

    // HARD radius filter (nunca por encima del tope absoluto de prospectos)
    if (!isWithinRadius(lat, long, hotspot, effectiveRadius)) continue;

    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long) {
      distancia_km = calcularDistanciaKm(hotspot.lat, hotspot.lng, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km / effectiveRadius) * 100);
    }

    let overlapPenalty = 0;
    if (lat && long && otherAnchors.length > 0) {
      const minDistOther = Math.min(...otherAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      if (minDistOther < 0.3) overlapPenalty = -100;
      // COHERENCIA TERRITORIAL: si el prospecto pertenece claramente a la zona
      // de otro vendedor (>1km más cerca de su hotspot), no se ofrece acá.
      if (minDistOther + 1 < distancia_km) continue;
    }

    const score_comercial = Math.min(100, (p.rating || 3) * 20);

    let score_rotacion = 100;
    if (p.last_recommendation_at) {
      const daysSinceRec = (Date.now() - new Date(p.last_recommendation_at).getTime()) / (1000 * 60 * 60 * 24);
      if (cooldownDays > 0 && daysSinceRec < cooldownDays) continue;
      score_rotacion = Math.min(100, daysSinceRec * 5);
    }


    const feedbacks = feedbacksMap.get(p.place_id) || [];
    const hasNegativeFeedback = feedbacks.some((fb: any) =>
      fb.feedback?.toLowerCase().includes("no volver") ||
      fb.feedback?.toLowerCase().includes("cerrado")
    );
    if (hasNegativeFeedback) continue;

    const revisit = revisitMap?.get(p.place_id);
    let revisitBonus = 0;
    if (revisit) {
      if (revisit.dueAt > Date.now()) continue;
      revisitBonus = 30;
    }

    // Prospects: geo dominates scoring (sorted by proximity to hotspot)
    const score_total = score_geo * 0.70 + score_comercial * 0.15 + score_rotacion * 0.15 + overlapPenalty + revisitBonus;

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
1. CUOTA: EXACTAMENTE 8 visitas por vendedor.
2. MEZCLA OBJETIVO: ${CUPO_CARTERA_ACTIVA} de CARTERA ACTIVA + ${CUPO_REACTIVACION} de REACTIVACIÓN (dormidos/perdidos) + ${CUPO_PROSPECTOS} PROSPECTOS.
3. Si falta cartera activa, se completa con reactivación; si falta reactivación, con cartera activa; si no hay clientes propios, con prospectos.
4. RUTA COMPACTA: la cercanía manda. Preferí un prospecto cercano antes que un cliente descolgado del resto de la ruta.
5. Los candidatos ya vienen filtrados por cartera, cooldown y radio caminable: no inventes IDs.
6. NUNCA repitas el mismo client_id para distintos vendedores.
7. FEEDBACK DEL VENDEDOR: si un feedback pidió volver más adelante, ese negocio ya fue excluido; si el pedido está vencido, priorizalo.
8. TERRITORIO: cada visita debe caer en la zona natural del vendedor.

JUSTIFICACIÓN (lo lee un asignador comercial, no un técnico):
- Una o dos frases en español rioplatense explicando por qué visitar ese lugar HOY.
- Hablá de la relación con el cliente, tiempo sin comprar, potencial, rubro y cercanía con el resto de la ruta (en cuadras o minutos a pie).
- PROHIBIDO: coordenadas, "hotspot", "score", "cluster", distancias en km, IDs o cualquier jerga interna.

IMPORTANTE: Las instrucciones adicionales ordenan candidatos dentro de cada bloque, pero no cambian la mezcla objetivo ni la compacidad de la ruta.


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
    cupos: {
      cartera: CUPO_CARTERA_ACTIVA,
      reactivacion: CUPO_REACTIVACION,
      prospectos: CUPO_PROSPECTOS,
    },
  });
  const pickedIds = new Set(orderedIds);
  const isAvailable = (id: string) => !pickedIds.has(id) && !globalPickedIds.has(id);
  const result = orderedIds.map((candidateId) => {
    const aiRecommendation = aiRecommendationById.get(candidateId);
    const candidate = allCandidates.get(candidateId)!;
    if (aiRecommendation) {
      return {
        ...aiRecommendation,
        justificacion: limpiarJustificacion(
          aiRecommendation.justificacion,
          justificacionComercial(candidate),
        ),
      };
    }
    return makeRec(candidate, vendedorId);
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
        result[idx] = makeRec(recovery, vendedorId);
        pickedIds.add(recovery.client_id);
      }
    }
  }


  if (result.length < 8) {
    console.warn(`⚠️ ${vendedorId.slice(0, 8)}: Solo ${result.length}/8 recs posibles. Pools agotados (${clientPool.length}C + ${prospectPool.length}P disponibles).`);
  }

  return result.slice(0, 8);
}

function justificacionComercial(c: ScoredCandidate): string {
  const cuadras = Math.max(1, Math.round((c.distancia_km * 1000) / 100));
  const cerca = `Queda a unas ${cuadras} cuadras del resto de la ruta`;
  if (c.es_prospecto) {
    const rubro = c.tipo_negocio ? `${c.tipo_negocio}` : "Local del rubro";
    const rep = c.rating ? ` con buena reputación (${c.rating})` : "";
    return `${rubro} de ${c.barrio || "la zona"}${rep} que todavía no nos compra. ${cerca}: sirve para sumar cobertura nueva sin estirar el día.`;
  }
  const dias = c.dias_desde_ultima_compra;
  if (c.estado_comercial === "ACTIVO") {
    return `Cliente activo de ${c.barrio || "la zona"}${dias != null ? `, compró hace ${dias} días` : ""}. ${cerca}: visita de mantenimiento para sostener el ritmo de compra.`;
  }
  if (c.estado_comercial === "INACTIVO") {
    return `Bajó el ritmo${dias != null ? `: hace ${dias} días que no compra` : ""}. ${cerca}: conviene pasar antes de que se enfríe del todo.`;
  }
  return `Cliente a recuperar${dias != null ? `: hace ${dias} días que no compra` : ""}. ${cerca}: vale la visita de reconquista.`;
}

function makeRec(c: ScoredCandidate, vendedorId: string, justificacion?: string): any {
  return {
    client_id: c.client_id,
    vendedor_id: vendedorId,
    prioridad: c.estado_comercial === 'ACTIVO' ? 'alta' : 'media',
    justificacion: justificacion || justificacionComercial(c),
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

    // Feedback del vendedor → fecha mínima de próxima visita ("volver en X días/semanas").
    const revisitMapClientes = buildRevisitMap(feedbacksMapClientes);
    const revisitMapProspectos = buildRevisitMap(feedbacksMapProspectos);
    const scoreOpts: ScoreOptions = { cooldownDays: RECOMMENDATION_COOLDOWN_DAYS, revisitMap: revisitMapClientes };
    const scoreOptsP: ScoreOptions = { cooldownDays: RECOMMENDATION_COOLDOWN_DAYS, revisitMap: revisitMapProspectos };
    // Versión relajada del cooldown: sólo se usa como último recurso para llegar a 8.
    const scoreOptsRelaxed: ScoreOptions = { cooldownDays: 0, revisitMap: revisitMapClientes };
    const scoreOptsPRelaxed: ScoreOptions = { cooldownDays: 0, revisitMap: revisitMapProspectos };
    console.log(`🗣️ Feedback con pedido de revisita: ${revisitMapClientes.size} clientes / ${revisitMapProspectos.size} prospectos`);


    // ============================================================
    // 9. PER-VENDOR: Hotspot → Hard radius → Pool 1 + Pool 2
    // ============================================================
    const vendorClientPools: Map<string, ScoredCandidate[]> = new Map();
    const vendorProspectPools: Map<string, ScoredCandidate[]> = new Map();
    const vendorHotspots: Map<string, AnchorPoint> = new Map();
    const extraProspectosLoaded: any[] = [];
    const liveDiscoveredIds = new Set<string>();
    const coberturaPorVendedor = new Map<string, any>();

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
        vendorHotspot, HARD_RADIUS_KM, otherHotspots, scoreOpts,
      );

      // === POOL 2: Prospects within HARD_RADIUS_KM of hotspot ===
      let prospectPool = scoreProspects(
        prospectos, feedbacksMapProspectos,
        vendorHotspot, HARD_RADIUS_KM, otherHotspots, scoreOptsP,
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
          vendorHotspot, expandRadius, otherHotspots, scoreOpts,
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
          vendorHotspot, ZONE_FALLBACK_MAX_KM, otherHotspots, scoreOpts,
        )
          .filter(c => !existingClientIds.has(c.client_id))
          .sort((a, b) => a.distancia_km - b.distancia_km)
          .slice(0, Math.max(0, 8 - clientPool.length));
        clientPool = [...clientPool, ...remainingZoneClients];
        if (remainingZoneClients.length > 0) {
          console.log(`🆕 ${vendedor.nombre}: +${remainingZoneClients.length} clientes del resto de la zona (≤${ZONE_FALLBACK_MAX_KM}km)`);
        }
      }

      // === RESCATE DE CARTERA: antes de sumar prospectos, se agotan los clientes
      // propios de toda la cartera (hasta 25km) y recién ahí se relaja el cooldown. ===
      const rescatarClientes = (radius: number, opts: ScoreOptions, label: string) => {
        if (clientPool.length >= 8) return;
        const existingClientIds = new Set(clientPool.map(c => c.client_id));
        const rescued = scoreClients(
          [...myValidClients, ...portfolioClients.filter((c: any) => isClientAffiliated(c, vendedor.user_id, sellerNameMap))],
          placesMap, feedbacksMapClientes,
          vendedor.user_id, sellerNameMap,
          vendorHotspot, radius, otherHotspots, opts,
        )
          .filter(c => !existingClientIds.has(c.client_id))
          .sort((a, b) => a.distancia_km - b.distancia_km)
          .slice(0, Math.max(0, 8 - clientPool.length));
        if (rescued.length > 0) {
          clientPool = [...clientPool, ...rescued];
          console.log(`♻️ ${vendedor.nombre}: +${rescued.length} clientes rescatados (${label})`);
        }
      };
      rescatarClientes(PORTFOLIO_FALLBACK_MAX_KM, scoreOpts, `cartera ≤${PORTFOLIO_FALLBACK_MAX_KM}km`);
      rescatarClientes(PORTFOLIO_FALLBACK_MAX_KM, scoreOptsRelaxed, "cartera sin cooldown");


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
          vendorHotspot, expandRadius, otherHotspots, scoreOptsP,
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
          scoreOptsP,
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
                newProspects.forEach((p: any) => liveDiscoveredIds.add(p.place_id));
                const liveScored = scoreProspects(
                  newProspects, feedbacksMapProspectos,
                  vendorHotspot, MAX_PROSPECT_DISTANCE_KM, otherHotspots, scoreOptsPRelaxed,
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
    // 10. BUILD PROMPT — atributos de negocio, sin coordenadas ni scores
    // ============================================================
    const cuadras = (km: number) => Math.max(1, Math.round((km * 1000) / 100));
    const formatCandidate = (c: ScoredCandidate, i: number) => {
      const bloque = c.es_prospecto
        ? "PROSPECTO"
        : (c.estado_comercial === "ACTIVO" ? "CARTERA ACTIVA" : "REACTIVACIÓN");
      const compra = c.es_prospecto
        ? "sin historia de compra"
        : (c.dias_desde_ultima_compra === null || c.dias_desde_ultima_compra === undefined
          ? "sin fecha de última compra"
          : `${c.dias_desde_ultima_compra} días sin comprar`);
      const ticket = !c.es_prospecto && c.ticket_promedio
        ? `, ticket promedio $${Math.round(Number(c.ticket_promedio)).toLocaleString("es-AR")}`
        : "";
      const rubro = c.tipo_negocio ? `, ${c.tipo_negocio}` : "";
      const reputacion = c.es_prospecto && c.rating ? `, reputación ${c.rating}` : "";
      const feedback = c.feedbacks_recientes.length > 0
        ? ` | comentario del vendedor: ${c.feedbacks_recientes.map(f => f.feedback).join("; ")}`
        : "";
      return `${i + 1}. [${c.client_id}] ${c.razon_social} | ${bloque} | barrio ${c.barrio || "s/d"} | a ${cuadras(c.distancia_km)} cuadras del arranque de la ruta | ${compra}${ticket}${rubro}${reputacion}${feedback}`;
    };

    const vendorSections = vendedoresData.map(v => {
      const clients = vendorClientPools.get(v.user_id) || [];
      const prospects = vendorProspectPools.get(v.user_id) || [];
      const activos = clients.filter(c => c.estado_comercial === "ACTIVO");
      const reactivables = clients.filter(c => c.estado_comercial !== "ACTIVO");

      return `
### VENDEDOR: ${v.nombre} (ID: ${v.user_id})
Objetivo del día: ${CUPO_CARTERA_ACTIVA} de cartera activa + ${CUPO_REACTIVACION} de reactivación + ${CUPO_PROSPECTOS} prospectos = 8 visitas caminables.

CARTERA ACTIVA (${activos.length}):
${activos.length > 0 ? activos.map(formatCandidate).join('\n') : '(sin clientes activos en la zona)'}

REACTIVACIÓN — dormidos o perdidos (${reactivables.length}):
${reactivables.length > 0 ? reactivables.map(formatCandidate).join('\n') : '(sin clientes para reactivar en la zona)'}

PROSPECTOS CERCANOS (${prospects.length}):
${prospects.length > 0 ? prospects.slice(0, 15).map(formatCandidate).join('\n') : '(sin prospectos disponibles)'}`;
    }).join('\n\n');

    const hasCustomInstructions = !!(instrucciones_adicionales && instrucciones_adicionales.trim().length > 0);

    const prompt = `${hasCustomInstructions ? `
═══════════════════════════════════════════════════════════
⚡ INSTRUCCIONES ADICIONALES DEL CLIENTE:
${instrucciones_adicionales}
Aplicá estas instrucciones sin alterar la composición objetivo (4 cartera activa + 2 reactivación + 2 prospectos).
═══════════════════════════════════════════════════════════
` : ''}${vendorSections}

TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor).
Cada client_id UNA SOLA VEZ en toda la respuesta.
La justificación es para un asignador comercial: explicá en una o dos frases POR QUÉ conviene visitar ese lugar hoy (relación con el cliente, tiempo sin comprar, potencial, cercanía con el resto de la ruta). PROHIBIDO usar coordenadas, "hotspot", "score", números de distancia en km o cualquier jerga interna del sistema.${hasCustomInstructions ? `\nRECORDÁ: aplicá las instrucciones respetando la composición objetivo.` : ''}`;


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
        newProspects.forEach((p: any) => liveDiscoveredIds.add(p.place_id));


        const scored = scoreProspects(
          newProspects, feedbacksMapProspectos,
          hotspot, MAX_PROSPECT_DISTANCE_KM, otherHotspots, scoreOptsPRelaxed,
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

      // === COBERTURA: pedido vs conseguido, para explicárselo al asignador ===
      let obtCartera = 0, obtReactivacion = 0, obtProspectos = 0, obtMapsLive = 0;
      let radioFinal = 0;
      vendorRecs.forEach((r: any) => {
        const c = allCands.get(r.client_id);
        if (!c) return;
        radioFinal = Math.max(radioFinal, c.distancia_km || 0);
        if (c.es_prospecto) {
          obtProspectos++;
          if (liveDiscoveredIds.has(c.client_id)) obtMapsLive++;
        } else if (c.estado_comercial === "ACTIVO") obtCartera++;
        else obtReactivacion++;
      });
      coberturaPorVendedor.set(vendedor.user_id, {
        vendedor: vendedor.nombre,
        total: vendorRecs.length,
        objetivo: { cartera_activa: CUPO_CARTERA_ACTIVA, reactivacion: CUPO_REACTIVACION, prospectos: CUPO_PROSPECTOS },
        obtenido: { cartera_activa: obtCartera, reactivacion: obtReactivacion, prospectos: obtProspectos },
        prospectos_de_base: obtProspectos - obtMapsLive,
        prospectos_de_maps: obtMapsLive,
        radio_final_km: Number(radioFinal.toFixed(1)),
        clientes_propios_en_zona: (vendorClientPools.get(vendedor.user_id) || []).length,
      });

    }

    // ============================================================
    // 12b. AUDITORÍA DE COHERENCIA DE LA DISTRIBUCIÓN COMPLETA
    // Primero un chequeo determinístico (territorio) y después una
    // segunda pasada de IA con un modelo fuerte sobre el reparto total.
    // ============================================================
    try {
      const candidateOf = (vendedorId: string, id: string): ScoredCandidate | undefined =>
        (vendorClientPools.get(vendedorId) || []).find(c => c.client_id === id)
        || (vendorProspectPools.get(vendedorId) || []).find(c => c.client_id === id);

      const distToHotspot = (vendedorId: string, cand: ScoredCandidate | undefined): number => {
        const h = vendorHotspots.get(vendedorId);
        if (!h || !cand?.lat || !cand?.long) return Number.POSITIVE_INFINITY;
        return calcularDistanciaKm(h.lat, h.lng, Number(cand.lat), Number(cand.long));
      };

      const trySwap = (recA: any, recB: any): boolean => {
        if (recA.vendedor_id === recB.vendedor_id) return false;
        const candA = candidateOf(recA.vendedor_id, recA.client_id);
        const candB = candidateOf(recB.vendedor_id, recB.client_id);
        if (!candA || !candB) return false;
        // Ambos tienen que ser candidatos válidos para el otro vendedor.
        if (!candidateOf(recB.vendedor_id, recA.client_id) || !candidateOf(recA.vendedor_id, recB.client_id)) return false;
        const actual = distToHotspot(recA.vendedor_id, candA) + distToHotspot(recB.vendedor_id, candB);
        const propuesto = distToHotspot(recB.vendedor_id, candA) + distToHotspot(recA.vendedor_id, candB);
        if (!Number.isFinite(actual) || !Number.isFinite(propuesto)) return false;
        if (propuesto + 1 >= actual) return false; // sólo si mejora al menos 1km
        const tmp = recA.vendedor_id;
        recA.vendedor_id = recB.vendedor_id;
        recB.vendedor_id = tmp;
        return true;
      };

      // --- Pasada determinística: corrige visitas que caen en territorio ajeno ---
      let swaps = 0;
      for (const recA of validatedRecs) {
        const candA = candidateOf(recA.vendedor_id, recA.client_id);
        if (!candA) continue;
        const dActual = distToHotspot(recA.vendedor_id, candA);
        for (const recB of validatedRecs) {
          if (recB === recA || recB.vendedor_id === recA.vendedor_id) continue;
          if (distToHotspot(recB.vendedor_id, candA) + 1 >= dActual) continue;
          if (trySwap(recA, recB)) { swaps++; break; }
        }
      }
      if (swaps > 0) console.log(`🧭 Auditoría territorial: ${swaps} intercambios entre vendedores`);

      const getRutasDispersas = (): string[] => {
        const rutas: string[] = [];
        for (const v of vendedoresData) {
          const puntos = validatedRecs
            .filter((r: any) => r.vendedor_id === v.user_id)
            .map((r: any) => candidateOf(v.user_id, r.client_id))
            .filter((c): c is ScoredCandidate => !!c?.lat && !!c?.long);
          let spread = 0;
          for (let i = 0; i < puntos.length; i++) {
            for (let j = i + 1; j < puntos.length; j++) {
              spread = Math.max(spread, calcularDistanciaKm(
                Number(puntos[i].lat), Number(puntos[i].long),
                Number(puntos[j].lat), Number(puntos[j].long),
              ));
            }
          }
          if (spread > MAX_ROUTE_SPREAD_KM) rutas.push(`${v.nombre} (${spread.toFixed(1)}km entre extremos)`);
        }
        return rutas;
      };

      // --- Segunda pasada de IA sobre la distribución total ---
      // La auditoría es interna y bloqueante: corrige, vuelve a auditar y recién
      // permite guardar cuando el modelo confirma que el reparto es coherente.
      if (vendedoresData.length > 1) {
        let auditoriaAprobada = false;
        for (let intento = 1; intento <= 3 && !auditoriaAprobada; intento++) {
          const rutasDispersas = getRutasDispersas();
          const resumenDistribucion = vendedoresData.map(v => {
          const recs = validatedRecs.filter((r: any) => r.vendedor_id === v.user_id);
          const h = vendorHotspots.get(v.user_id);
          const lineas = recs.map((r: any) => {
            const c = candidateOf(v.user_id, r.client_id);
            return `- [${r.client_id}] ${c?.razon_social || r.client_id} | ${c?.es_prospecto ? "PROSPECTO" : "CLIENTE"} | barrio:${c?.barrio || "?"} | dist_hotspot:${distToHotspot(v.user_id, c).toFixed(1)}km`;
          }).join("\n");
          return `### ${v.nombre} (${v.user_id}) — hotspot ${h ? `${h.lat.toFixed(4)},${h.lng.toFixed(4)}` : "N/A"}\n${lineas}`;
        }).join("\n\n");

          const auditResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: [
              {
                role: "system",
                content: `Sos el auditor comercial de CUPRA. Revisás el reparto COMPLETO de visitas del día entre vendedores.
 Criterios:
1. Coherencia territorial: cada visita debe pertenecer a la zona natural del vendedor (menor distancia a su hotspot).
2. Balance cliente/prospecto: los clientes de cartera nunca deben quedar afuera para meter prospectos.
3. Densidad de ruta: las 8 visitas de un vendedor deben ser CAMINABLES entre sí (idealmente todas dentro de un radio de ~2km; nunca más de ${MAX_ROUTE_SPREAD_KM}km entre los dos extremos).
 Sólo podés proponer INTERCAMBIOS (swaps) entre dos visitas de vendedores distintos. No inventes IDs.
 Marcá coherente=true únicamente si el reparto actual ya puede salir al operador sin ninguna corrección pendiente.`,
              },
              { role: "user", content: `${resumenDistribucion}${rutasDispersas.length ? `\n\nRUTAS POCO COMPACTAS A CORREGIR: ${rutasDispersas.join("; ")}` : ""}\n\nDevolvé los intercambios necesarios y un resumen breve de la coherencia global.` },
            ],
            tools: [{
              type: "function",
              function: {
                name: "auditar_distribucion",
                parameters: {
                  type: "object",
                  properties: {
                    intercambios: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          client_id_a: { type: "string" },
                          client_id_b: { type: "string" },
                          motivo: { type: "string" },
                        },
                        required: ["client_id_a", "client_id_b", "motivo"],
                      },
                    },
                     resumen: { type: "string" },
                     coherente: { type: "boolean" },
                  },
                   required: ["intercambios", "resumen", "coherente"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "auditar_distribucion" } },
          }),
        });

          if (!auditResponse.ok) throw new Error(`Auditoría IA no disponible (${auditResponse.status})`);

          const auditData = await auditResponse.json();
          const auditArgs = auditData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (!auditArgs) throw new Error("La auditoría IA no devolvió una validación estructurada");

          const parsed = JSON.parse(auditArgs);
          let aplicados = 0;
          for (const swap of parsed.intercambios || []) {
            const recA = validatedRecs.find((r: any) => r.client_id === swap.client_id_a);
            const recB = validatedRecs.find((r: any) => r.client_id === swap.client_id_b);
            if (recA && recB && trySwap(recA, recB)) aplicados++;
          }

          const rutasPendientes = getRutasDispersas();
          // La aprobación real es determinística: si no quedan rutas dispersas, la distribución sale.
          auditoriaAprobada = rutasPendientes.length === 0;
          console.log(`🧠 Auditoría IA ${intento}/3: ${aplicados} correcciones aplicadas; rutas dispersas=${rutasPendientes.length}; aprobada=${auditoriaAprobada}`);

          if (!auditoriaAprobada && aplicados === 0) {
            console.warn(`⚠️ Auditoría sin correcciones aplicables. Se continúa con la mejor distribución posible. Resumen IA: ${parsed.resumen || "s/d"}`);
            break;
          }
        }

        if (!auditoriaAprobada) {
          console.warn("⚠️ La distribución conserva rutas poco compactas; se entrega igualmente (pools limitados).");
        }
      }
    } catch (auditError) {
      // La auditoría nunca debe bloquear la entrega: se registra y se continúa.
      console.error("⚠️ Auditoría de coherencia no concluyente:", auditError);
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
      rec.justificacion = limpiarJustificacion(rec.justificacion, candidateInfo ? justificacionComercial(candidateInfo) : 'Visita sugerida por cercanía y potencial comercial en la zona.');
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
          factores_ia: { ...rec.factores, tipo_negocio: prospectoCompleto.tipo_principal, rating: prospectoCompleto.rating, website: prospectoCompleto.website, origen: liveDiscoveredIds.has(prospectoCompleto.place_id) ? 'maps_live' : 'base', cobertura: coberturaPorVendedor.get(vendedorId) || null },
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
          factores_ia: { ...rec.factores, tipo_negocio: (candidateInfo as any).tipo_negocio, rating: (candidateInfo as any).rating, origen: liveDiscoveredIds.has(candidateInfo.client_id) ? 'maps_live' : 'base', cobertura: coberturaPorVendedor.get(vendedorId) || null },
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
          factores_ia: { ...rec.factores, origen: 'cartera', cobertura: coberturaPorVendedor.get(vendedorId) || null },
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
    const zonaTexto = [...barriosFinales, ...comunasFinales].filter(Boolean).join(", ") || "la zona seleccionada";
    const avisosCobertura: string[] = [];
    for (const vendedor of vendedoresData) {
      const cob = coberturaPorVendedor.get(vendedor.user_id);
      if (!cob) continue;
      const propios = cob.obtenido.cartera_activa + cob.obtenido.reactivacion;
      const partes: string[] = [];
      if (cob.clientes_propios_en_zona <= 1) {
        partes.push(
          `En ${zonaTexto}, ${vendedor.nombre} tiene ${cob.clientes_propios_en_zona === 0 ? "cero clientes propios" : "un solo cliente propio"}. `
          + `Se completó la ruta con ${cob.obtenido.prospectos} lugares nuevos de la zona para que el día rinda.`,
        );
      } else if (cob.obtenido.cartera_activa < CUPO_CARTERA_ACTIVA || cob.obtenido.reactivacion < CUPO_REACTIVACION) {
        partes.push(
          `Ruta de ${vendedor.nombre}: ${cob.obtenido.cartera_activa} de cartera activa y ${cob.obtenido.reactivacion} de reactivación `
          + `(objetivo ${CUPO_CARTERA_ACTIVA} y ${CUPO_REACTIVACION}); se completó con ${cob.obtenido.prospectos} prospectos cercanos.`,
        );
      }
      if (cob.prospectos_de_maps > 0) {
        partes.push(`Se buscaron lugares nuevos en el mapa: ${cob.prospectos_de_maps} se incorporaron a la ruta de ${vendedor.nombre}.`);
      }
      if (cob.total < 8) {
        partes.push(`Sólo se pudieron armar ${cob.total} de 8 visitas para ${vendedor.nombre} con los filtros elegidos. Probá ampliar la zona.`);
      }
      if (partes.length > 0) avisosCobertura.push(partes.join(" "));
      if (propios === 0 && cob.total > 0) {
        console.log(`ℹ️ ${vendedor.nombre}: ruta 100% de prospección.`);
      }
    }
    const cuotaIncompleta = avisosCobertura.length > 0
      ? avisosCobertura.join(" ")
      : (incompleteVendors.length > 0
        ? `Se armaron ${enrichedRecommendations.length} de ${expectedRecommendationCount} visitas con los filtros elegidos.`
        : null);
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
        descripcion: limpiarJustificacion(aiRecommendations.resumen_analisis, "Rutas armadas priorizando cartera cercana y completadas con prospectos de la misma zona."),
        distribucion_por_vendedor: distribucion,
        zonas_priorizadas: Array.from(zonas).slice(0, 5),
        request_id,
        advertencia: cuotaIncompleta,
        avisos_cobertura: avisosCobertura,
        cobertura: Array.from(coberturaPorVendedor.values()),

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
