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

// ============================================================
// CLIENT STATE CLASSIFICATION (Manual de Operaciones)
// ============================================================

type EstadoComercial = 'ACTIVO' | 'INACTIVO' | 'PERDIDO' | 'POTENCIAL';

function classifyEstado(diasDesdeUltimaCompra: number | null): 'ACTIVO' | 'INACTIVO' | 'PERDIDO' {
  if (diasDesdeUltimaCompra === null) return 'PERDIDO';
  if (diasDesdeUltimaCompra <= 30) return 'ACTIVO';
  if (diasDesdeUltimaCompra <= 90) return 'INACTIVO';
  return 'PERDIDO';
}

// ============================================================
// PRE-SCORING: Anchor-based geographic scoring
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
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  // --- Score clients ---
  for (const c of clientes) {
    const place = placesMap.get(c.client_id);
    const lat = place?.lat ? Number(place.lat) : null;
    const long = place?.long ? Number(place.long) : null;
    const estado = classifyEstado(c.dias_desde_ultima_compra);

    // Geographic score: distance to NEAREST anchor (not centroid)
    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long && myAnchors.length > 0) {
      distancia_km = Math.min(...myAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      score_geo = Math.max(0, 100 - (distancia_km * 10)); // 0km=100, 10km=0
    } else if (lat && long) {
      // No anchors yet - use Buenos Aires center as fallback
      distancia_km = calcularDistanciaKm(-34.6037, -58.3816, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km * 5));
    }

    // Overlap penalty: candidate < 300m from OTHER vendor's anchor → -100 points
    let overlapPenalty = 0;
    if (lat && long && otherAnchors.length > 0) {
      const minDistOther = Math.min(...otherAnchors.map(a => calcularDistanciaKm(a.lat, a.lng, lat, long)));
      if (minDistOther < 0.3) overlapPenalty = -100;
    }

    // Commercial score (1-5 scale → 0-100)
    const rawScore = c.score_comercial ?? 0;
    const score_comercial = Math.min(100, (rawScore / 5) * 100);

    // Rotation score
    let score_rotacion = 100;
    if (c.last_recommendation_at) {
      const daysSinceRec = (Date.now() - new Date(c.last_recommendation_at).getTime()) / (1000 * 60 * 60 * 24);
      score_rotacion = Math.min(100, daysSinceRec * 5);
    }

    // Seller affinity
    const clientVendedorActual = c.vendedor_actual || c.vendedor_principal;
    const clientVendedorUUID = resolveSellerUUID(clientVendedorActual, sellerNameMap);
    const score_vendedor = clientVendedorUUID === vendedorUserId ? 100 :
      (c.todos_vendedores || []).some((v: string) => resolveSellerUUID(v, sellerNameMap) === vendedorUserId) ? 50 : 0;

    // Determine vendedor_anterior
    let vendedor_anterior: string | null = null;
    if (c.vendedor_actual && c.vendedor_principal &&
      c.vendedor_actual.toUpperCase() !== c.vendedor_principal.toUpperCase()) {
      vendedor_anterior = c.vendedor_principal;
    }

    // Check negative feedback → disqualify
    const feedbacks = feedbacksMapClientes.get(c.client_id) || [];
    const hasNegativeFeedback = feedbacks.some((fb: any) =>
      fb.feedback?.toLowerCase().includes("no volver") ||
      fb.feedback?.toLowerCase().includes("cerrado") ||
      fb.motivo_no_visita?.toLowerCase().includes("cerrado")
    );
    if (hasNegativeFeedback) continue;

    // Weighted composite: geo 50%, seller 25%, commercial 15%, rotation 10% + overlap penalty
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

  // --- Score prospects ---
  for (const p of prospectos) {
    const lat = p.latitud ? Number(p.latitud) : null;
    const long = p.longitud ? Number(p.longitud) : null;

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
// SYSTEM PROMPT: Strict 5-1-1-1 distribution
// ============================================================

const RECOMMENDATION_SYSTEM_PROMPT = `Eres el Planificador Estratégico de CUPRA. Tu misión es armar rutas de visita óptimas para vendedores de vinos premium.

CONTEXTO: Vendemos vinos en canales ON_TRADE (restaurantes/bares) y OFF_TRADE (vinotecas/retailers).

REGLAS DE ORO (ESTRICTAS):
1. CUOTA 5-1-1-1: Seleccioná EXACTAMENTE 8 visitas por vendedor: 5 ACTIVOS + 1 INACTIVO + 1 PERDIDO + 1 POTENCIAL.
2. DENSIDAD sobre distancia: Priorizá puntos que estén cerca de los Activos elegidos. Rutas densas, no viajes largos.
3. IDENTIDAD: Cada vendedor tiene barrios donde es fuerte. Respetá su territorio histórico.
4. JUSTIFICACIÓN: Para cada visita, escribí 2-3 líneas explicando por qué fue seleccionada.
   - Para Inactivo/Perdido/Potencial explicá por qué visitarlo HOY (cercanía a ruta, potencial recuperación, etc.)
5. TRANSFERENCIA: Si el cliente era de otro vendedor, mencionalo (ej: "Oportunidad de recuperación de cartera anteriormente asignada a [VENDEDOR_ANTERIOR]").
6. Si una categoría no tiene suficientes candidatos, completá con la categoría más cercana disponible.

Los candidatos vienen PRE-RANKEADOS por estado y con scores calculados. Tu trabajo es elegir la mejor combinación respetando la cuota 5-1-1-1.

FORMATO: Usá la tool "generate_recommendations" con la estructura indicada.`;

// ============================================================
// POST-IA VALIDATION: Ensure 5-1-1-1 distribution
// ============================================================

function validateAndFixDistribution(
  aiRecs: any[],
  buckets: { activos: ScoredCandidate[]; inactivos: ScoredCandidate[]; perdidos: ScoredCandidate[]; potenciales: ScoredCandidate[] },
  vendedorId: string,
  allCandidateIds: Set<string>,
): any[] {
  // Filter to only valid recommendations for this vendor
  let recs = aiRecs.filter(r => r.vendedor_id === vendedorId && allCandidateIds.has(r.client_id));

  // Classify AI picks by estado
  const candidateMap = new Map<string, ScoredCandidate>();
  [...buckets.activos, ...buckets.inactivos, ...buckets.perdidos, ...buckets.potenciales].forEach(c => candidateMap.set(c.client_id, c));

  const picked = { ACTIVO: [] as any[], INACTIVO: [] as any[], PERDIDO: [] as any[], POTENCIAL: [] as any[] };
  const pickedIds = new Set<string>();

  for (const r of recs) {
    const candidate = candidateMap.get(r.client_id);
    if (!candidate) continue;
    const estado = candidate.estado_comercial;
    picked[estado].push(r);
    pickedIds.add(r.client_id);
  }

  // Target distribution
  const targets: Record<string, number> = { ACTIVO: 5, INACTIVO: 1, PERDIDO: 1, POTENCIAL: 1 };
  const bucketMap: Record<string, ScoredCandidate[]> = {
    ACTIVO: buckets.activos,
    INACTIVO: buckets.inactivos,
    PERDIDO: buckets.perdidos,
    POTENCIAL: buckets.potenciales,
  };

  // Fill missing slots deterministically
  for (const [estado, target] of Object.entries(targets)) {
    while (picked[estado].length < target) {
      const available = bucketMap[estado].find(c => !pickedIds.has(c.client_id));
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

  // Combine all and trim to exactly 8
  const result = [...picked.ACTIVO.slice(0, 5), ...picked.INACTIVO.slice(0, 1), ...picked.PERDIDO.slice(0, 1), ...picked.POTENCIAL.slice(0, 1)];

  // If still less than 8, fill from any remaining candidates
  if (result.length < 8) {
    const allBuckets = [...buckets.activos, ...buckets.inactivos, ...buckets.perdidos, ...buckets.potenciales];
    for (const c of allBuckets) {
      if (result.length >= 8) break;
      if (pickedIds.has(c.client_id)) continue;
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

    console.log(`✅ Vendedores: ${vendedoresData.length}`);
    const sellerNameMap = buildSellerNameMap(vendedoresData);

    // ---- 3. Load client_places (geography first) ----
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

    console.log(`📍 client_places: ${clientPlaces?.length || 0}, unique clients: ${clientIdsEnZona.length}`);

    // ---- 4. Load clients (NO 15-day exclusion filter) ----
    let clientes: any[] = [];
    if (clientIdsEnZona.length > 0) {
      const { data, error } = await supabaseClient
        .from("clientes").select("*")
        .in("client_id", clientIdsEnZona)
        .not("monto_total_historico", "is", null)
        .or("excluir_recomendaciones.is.null,excluir_recomendaciones.eq.false")
        .order("monto_total_historico", { ascending: false })
        .limit(300);
      if (error) throw error;
      clientes = data || [];
    }

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
    clientes = clientes.filter(c => !clientesAsignadosHoy.has(c.client_id));

    console.log(`👥 Clientes post-filter: ${clientes.length}`);

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

    console.log(`🆕 Prospectos post-filter: ${prospectos.length}`);

    if (clientes.length === 0 && prospectos.length === 0) {
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
    // 8. COMPUTE BARRIOS TOP per vendor (from ventas_cupra)
    // ============================================================
    const vendorBarriosTop: Map<string, string[]> = new Map();
    const vendorBarrioSums: Map<string, Map<string, number>> = new Map();

    for (const c of clientes) {
      if (!c.barrio_principal) continue;
      const vendedorNames = c.todos_vendedores || [];
      const vendedorActual = c.vendedor_actual || c.vendedor_principal;
      const allNames = vendedorActual ? [vendedorActual, ...vendedorNames] : vendedorNames;
      for (const vName of allNames) {
        const uuid = resolveSellerUUID(vName, sellerNameMap);
        if (!uuid) continue;
        if (!vendorBarrioSums.has(uuid)) vendorBarrioSums.set(uuid, new Map());
        const bMap = vendorBarrioSums.get(uuid)!;
        bMap.set(c.barrio_principal, (bMap.get(c.barrio_principal) || 0) + (c.monto_total_historico || 0));
      }
    }
    for (const [vendorId, barrioMap] of vendorBarrioSums) {
      const sorted = [...barrioMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);
      vendorBarriosTop.set(vendorId, sorted);
    }

    // ============================================================
    // 9. IDENTIFY ANCHORS: Top 5 ACTIVE clients per vendor
    // ============================================================
    const vendorAnchors: Map<string, AnchorPoint[]> = new Map();

    for (const vendedor of vendedoresData) {
      // Find ACTIVE clients affiliated with this vendor, sorted by volume
      const vendorActiveClients = clientes
        .filter(c => {
          const estado = classifyEstado(c.dias_desde_ultima_compra);
          if (estado !== 'ACTIVO') return false;
          const clientVendedor = c.vendedor_actual || c.vendedor_principal;
          const uuid = resolveSellerUUID(clientVendedor, sellerNameMap);
          // Include if this vendor is the primary OR is in the vendor list
          return uuid === vendedor.user_id ||
            (c.todos_vendedores || []).some((v: string) => resolveSellerUUID(v, sellerNameMap) === vendedor.user_id);
        })
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

      // Fallback: if no anchors from active clients, use any clients with coords
      if (anchors.length === 0) {
        for (const c of clientes.slice(0, 20)) {
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

      vendorAnchors.set(vendedor.user_id, anchors);
      console.log(`⚓ ${vendedor.nombre}: ${anchors.length} anclas identificadas`);
    }

    // ============================================================
    // 10. PRE-SCORE with anchors + SELECT BUCKETS (15-5-5-5)
    // ============================================================
    const vendorBuckets: Record<string, { activos: ScoredCandidate[]; inactivos: ScoredCandidate[]; perdidos: ScoredCandidate[]; potenciales: ScoredCandidate[] }> = {};

    for (const vendedor of vendedoresData) {
      const myAnchors = vendorAnchors.get(vendedor.user_id) || [];
      const otherAnchors = [...vendorAnchors.entries()]
        .filter(([id]) => id !== vendedor.user_id)
        .flatMap(([, anch]) => anch);

      const scored = preScoreCandidates(
        clientes, prospectos, placesMap,
        feedbacksMapClientes, feedbacksMapProspectos,
        vendedor.user_id, vendedor.nombre,
        sellerNameMap, myAnchors, otherAnchors,
      );

      // Split into buckets with limits
      const activos = scored.filter(c => c.estado_comercial === 'ACTIVO').slice(0, 15);
      const inactivos = scored.filter(c => c.estado_comercial === 'INACTIVO').slice(0, 5);
      const perdidos = scored.filter(c => c.estado_comercial === 'PERDIDO').slice(0, 5);
      const potenciales = scored.filter(c => c.estado_comercial === 'POTENCIAL').slice(0, 5);

      vendorBuckets[vendedor.user_id] = { activos, inactivos, perdidos, potenciales };
      console.log(`📊 ${vendedor.nombre}: ${activos.length}A ${inactivos.length}I ${perdidos.length}P ${potenciales.length}Pot (30 max enviados a IA)`);
    }

    // ============================================================
    // 11. BUILD PROMPT with estado + barrios_top
    // ============================================================
    const formatCandidate = (c: ScoredCandidate, i: number) =>
      `${i + 1}. [${c.client_id}] ${c.razon_social} | estado:${c.estado_comercial} | score:${c.score_total} geo:${c.score_geo} vendedor:${c.score_vendedor} | dist:${c.distancia_km}km | barrio:${c.barrio || '?'} | vendedor_actual:${c.vendedor_actual || '?'}${c.vendedor_anterior ? ` (anterior: ${c.vendedor_anterior})` : ''} | días_sin_compra:${c.dias_desde_ultima_compra ?? 'N/A'} | ticket:$${c.ticket_promedio ?? 0}${c.tipo_negocio ? ` | tipo:${c.tipo_negocio}` : ''}${c.feedbacks_recientes.length > 0 ? ` | feedbacks: ${c.feedbacks_recientes.map(f => f.feedback).join('; ')}` : ''}`;

    const vendorSections = vendedoresData.map(v => {
      const { activos, inactivos, perdidos, potenciales } = vendorBuckets[v.user_id] || { activos: [], inactivos: [], perdidos: [], potenciales: [] };
      const barriosTop = vendorBarriosTop.get(v.user_id) || [];

      return `
### VENDEDOR: ${v.nombre} (ID: ${v.user_id})
Barrios fuertes: ${barriosTop.length > 0 ? barriosTop.join(', ') : 'Sin datos históricos'}
Cuota: 5 ACTIVOS + 1 INACTIVO + 1 PERDIDO + 1 POTENCIAL = 8

ACTIVOS (${activos.length} candidatos - elegir 5):
${activos.length > 0 ? activos.map(formatCandidate).join('\n') : '(sin candidatos activos)'}

INACTIVOS (${inactivos.length} candidatos - elegir 1):
${inactivos.length > 0 ? inactivos.map(formatCandidate).join('\n') : '(sin candidatos inactivos)'}

PERDIDOS (${perdidos.length} candidatos - elegir 1):
${perdidos.length > 0 ? perdidos.map(formatCandidate).join('\n') : '(sin candidatos perdidos)'}

POTENCIALES (${potenciales.length} candidatos - elegir 1):
${potenciales.length > 0 ? potenciales.map(formatCandidate).join('\n') : '(sin candidatos potenciales)'}`;
    }).join('\n\n');

    const prompt = `${vendorSections}

${instrucciones_adicionales ? `\nINSTRUCCIONES ADICIONALES DEL ASIGNADOR:\n${instrucciones_adicionales}\n` : ''}
TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor, distribución 5-1-1-1).
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
    // 13. VALIDATE 5-1-1-1 DISTRIBUTION + FALLBACK
    // ============================================================
    const allCandidateIds = new Set<string>();
    Object.values(vendorBuckets).forEach(({ activos, inactivos, perdidos, potenciales }) => {
      [...activos, ...inactivos, ...perdidos, ...potenciales].forEach(c => allCandidateIds.add(c.client_id));
    });

    let validatedRecs: any[] = [];
    // Cross-vendor deduplication: track globally picked client_ids
    const globalPickedIds = new Set<string>();

    for (const vendedor of vendedoresData) {
      // Filter out clients already assigned to a previous vendor
      const rawBuckets = vendorBuckets[vendedor.user_id] || { activos: [], inactivos: [], perdidos: [], potenciales: [] };
      const filteredBuckets = {
        activos: rawBuckets.activos.filter(c => !globalPickedIds.has(c.client_id)),
        inactivos: rawBuckets.inactivos.filter(c => !globalPickedIds.has(c.client_id)),
        perdidos: rawBuckets.perdidos.filter(c => !globalPickedIds.has(c.client_id)),
        potenciales: rawBuckets.potenciales.filter(c => !globalPickedIds.has(c.client_id)),
      };

      // Also filter AI recs to exclude already-picked ids
      const filteredAiRecs = aiRecommendations.recomendaciones.filter(
        (r: any) => !globalPickedIds.has(r.client_id)
      );

      const vendorRecs = validateAndFixDistribution(
        filteredAiRecs,
        filteredBuckets,
        vendedor.user_id,
        allCandidateIds,
      );

      // Add this vendor's picks to the global set
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
    // 14. ENRICH & SAVE (with estado_comercial)
    // ============================================================
    const request_id = crypto.randomUUID();
    const validVendedorIds = new Set(vendedoresData.map(v => v.user_id));
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const enrichedRecommendations = [];

    // Build candidate lookup for estado_comercial
    const globalCandidateMap = new Map<string, ScoredCandidate>();
    Object.values(vendorBuckets).forEach(({ activos, inactivos, perdidos, potenciales }) => {
      [...activos, ...inactivos, ...perdidos, ...potenciales].forEach(c => {
        if (!globalCandidateMap.has(c.client_id)) globalCandidateMap.set(c.client_id, c);
      });
    });

    for (const rec of validatedRecs) {
      let vendedorId = rec.vendedor_id;
      if (!vendedorId || !uuidRegex.test(vendedorId) || !validVendedorIds.has(vendedorId)) {
        vendedorId = vendedoresData[0]?.user_id;
        if (!vendedorId) continue;
      }

      const clienteCompleto = clientes.find(c => c.client_id === rec.client_id);
      const prospectoCompleto = !clienteCompleto ? prospectos.find(p => p.place_id === rec.client_id) : null;
      if (!clienteCompleto && !prospectoCompleto) continue;

      const esProspecto = !clienteCompleto;
      const place = !esProspecto ? placesMap.get(rec.client_id) : null;
      const candidateInfo = globalCandidateMap.get(rec.client_id);
      const estado_comercial = candidateInfo?.estado_comercial || (esProspecto ? 'POTENCIAL' : classifyEstado(clienteCompleto?.dias_desde_ultima_compra));

      if (esProspecto && prospectoCompleto) {
        enrichedRecommendations.push({
          request_id,
          client_id: null,
          prospecto_place_id: prospectoCompleto.place_id,
          vendedor_recomendado_id: vendedorId,
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
      } else if (clienteCompleto) {
        enrichedRecommendations.push({
          request_id,
          client_id: rec.client_id,
          prospecto_place_id: null,
          vendedor_recomendado_id: vendedorId,
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

    // Save to DB (strip lat/long/estado_comercial — not in table schema)
    const recommendationsForDb = enrichedRecommendations.map(({ lat, long, estado_comercial, ...rest }) => rest);
    const { error: insertError } = await supabaseClient.from("recomendaciones_ia").insert(recommendationsForDb);
    if (insertError) { console.error("❌ Error insertando:", insertError); throw insertError; }

    console.log(`✅ ${enrichedRecommendations.length} recomendaciones guardadas (con estado_comercial en response)`);

    // Distribution & zones
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
