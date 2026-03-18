import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

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

interface AnchorPoint { lat: number; lng: number; }

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
// SCORING — v9-hotzone
// All candidates filtered by HARD radius from vendorHotspot
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
// SYSTEM PROMPT — v10-balanced
// ============================================================

function buildSystemPrompt(instrucciones_adicionales?: string): string {
  const base = `Eres el Planificador Estratégico de CUPRA. Tu misión es armar rutas de visita densas y caminables para vendedores de vinos premium.

CONTEXTO: Vendemos vinos en canales ON_TRADE (restaurantes/bares) y OFF_TRADE (vinotecas/retailers).

${instrucciones_adicionales ? `
═══════════════════════════════════════════════════════════
INSTRUCCIONES DEL CLIENTE (PRIORIDAD MÁXIMA — POR ENCIMA DE CUALQUIER OTRA REGLA):
${instrucciones_adicionales}

ESTAS INSTRUCCIONES TIENEN PRIORIDAD ABSOLUTA. Seleccioná candidatos que cumplan estos criterios PRIMERO, incluso si eso significa alterar la composición estándar.
═══════════════════════════════════════════════════════════
` : ''}
REGLAS DE COMPOSICIÓN (se aplican DESPUÉS de las instrucciones del cliente):
1. CUOTA OBLIGATORIA: Seleccioná EXACTAMENTE 8 visitas por vendedor.
2. COMPOSICIÓN SUGERIDA (flexible si las instrucciones del cliente lo requieren):
   - Clientes ACTIVOS e INACTIVOS primero (mantener relación)
   - Máximo 4 clientes PERDIDOS (recuperación)
   - Mínimo 2 PROSPECTOS (expansión comercial)
3. RECUPERACIÓN: Incluí al menos 1 cliente PERDIDO (>90 días sin compra) si existe.
4. CONCENTRACIÓN GEOGRÁFICA: Rutas densas, NO viajes largos.
5. Los candidatos ya fueron filtrados por cartera y radio geográfico.
6. JUSTIFICACIÓN: Para cada visita, escribí 2-3 líneas explicando por qué fue seleccionada.
7. NUNCA repitas el mismo client_id para distintos vendedores.

IMPORTANTE: Si las instrucciones del cliente piden priorizar un tipo de negocio, producto, canal o criterio específico, TU SELECCIÓN DEBE REFLEJARLO aunque rompa la composición sugerida.

FORMATO: Usá la tool "generate_recommendations" con la estructura indicada.`;
  return base;
}

// ============================================================
// POST-IA VALIDATION — v10-balanced (composition rules)
// Rules:
//   1. ACTIVO/INACTIVO clients first (highest priority)
//   2. At least 1 PERDIDO (recovery) if available
//   3. At least 2 PROSPECTOS if available and slots remain
//   4. Max 4 PERDIDOS — rest filled with prospects
// ============================================================

const MIN_PROSPECTS = 2;
const MAX_LOST = 4;

function validateAndFill(
  aiRecs: any[],
  clientPool: ScoredCandidate[],
  prospectPool: ScoredCandidate[],
  vendedorId: string,
  globalPickedIds: Set<string>,
  hasCustomInstructions: boolean = false,
): any[] {
  const allCandidates = new Map<string, ScoredCandidate>();
  [...clientPool, ...prospectPool].forEach(c => allCandidates.set(c.client_id, c));

  const pickedIds = new Set<string>();
  const result: any[] = [];

  const isAvailable = (id: string) => !pickedIds.has(id) && !globalPickedIds.has(id);
  const addRec = (rec: any) => { result.push(rec); pickedIds.add(rec.client_id); };

  // ── STEP 1: Accept valid AI picks FIRST (respect IA selection) ──
  for (const r of aiRecs) {
    if (result.length >= 8) break;
    if (r.vendedor_id !== vendedorId) continue;
    if (!isAvailable(r.client_id)) continue;
    if (!allCandidates.has(r.client_id)) continue;
    addRec(r);
  }

  console.log(`   📋 AI picks aceptados: ${result.length}/8 para ${vendedorId.slice(0, 8)}`);

  // ── STEP 2: Fill remaining slots with standard composition ──
  if (result.length < 8) {
    const activeClients = clientPool.filter(c => c.estado_comercial === 'ACTIVO' || c.estado_comercial === 'INACTIVO');
    const lostClients = clientPool.filter(c => c.estado_comercial === 'PERDIDO');

    // Fill with active/inactive clients
    for (const c of activeClients) {
      if (result.length >= 8) break;
      if (!isAvailable(c.client_id)) continue;
      addRec(makeRec(c, vendedorId));
    }

    // Fill with lost clients (max 4 total in result)
    const currentLost = result.filter(r => {
      const c = allCandidates.get(r.client_id);
      return c && c.estado_comercial === 'PERDIDO';
    }).length;
    for (const c of lostClients) {
      if (result.length >= 6) break; // Reserve 2 for prospects
      if (currentLost >= MAX_LOST) break;
      if (!isAvailable(c.client_id)) continue;
      addRec(makeRec(c, vendedorId, `Recuperación: ${c.razon_social} (${c.dias_desde_ultima_compra} días sin compra)`));
    }

    // Fill with prospects
    for (const c of prospectPool) {
      if (result.length >= 8) break;
      if (!isAvailable(c.client_id)) continue;
      addRec(makeRec(c, vendedorId));
    }

    // Still not full? Fill with remaining lost
    for (const c of lostClients) {
      if (result.length >= 8) break;
      if (!isAvailable(c.client_id)) continue;
      addRec(makeRec(c, vendedorId, `Recuperación: ${c.razon_social}`));
    }
  }

  // ── STEP 3: Soft rebalancing (ONLY if no custom instructions) ──
  if (!hasCustomInstructions && result.length >= 8) {
    // Ensure at least 1 recovery if available
    const hasRecovery = result.some(r => {
      const c = allCandidates.get(r.client_id);
      return c && !c.es_prospecto && (c.dias_desde_ultima_compra ?? 0) > 90;
    });
    const lostClients = clientPool.filter(c => c.estado_comercial === 'PERDIDO');

    if (!hasRecovery && lostClients.length > 0) {
      const recovery = lostClients.find(c => isAvailable(c.client_id));
      if (recovery) {
        const lastIdx = result.length - 1;
        pickedIds.delete(result[lastIdx].client_id);
        result[lastIdx] = makeRec(recovery, vendedorId, `Recuperación estratégica: ${recovery.razon_social} (${recovery.dias_desde_ultima_compra} días sin compra)`);
        pickedIds.add(recovery.client_id);
      }
    }

    // Ensure at least 2 prospects if available
    const currentProspects = result.filter(r => allCandidates.get(r.client_id)?.es_prospecto).length;
    if (currentProspects < MIN_PROSPECTS) {
      const availableProspects = prospectPool.filter(c => isAvailable(c.client_id));
      for (const prospect of availableProspects) {
        if (currentProspects >= MIN_PROSPECTS) break;
        if (result.length > MIN_PROSPECTS) {
          // Swap last non-prospect
          for (let i = result.length - 1; i >= 0; i--) {
            const existing = allCandidates.get(result[i].client_id);
            if (existing && !existing.es_prospecto) {
              pickedIds.delete(result[i].client_id);
              result[i] = makeRec(prospect, vendedorId);
              pickedIds.add(prospect.client_id);
              break;
            }
          }
        }
      }
    }
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
// MAIN HANDLER — v9-hotzone
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

    console.log("🔧 Version: v9-hotzone");
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

    console.log(`🆕 Prospectos disponibles: ${prospectos.length}`);

    // ---- 7. Zone center fallback (centroid of ALL client_places in filter) ----
    const zoneCoords: AnchorPoint[] = (clientPlaces || [])
      .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.long) }))
      .filter((p: AnchorPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -60 && p.lat <= -20 && p.lng >= -80 && p.lng <= -40);

    const zoneCenterFallback = calculateCentroid(zoneCoords);
    if (zoneCenterFallback) {
      console.log(`🎯 Zone center fallback: ${zoneCenterFallback.lat.toFixed(4)}, ${zoneCenterFallback.lng.toFixed(4)}`);
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

      // Hotspot = densest cluster of vendor's own clients (avoids dead-zone centroids)
      // FALLBACK: If vendor has 0 clients → use zone center fallback
      const vendorHotspot = findDensestHotspot(vendorCoords, 2.0) || zoneCenterFallback;

      if (!vendorHotspot) {
        console.log(`⚠️ ${vendedor.nombre}: Sin hotspot ni fallback. Saltando.`);
        vendorClientPools.set(vendedor.user_id, []);
        vendorProspectPools.set(vendedor.user_id, []);
        continue;
      }

      vendorHotspots.set(vendedor.user_id, vendorHotspot);
      const isConquestMode = vendorCoords.length === 0;
      console.log(`🔥 ${vendedor.nombre}: Hotspot ${vendorHotspot.lat.toFixed(4)}, ${vendorHotspot.lng.toFixed(4)}${isConquestMode ? ' (MODO CONQUISTA — fallback a centro de zona)' : ` (${vendorCoords.length} clientes propios)`}`);

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

      // === PROGRESSIVE EXPANSION: If total < 8, expand in steps ===
      const expansionRadii = [MAX_EXPANSION_KM, ...EXPANSION_STEPS_KM];
      let currentTotal = clientPool.length + prospectPool.length;

      for (const expandRadius of expansionRadii) {
        if (currentTotal >= 8) break;

        console.log(`⚠️ ${vendedor.nombre}: Solo ${currentTotal} candidatos. Expandiendo a ${expandRadius}km...`);
        const existingIds = new Set([...clientPool, ...prospectPool].map(c => c.client_id));

        // Expand CLIENTS from portfolio within larger radius
        const extraClientPool = scoreClients(
          myValidClients, placesMap, feedbacksMapClientes,
          vendedor.user_id, sellerNameMap,
          vendorHotspot, expandRadius, otherHotspots,
        ).filter(c => !existingIds.has(c.client_id));

        if (extraClientPool.length > 0) {
          clientPool = [...clientPool, ...extraClientPool];
          extraClientPool.forEach(c => existingIds.add(c.client_id));
          console.log(`🆕 ${vendedor.nombre}: +${extraClientPool.length} clientes en ${expandRadius}km`);
        }

        // Expand PROSPECTS with geo bounding box
        const degPerKm = 0.009; // ~1km in degrees
        const deltaLat = expandRadius * degPerKm;
        const deltaLng = expandRadius * degPerKm * 1.2; // longitude correction

        const { data: geoProspectos } = await supabaseClient
          .from("prospectos").select("*")
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

    const prompt = `${vendorSections}

${instrucciones_adicionales ? `\nINSTRUCCIONES ADICIONALES:\n${instrucciones_adicionales}\n` : ''}
TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor).
Cada client_id UNA SOLA VEZ en toda la respuesta. Priorizá clientes sobre prospectos. Concentración geográfica.`;

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
          { role: "system", content: RECOMMENDATION_SYSTEM_PROMPT },
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
    // 12. VALIDATE + FILL — v9-hotzone (linear pool, recovery swap)
    // ============================================================
    let validatedRecs: any[] = [];
    const globalPickedIds = new Set<string>();

    for (const vendedor of vendedoresData) {
      const clientPool = (vendorClientPools.get(vendedor.user_id) || []).filter(c => !globalPickedIds.has(c.client_id));
      const prospectPool = (vendorProspectPools.get(vendedor.user_id) || []).filter(c => !globalPickedIds.has(c.client_id));

      const filteredAiRecs = aiRecommendations.recomendaciones.filter(
        (r: any) => !globalPickedIds.has(r.client_id)
      );

      const vendorRecs = validateAndFill(
        filteredAiRecs,
        clientPool,
        prospectPool,
        vendedor.user_id,
        globalPickedIds,
      );

      vendorRecs.forEach((r: any) => globalPickedIds.add(r.client_id));
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

    // Save to DB
    const recommendationsForDb = enrichedRecommendations.map(({ lat, long, estado_comercial, vendedor_recomendado_nombre, ...rest }) => rest);
    const { error: insertError } = await supabaseClient.from("recomendaciones_ia").insert(recommendationsForDb);
    if (insertError) { console.error("❌ Error insertando:", insertError); throw insertError; }

    console.log(`✅ ${enrichedRecommendations.length} recomendaciones guardadas (v9-hotzone)`);

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
