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

const MAX_DISTANCE_TO_ZONE_CENTER_KM = 1;
const EXPANSION_RADIUS_KM = 2;

function isWithinRadiusFromCenter(
  lat: number | null,
  lng: number | null,
  center: AnchorPoint | null,
  maxDistanceKm = MAX_DISTANCE_TO_ZONE_CENTER_KM,
): boolean {
  if (!center) return true;
  if (lat === null || lng === null) return false;
  return calcularDistanciaKm(center.lat, center.lng, lat, lng) <= maxDistanceKm;
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
  // Check vendedor_actual
  const actualUUID = resolveSellerUUID(cliente.vendedor_actual, sellerNameMap);
  if (actualUUID === vendedorUserId) return true;
  // Check vendedor_principal
  const principalUUID = resolveSellerUUID(cliente.vendedor_principal, sellerNameMap);
  if (principalUUID === vendedorUserId) return true;
  // Check todos_vendedores
  const todosVendedores = cliente.todos_vendedores || [];
  for (const v of todosVendedores) {
    if (resolveSellerUUID(v, sellerNameMap) === vendedorUserId) return true;
  }
  return false;
}

// ============================================================
// PRE-SCORING
// ============================================================

interface AnchorPoint { lat: number; lng: number; }

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

function preScoreCandidates(
  clientes: any[],
  prospectos: any[],
  placesMap: Map<string, any>,
  feedbacksMapClientes: Map<string, any[]>,
  feedbacksMapProspectos: Map<string, any[]>,
  vendedorUserId: string,
  vendedorNombre: string,
  sellerNameMap: Map<string, string>,
  myAnchors: AnchorPoint[],
  otherAnchors: AnchorPoint[],
  zoneCenter: AnchorPoint | null,
  maxRadiusKm: number = MAX_DISTANCE_TO_ZONE_CENTER_KM,
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  for (const c of clientes) {
    const place = placesMap.get(c.client_id);
    const lat = place?.lat ? Number(place.lat) : null;
    const long = place?.long ? Number(place.long) : null;
    // Don't filter vendor's own clients by zone radius — they're already pre-filtered to be in zone
    const estado = classifyEstado(c.dias_desde_ultima_compra);

    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long && myAnchors.length > 0) {
      distancia_km = Math.min(...myAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      score_geo = Math.max(0, 100 - (distancia_km * 10));
    } else if (lat && long) {
      distancia_km = calcularDistanciaKm(-34.6037, -58.3816, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km * 5));
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

    // Seller affinity (100 for own portfolio, 50 for historical, 0 for foreign)
    const isOwn = isClientAffiliated(c, vendedorUserId, sellerNameMap);
    const score_vendedor = isOwn ? 100 : 0;

    let vendedor_anterior: string | null = null;
    if (c.vendedor_actual && c.vendedor_principal &&
      c.vendedor_actual.toUpperCase() !== c.vendedor_principal.toUpperCase()) {
      vendedor_anterior = c.vendedor_principal;
    }

    const feedbacks = feedbacksMapClientes.get(c.client_id) || [];
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

  for (const p of prospectos) {
    const lat = p.latitud ? Number(p.latitud) : null;
    const long = p.longitud ? Number(p.longitud) : null;
    if (!isWithinRadiusFromCenter(lat, long, zoneCenter, maxRadiusKm)) continue;

    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long && myAnchors.length > 0) {
      distancia_km = Math.min(...myAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      score_geo = Math.max(0, 100 - (distancia_km * 10));
    } else if (lat && long) {
      distancia_km = calcularDistanciaKm(-34.6037, -58.3816, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km * 5));
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

    const feedbacks = feedbacksMapProspectos.get(p.place_id) || [];
    const hasNegativeFeedback = feedbacks.some((fb: any) =>
      fb.feedback?.toLowerCase().includes("no volver") ||
      fb.feedback?.toLowerCase().includes("cerrado")
    );
    if (hasNegativeFeedback) continue;

    const score_total = score_geo * 0.60 + score_comercial * 0.20 + score_rotacion * 0.20 + overlapPenalty;

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

  candidates.sort((a, b) => b.score_total - a.score_total);
  return candidates;
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

const RECOMMENDATION_SYSTEM_PROMPT = `Eres el Planificador Estratégico de CUPRA. Tu misión es armar rutas de visita óptimas para vendedores de vinos premium.

CONTEXTO: Vendemos vinos en canales ON_TRADE (restaurantes/bares) y OFF_TRADE (vinotecas/retailers).

REGLAS DE ORO (ESTRICTAS):
1. CUOTA OBLIGATORIA: Seleccioná EXACTAMENTE 8 visitas por vendedor. Distribución ideal: 5 ACTIVOS + 1 INACTIVO + 1 PERDIDO + 1 POTENCIAL.
2. Si una categoría NO tiene candidatos suficientes, completá con POTENCIAL/PROSPECTO hasta llegar a 8. NUNCA devuelvas menos de 8 por vendedor.
3. GEO-RESTRICCIÓN DURA: Todas las recomendaciones deben estar dentro del radio operativo de la zona solicitada (máximo 1km del centro de zona).
4. DENSIDAD sobre distancia: Priorizá puntos que estén cerca de los Activos elegidos. Rutas densas, no viajes largos.
5. IDENTIDAD: Los candidatos ya fueron filtrados por cartera del vendedor. Tu trabajo es elegir la mejor combinación geográfica.
6. JUSTIFICACIÓN: Para cada visita, escribí 2-3 líneas explicando por qué fue seleccionada.
   - Para Inactivo/Perdido/Potencial explicá por qué visitarlo HOY (cercanía a ruta, potencial recuperación, etc.)
7. TRANSFERENCIA: Si el cliente era de otro vendedor, mencionalo.
8. NUNCA repitas el mismo client_id para distintos vendedores.

Los candidatos vienen PRE-FILTRADOS por cartera del vendedor y PRE-RANKEADOS. Tu trabajo es elegir la mejor combinación respetando la cuota de 8 por vendedor.

FORMATO: Usá la tool "generate_recommendations" con la estructura indicada.`;

// ============================================================
// POST-IA VALIDATION
// ============================================================

function validateAndFixDistribution(
  aiRecs: any[],
  buckets: { activos: ScoredCandidate[]; inactivos: ScoredCandidate[]; perdidos: ScoredCandidate[]; potenciales: ScoredCandidate[] },
  vendedorId: string,
  allCandidateIds: Set<string>,
  globalPickedIds: Set<string>,
): any[] {
  let recs = aiRecs.filter(r => r.vendedor_id === vendedorId && allCandidateIds.has(r.client_id) && !globalPickedIds.has(r.client_id));

  const candidateMap = new Map<string, ScoredCandidate>();
  [...buckets.activos, ...buckets.inactivos, ...buckets.perdidos, ...buckets.potenciales].forEach(c => candidateMap.set(c.client_id, c));

  const picked = { ACTIVO: [] as any[], INACTIVO: [] as any[], PERDIDO: [] as any[], POTENCIAL: [] as any[] };
  const pickedIds = new Set<string>();

  for (const r of recs) {
    if (pickedIds.has(r.client_id)) continue; // prevent intra-vendor duplicates
    const candidate = candidateMap.get(r.client_id);
    if (!candidate) continue;
    const estado = candidate.estado_comercial;
    picked[estado].push(r);
    pickedIds.add(r.client_id);
  }

  const targets: Record<string, number> = { ACTIVO: 5, INACTIVO: 1, PERDIDO: 1, POTENCIAL: 1 };
  const bucketMap: Record<string, ScoredCandidate[]> = {
    ACTIVO: buckets.activos,
    INACTIVO: buckets.inactivos,
    PERDIDO: buckets.perdidos,
    POTENCIAL: buckets.potenciales,
  };

  for (const [estado, target] of Object.entries(targets)) {
    while (picked[estado].length < target) {
      const available = bucketMap[estado].find(c => !pickedIds.has(c.client_id) && !globalPickedIds.has(c.client_id));
      if (!available) break;
      picked[estado].push({
        client_id: available.client_id,
        vendedor_id: vendedorId,
        prioridad: estado === 'ACTIVO' ? 'alta' : 'media',
        justificacion: `Completado automáticamente: ${available.razon_social} (${estado}) - Score ${available.score_total}`,
        score_final: available.score_total,
        factores: {
          score_comercial: available.score_comercial,
          score_recencia: available.score_rotacion,
          score_proximidad: available.score_geo,
          distancia_km: available.distancia_km,
          potencial_venta: available.monto_total_historico || 0,
        },
      });
      pickedIds.add(available.client_id);
    }
  }

  const result = [...picked.ACTIVO.slice(0, 5), ...picked.INACTIVO.slice(0, 1), ...picked.PERDIDO.slice(0, 1), ...picked.POTENCIAL.slice(0, 1)];

  if (result.length < 8) {
    const allBuckets = [...buckets.activos, ...buckets.inactivos, ...buckets.perdidos, ...buckets.potenciales];
    for (const c of allBuckets) {
      if (result.length >= 8) break;
      if (pickedIds.has(c.client_id) || globalPickedIds.has(c.client_id)) continue;
      result.push({
        client_id: c.client_id,
        vendedor_id: vendedorId,
        prioridad: 'media',
        justificacion: `Completado automáticamente: ${c.razon_social} (${c.estado_comercial})`,
        score_final: c.score_total,
        factores: {
          score_comercial: c.score_comercial,
          score_recencia: c.score_rotacion,
          score_proximidad: c.score_geo,
          distancia_km: c.distancia_km,
          potencial_venta: c.monto_total_historico || 0,
        },
      });
      pickedIds.add(c.client_id);
    }
  }

  // Último recurso para cuota obligatoria: permitir reutilizar candidatos de otro vendedor
  if (result.length < 8) {
    const allBuckets = [...buckets.activos, ...buckets.inactivos, ...buckets.perdidos, ...buckets.potenciales];
    for (const c of allBuckets) {
      if (result.length >= 8) break;
      if (pickedIds.has(c.client_id)) continue;
      result.push({
        client_id: c.client_id,
        vendedor_id: vendedorId,
        prioridad: 'media',
        justificacion: `Completado por cuota obligatoria (reuso controlado): ${c.razon_social} (${c.estado_comercial})`,
        score_final: c.score_total,
        factores: {
          score_comercial: c.score_comercial,
          score_recencia: c.score_rotacion,
          score_proximidad: c.score_geo,
          distancia_km: c.distancia_km,
          potencial_venta: c.monto_total_historico || 0,
        },
      });
      pickedIds.add(c.client_id);
    }
  }

  return result.slice(0, 8);
}

// ============================================================
// MAIN HANDLER
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

    console.log("🔧 Version: v7-geo-expansion");
    console.log("📥 Request recibido:", { vendedores, provincia, comuna, barrio, area_id, max_recomendaciones });

    // ---- 1. Resolve area filters ----
    let vendedoresFinales = vendedores || [];
    let barriosFinales = barrio || [];
    let comunasFinales = comuna || [];

    if (area_id) {
      console.log("🗺️ Cargando datos del área:", area_id);
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
    // Load SELECTED vendors
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

    console.log(`✅ Vendedores seleccionados: ${vendedoresData.length} → ${vendedoresData.map(v => v.nombre).join(', ')}`);

    // Load ALL vendor profiles for global seller name resolution (Bug fix #3)
    const { data: allVendorProfiles } = await supabaseClient
      .from("profiles")
      .select("user_id, nombre")
      .eq("rol", "vendedor")
      .eq("activo", true);
    
    // Build sellerNameMap from ALL vendors, not just selected ones
    const sellerNameMap = buildSellerNameMap(allVendorProfiles || vendedoresData);
    console.log(`🗂️ sellerNameMap: ${sellerNameMap.size / 2} vendedores totales (incluye no seleccionados)`);

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

    console.log(`📍 client_places en zona: ${clientPlaces?.length || 0}, unique clients: ${clientIdsEnZona.length}`);

    // ---- 4. Load ALL clients in zone (no vendor filter yet, that comes per-vendor) ----
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

    // ---- 4b. ALSO load vendor portfolio clients NOT in zone (for fallback) ----
    // Instead of querying by exact profile name (which fails when Excel name ≠ profile name),
    // load a broad set of clients and use JS-based isClientAffiliated for matching.
    let portfolioClients: any[] = [];
    {
      // Load clients with any vendedor set, not already in zone
      const excludeFilter = clientIdsEnZona.length > 0 ? clientIdsEnZona.join(",") : "NONE";
      const { data: extraClients } = await supabaseClient
        .from("clientes").select("*")
        .or("excluir_recomendaciones.is.null,excluir_recomendaciones.eq.false")
        .not("vendedor_actual", "is", null)
        .not("client_id", "in", `(${excludeFilter})`)
        .order("monto_total_historico", { ascending: false })
        .limit(500);
      
      // Filter in JS using isClientAffiliated to handle name mismatches
      const selectedVendorIds = new Set(vendedoresData.map(v => v.user_id));
      portfolioClients = (extraClients || []).filter(c => {
        for (const vid of selectedVendorIds) {
          if (isClientAffiliated(c, vid, sellerNameMap)) return true;
        }
        return false;
      });
      
      // Also load their places
      if (portfolioClients.length > 0) {
        const extraIds = portfolioClients.map(c => c.client_id);
        const { data: extraPlaces } = await supabaseClient
          .from("client_places").select("*").in("client_id", extraIds).eq("is_primary", true);
        extraPlaces?.forEach(place => placesMap.set(place.client_id, place));
      }
    }

    console.log(`📂 Portfolio clients fuera de zona: ${portfolioClients.length}`);

    // ---- 5. Exclude clients already assigned today ----
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

    // ---- 6b. SEMANTIC DEDUP: Exclude prospects that are the same physical place as existing clients ----
    const clientNamesAndCoords: { name: string; lat: number; lng: number; clientId: string }[] = [];
    for (const c of allClientesEnZona) {
      const place = placesMap.get(c.client_id);
      if (place?.lat && place?.long) {
        clientNamesAndCoords.push({
          name: c.razon_social || c.fantasia || '',
          lat: Number(place.lat),
          lng: Number(place.long),
          clientId: c.client_id,
        });
      }
    }

    // Also exclude prospects that have client_id set (already linked to a client)
    const prospectosPreDedup = prospectos.length;
    prospectos = prospectos.filter(p => {
      // If prospect is already linked to a client, exclude
      if (p.client_id) return false;
      if (!p.latitud || !p.longitud) return true;
      const pLat = Number(p.latitud);
      const pLng = Number(p.longitud);
      // Check if any client is <100m away AND has similar name
      for (const c of clientNamesAndCoords) {
        const dist = calcularDistanciaKm(c.lat, c.lng, pLat, pLng);
        if (dist < 0.1) { // <100m
          const overlap = nameTokenOverlap(p.nombre, c.name);
          if (overlap >= 0.4) {
            console.log(`🚫 Prospect "${p.nombre}" excluded: too similar to client "${c.name}" (${Math.round(dist*1000)}m, overlap=${overlap.toFixed(2)})`);
            return false;
          }
        }
      }
      return true;
    });

    console.log(`🆕 Prospectos: ${prospectosPreDedup} → ${prospectos.length} after semantic dedup`);

    const zoneCoords: AnchorPoint[] = [
      ...(clientPlaces || [])
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.long) }))
        .filter((p: AnchorPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -60 && p.lat <= -20 && p.lng >= -80 && p.lng <= -40),
      ...prospectos
        .map((p: any) => ({ lat: Number(p.latitud), lng: Number(p.longitud) }))
        .filter((p: AnchorPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -60 && p.lat <= -20 && p.lng >= -80 && p.lng <= -40),
    ];

    const zoneCenter: AnchorPoint | null = zoneCoords.length > 0
      ? {
          lat: zoneCoords.reduce((sum, p) => sum + p.lat, 0) / zoneCoords.length,
          lng: zoneCoords.reduce((sum, p) => sum + p.lng, 0) / zoneCoords.length,
        }
      : null;

    if (zoneCenter) {
      console.log(`🎯 Centro de zona: ${zoneCenter.lat.toFixed(4)}, ${zoneCenter.lng.toFixed(4)} | radio máximo ${MAX_DISTANCE_TO_ZONE_CENTER_KM}km`);
    }

    if (allClientesEnZona.length === 0 && portfolioClients.length === 0 && prospectos.length === 0) {
      return new Response(JSON.stringify({
        recomendaciones: [], resumen: { total_recomendaciones: 0, descripcion: "No se encontraron candidatos en la zona.", distribucion_por_vendedor: {}, zonas_priorizadas: [] }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- 7. Load feedbacks ----
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
    // 8. PER-VENDOR: Strict portfolio filtering + anchors + scoring
    // ============================================================
    const vendorBuckets: Record<string, { activos: ScoredCandidate[]; inactivos: ScoredCandidate[]; perdidos: ScoredCandidate[]; potenciales: ScoredCandidate[] }> = {};
    const vendorAnchors: Map<string, AnchorPoint[]> = new Map();
    const extraProspectosLoaded: any[] = []; // Accumulate extra prospectos for enrichment lookup

    for (const vendedor of vendedoresData) {
      // === STRICT FILTER: Only clients affiliated with THIS vendor ===
      const myClientsInZone = allClientesEnZona.filter(c => isClientAffiliated(c, vendedor.user_id, sellerNameMap));
      const myClientsOutside = portfolioClients.filter(c => isClientAffiliated(c, vendedor.user_id, sellerNameMap));
      
      // Log excluded clients (belong to OTHER vendors)
      const excludedFromZone = allClientesEnZona.filter(c => !isClientAffiliated(c, vendedor.user_id, sellerNameMap) && !c.es_prospecto);
      if (excludedFromZone.length > 0) {
        const sample = excludedFromZone.slice(0, 5).map(c => 
          `${c.razon_social || c.fantasia} → ${c.vendedor_actual || c.vendedor_principal || '?'}`
        );
        console.log(`🔍 ${vendedor.nombre}: ${excludedFromZone.length} clientes excluidos (cartera ajena): ${sample.join(', ')}`);
      }
      
      // Regla estricta de zona: SOLO clientes en la zona solicitada
      const myClients = [...myClientsInZone];

      // Exclude clients with no real sales (cantidad_ordenes > 0) unless they have vendedor_actual set
      const myValidClients = myClients.filter(c => 
        (c.cantidad_ordenes && c.cantidad_ordenes > 0) || c.vendedor_actual
      );

      console.log(`👤 ${vendedor.nombre}: ${myClientsInZone.length} en zona, ${myClientsOutside.length} fuera, ${myValidClients.length} válidos`);

      // === ANCHORS: Top active clients of THIS vendor ===
      const vendorActiveClients = myValidClients
        .filter(c => classifyEstado(c.dias_desde_ultima_compra) === 'ACTIVO')
        .sort((a: any, b: any) => (b.monto_total_historico || 0) - (a.monto_total_historico || 0));

      const anchors: AnchorPoint[] = [];
      for (const c of vendorActiveClients) {
        if (anchors.length >= 5) break;
        const place = placesMap.get(c.client_id);
        if (place?.lat && place?.long) {
          const lat = Number(place.lat);
          const lng = Number(place.long);
          if (lat >= -60 && lat <= -20 && lng >= -80 && lng <= -40) {
            anchors.push({ lat, lng });
          }
        }
      }

      // Fallback: if no anchors, use any of the vendor's clients
      if (anchors.length === 0) {
        for (const c of myValidClients.slice(0, 20)) {
          if (anchors.length >= 3) break;
          const place = placesMap.get(c.client_id);
          if (place?.lat && place?.long) {
            const lat = Number(place.lat);
            const lng = Number(place.long);
            if (lat >= -60 && lat <= -20 && lng >= -80 && lng <= -40) {
              anchors.push({ lat, lng });
            }
          }
        }
      }

      // Fallback #2: si no tiene anclas propias, usar centro de la zona solicitada
      if (anchors.length === 0 && zoneCenter) {
        anchors.push({ lat: zoneCenter.lat, lng: zoneCenter.lng });
        console.log(`📌 ${vendedor.nombre}: using zone center as anchor (${zoneCenter.lat.toFixed(4)}, ${zoneCenter.lng.toFixed(4)})`);
      }

      vendorAnchors.set(vendedor.user_id, anchors);
      console.log(`⚓ ${vendedor.nombre}: ${anchors.length} anclas`);

      // === SCORE: Only vendor's own clients + zone prospects ===
      const myAnchors = anchors;
      const otherAnchors = [...vendorAnchors.entries()]
        .filter(([id]) => id !== vendedor.user_id)
        .flatMap(([, anch]) => anch);

      const scored = preScoreCandidates(
        myValidClients, prospectos, placesMap,
        feedbacksMapClientes, feedbacksMapProspectos,
        vendedor.user_id, vendedor.nombre,
        sellerNameMap, myAnchors, otherAnchors,
        zoneCenter,
      );

      const activos = scored.filter(c => c.estado_comercial === 'ACTIVO').slice(0, 15);
      const inactivos = scored.filter(c => c.estado_comercial === 'INACTIVO').slice(0, 8);
      const perdidos = scored.filter(c => c.estado_comercial === 'PERDIDO').slice(0, 8);
      let potenciales = scored.filter(c => c.estado_comercial === 'POTENCIAL').slice(0, 80);

      // === GUARANTEE 8: Expand prospect pool if total candidates < 8 ===
      const totalCandidates = activos.length + inactivos.length + perdidos.length + potenciales.length;
      if (totalCandidates < 8 && zoneCenter) {
        console.log(`⚠️ ${vendedor.nombre}: Solo ${totalCandidates} candidatos, necesita 8. Buscando más prospectos por proximidad geográfica...`);
        
        const existingProspectoIds = new Set(potenciales.map(p => p.client_id));
        const allExistingIds = new Set([...activos, ...inactivos, ...perdidos, ...potenciales].map(c => c.client_id));
        const needed = 8 - totalCandidates;
        
        // EXPANSION 1: Bounding box ~2km around zone center
        const deltaLat = 0.018; // ~2km
        const deltaLng = 0.022; // ~2km at latitude -34
        
        const { data: geoProspectos } = await supabaseClient
          .from("prospectos").select("*")
          .gte("latitud", zoneCenter.lat - deltaLat)
          .lte("latitud", zoneCenter.lat + deltaLat)
          .gte("longitud", zoneCenter.lng - deltaLng)
          .lte("longitud", zoneCenter.lng + deltaLng)
          .order("rating", { ascending: false })
          .limit(needed * 5);
        
        const geoFiltered = (geoProspectos || []).filter(p => 
          !prospectosAsignadosHoy.has(p.place_id) && 
          !allExistingIds.has(p.place_id) &&
          !existingProspectoIds.has(p.place_id) &&
          !p.client_id
        );
        
        extraProspectosLoaded.push(...geoFiltered);
        
        // Score with RELAXED radius (2km instead of 1km)
        const geoScored = preScoreCandidates(
          [], geoFiltered, placesMap,
          feedbacksMapClientes, feedbacksMapProspectos,
          vendedor.user_id, vendedor.nombre,
          sellerNameMap, myAnchors, otherAnchors,
          zoneCenter, EXPANSION_RADIUS_KM,
        ).filter(c => !allExistingIds.has(c.client_id));
        
        potenciales = [...potenciales, ...geoScored.slice(0, needed)];
        console.log(`🆕 ${vendedor.nombre}: +${Math.min(geoScored.length, needed)} prospectos extra (geo ${EXPANSION_RADIUS_KM}km)`);
        
        // EXPANSION 2: If STILL not enough, wider search (3km)
        const totalAfterGeo = activos.length + inactivos.length + perdidos.length + potenciales.length;
        if (totalAfterGeo < 8) {
          const stillNeeded = 8 - totalAfterGeo;
          const allIds2 = new Set([...activos, ...inactivos, ...perdidos, ...potenciales].map(c => c.client_id));
          
          const deltaLat2 = 0.027; // ~3km
          const deltaLng2 = 0.033;
          
          const { data: widerProspectos } = await supabaseClient
            .from("prospectos").select("*")
            .gte("latitud", zoneCenter.lat - deltaLat2)
            .lte("latitud", zoneCenter.lat + deltaLat2)
            .gte("longitud", zoneCenter.lng - deltaLng2)
            .lte("longitud", zoneCenter.lng + deltaLng2)
            .order("rating", { ascending: false })
            .limit(stillNeeded * 5);
          
          const widerFiltered = (widerProspectos || []).filter(p => 
            !prospectosAsignadosHoy.has(p.place_id) && 
            !allIds2.has(p.place_id) &&
            !p.client_id
          );
          
          extraProspectosLoaded.push(...widerFiltered);
          
          const widerScored = preScoreCandidates(
            [], widerFiltered, placesMap,
            feedbacksMapClientes, feedbacksMapProspectos,
            vendedor.user_id, vendedor.nombre,
            sellerNameMap, myAnchors, otherAnchors,
            zoneCenter, 3,
          ).filter(c => !allIds2.has(c.client_id));
          
          potenciales = [...potenciales, ...widerScored.slice(0, stillNeeded)];
          console.log(`🌍 ${vendedor.nombre}: +${Math.min(widerScored.length, stillNeeded)} prospectos extra (wider 3km)`);
        }
      }

      vendorBuckets[vendedor.user_id] = { activos, inactivos, perdidos, potenciales };
      const finalTotal = activos.length + inactivos.length + perdidos.length + potenciales.length;
      console.log(`📊 ${vendedor.nombre}: ${activos.length}A ${inactivos.length}I ${perdidos.length}P ${potenciales.length}Pot = ${finalTotal} total`);

      if (activos.length === 0 && inactivos.length === 0 && perdidos.length === 0) {
        console.log(`⚠️ ${vendedor.nombre}: SIN clientes propios en esta zona. Solo recibirá prospectos.`);
      }
    }

    // ============================================================
    // 11. BUILD PROMPT
    // ============================================================
    const formatCandidate = (c: ScoredCandidate, i: number) =>
      `${i + 1}. [${c.client_id}] ${c.razon_social} | estado:${c.estado_comercial} | score:${c.score_total} geo:${c.score_geo} | dist:${c.distancia_km}km | barrio:${c.barrio || '?'} | vendedor_actual:${c.vendedor_actual || 'ninguno'}${c.vendedor_anterior ? ` (anterior: ${c.vendedor_anterior})` : ''} | días_sin_compra:${c.dias_desde_ultima_compra ?? 'N/A'} | ticket:$${c.ticket_promedio ?? 0}${c.tipo_negocio ? ` | tipo:${c.tipo_negocio}` : ''}${c.feedbacks_recientes.length > 0 ? ` | feedbacks: ${c.feedbacks_recientes.map(f => f.feedback).join('; ')}` : ''}`;

    const vendorSections = vendedoresData.map(v => {
      const { activos, inactivos, perdidos, potenciales } = vendorBuckets[v.user_id] || { activos: [], inactivos: [], perdidos: [], potenciales: [] };

      return `
### VENDEDOR: ${v.nombre} (ID: ${v.user_id})
Cuota OBLIGATORIA: 8 visitas. Ideal: 5 ACTIVOS + 1 INACTIVO + 1 PERDIDO + 1 POTENCIAL. Si faltan candidatos en una categoría, completá con POTENCIAL hasta llegar a 8.
IMPORTANTE: Todos los clientes (no prospectos) listados abajo pertenecen a la cartera de ${v.nombre}.

ACTIVOS (${activos.length} candidatos - elegir 5):
${activos.length > 0 ? activos.map(formatCandidate).join('\n') : '(sin candidatos activos en cartera)'}

INACTIVOS (${inactivos.length} candidatos - elegir 1):
${inactivos.length > 0 ? inactivos.map(formatCandidate).join('\n') : '(sin candidatos inactivos en cartera)'}

PERDIDOS (${perdidos.length} candidatos - elegir 1):
${perdidos.length > 0 ? perdidos.map(formatCandidate).join('\n') : '(sin candidatos perdidos en cartera)'}

POTENCIALES/PROSPECTOS (${potenciales.length} candidatos - elegir 1):
${potenciales.length > 0 ? potenciales.map(formatCandidate).join('\n') : '(sin prospectos disponibles)'}`;
    }).join('\n\n');

    const prompt = `${vendorSections}

${instrucciones_adicionales ? `\nINSTRUCCIONES ADICIONALES DEL ASIGNADOR:\n${instrucciones_adicionales}\n` : ''}
TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor, distribución 5-1-1-1).
IMPORTANTE: Cada client_id debe aparecer UNA SOLA VEZ en toda la respuesta. NO repitas clientes entre vendedores.
Respetá la cuota y priorizá la densidad geográfica.`;

    console.log(`📏 Prompt: ${prompt.length} chars`);

    // ============================================================
    // 12. CALL AI
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
            description: "Genera recomendaciones de visitas optimizadas por ruta con distribución 5-1-1-1",
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
    // 13. VALIDATE 5-1-1-1 + CROSS-VENDOR DEDUP
    // ============================================================
    const allCandidateIds = new Set<string>();
    Object.values(vendorBuckets).forEach(({ activos, inactivos, perdidos, potenciales }) => {
      [...activos, ...inactivos, ...perdidos, ...potenciales].forEach(c => allCandidateIds.add(c.client_id));
    });

    let validatedRecs: any[] = [];
    const globalPickedIds = new Set<string>();

    for (const vendedor of vendedoresData) {
      const rawBuckets = vendorBuckets[vendedor.user_id] || { activos: [], inactivos: [], perdidos: [], potenciales: [] };
      const filteredBuckets = {
        activos: rawBuckets.activos.filter(c => !globalPickedIds.has(c.client_id)),
        inactivos: rawBuckets.inactivos.filter(c => !globalPickedIds.has(c.client_id)),
        perdidos: rawBuckets.perdidos.filter(c => !globalPickedIds.has(c.client_id)),
        potenciales: rawBuckets.potenciales.filter(c => !globalPickedIds.has(c.client_id)),
      };

      const filteredAiRecs = aiRecommendations.recomendaciones.filter(
        (r: any) => !globalPickedIds.has(r.client_id)
      );

      const vendorRecs = validateAndFixDistribution(
        filteredAiRecs,
        filteredBuckets,
        vendedor.user_id,
        allCandidateIds,
        globalPickedIds,
      );

      vendorRecs.forEach((r: any) => globalPickedIds.add(r.client_id));
      validatedRecs.push(...vendorRecs);

      // Log distribution
      const candidateMap = new Map<string, ScoredCandidate>();
      const b = vendorBuckets[vendedor.user_id];
      if (b) [...b.activos, ...b.inactivos, ...b.perdidos, ...b.potenciales].forEach(c => candidateMap.set(c.client_id, c));
      const dist = { A: 0, I: 0, P: 0, Pot: 0 };
      vendorRecs.forEach((r: any) => {
        const c = candidateMap.get(r.client_id);
        if (c?.estado_comercial === 'ACTIVO') dist.A++;
        else if (c?.estado_comercial === 'INACTIVO') dist.I++;
        else if (c?.estado_comercial === 'PERDIDO') dist.P++;
        else if (c?.estado_comercial === 'POTENCIAL') dist.Pot++;
      });
      console.log(`✅ ${vendedor.nombre}: ${vendorRecs.length} recs (${dist.A}A-${dist.I}I-${dist.P}P-${dist.Pot}Pot)`);
    }

    // ============================================================
    // 14. ENRICH & SAVE
    // ============================================================
    const request_id = crypto.randomUUID();
    const validVendedorIds = new Set(vendedoresData.map(v => v.user_id));
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const enrichedRecommendations = [];

    // Build vendedor name lookup
    const vendedorNameLookup = new Map<string, string>();
    vendedoresData.forEach(v => vendedorNameLookup.set(v.user_id, v.nombre));

    // Merge all client sources for lookup
    const allClientes = [...allClientesEnZona, ...portfolioClients];
    const clienteLookup = new Map<string, any>();
    allClientes.forEach(c => { if (!clienteLookup.has(c.client_id)) clienteLookup.set(c.client_id, c); });

    const globalCandidateMap = new Map<string, ScoredCandidate>();
    Object.values(vendorBuckets).forEach(({ activos, inactivos, perdidos, potenciales }) => {
      [...activos, ...inactivos, ...perdidos, ...potenciales].forEach(c => {
        if (!globalCandidateMap.has(c.client_id)) globalCandidateMap.set(c.client_id, c);
      });
    });

    // Build a combined prospect lookup for enrichment
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
      
      // Fallback: build minimal prospect from globalCandidateMap if not found in prospectos
      const candidateInfo = globalCandidateMap.get(rec.client_id);
      if (!clienteCompleto && !prospectoCompleto && !candidateInfo) {
        console.warn(`⚠️ Enrichment skip: ${rec.client_id} not found in any lookup`);
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
        // Fallback: prospect found only in scored candidates (not in original prospectos arrays)
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

    console.log(`✅ ${enrichedRecommendations.length} recomendaciones guardadas`);

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
