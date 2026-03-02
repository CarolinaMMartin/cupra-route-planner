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

// Build a name→UUID mapping for seller names in ventas/clientes → profiles
function buildSellerNameMap(vendedoresData: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of vendedoresData) {
    // Exact match
    map.set(v.nombre.toUpperCase().trim(), v.user_id);
    // Also try without accents / common variations
    const normalized = v.nombre.toUpperCase().trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  // Fuzzy: check if any key contains or is contained
  for (const [key, uuid] of nameMap) {
    if (key.includes(upper) || upper.includes(key)) return uuid;
  }
  return null;
}

// ============================================================
// PRE-SCORING: Deterministic scoring before AI call
// ============================================================

interface ScoredCandidate {
  client_id: string;
  razon_social: string;
  es_prospecto: boolean;
  // Computed scores (0-100)
  score_geo: number;        // geographic proximity to cluster center
  score_comercial: number;  // business value 
  score_rotacion: number;   // rotation priority (longer since last rec = higher)
  score_vendedor: number;   // seller affinity (is this seller the current manager?)
  score_total: number;      // weighted composite
  // Distance in km to cluster center
  distancia_km: number;
  // Raw data for AI context
  lat: number | null;
  long: number | null;
  barrio: string | null;
  direccion: string | null;
  vendedor_actual: string | null;
  vendedor_principal: string | null;
  vendedor_anterior: string | null;  // if different from actual
  dias_desde_ultima_compra: number | null;
  ticket_promedio: number | null;
  monto_total_historico: number | null;
  categoria_volumen: string | null;
  score_comercial_raw: number | null;
  feedbacks_recientes: any[];
  // Prospect-specific
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
  quinceDiasAtras: Date,
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  // --- Collect all candidate lat/longs to compute cluster center ---
  const allLats: number[] = [];
  const allLongs: number[] = [];

  // First pass: gather coordinates
  for (const c of clientes) {
    const place = placesMap.get(c.client_id);
    if (place?.lat && place?.long) {
      allLats.push(Number(place.lat));
      allLongs.push(Number(place.long));
    }
  }
  for (const p of prospectos) {
    if (p.latitud && p.longitud) {
      allLats.push(Number(p.latitud));
      allLongs.push(Number(p.longitud));
    }
  }

  // Cluster center = centroid of all candidates
  const centerLat = allLats.length > 0 ? allLats.reduce((a, b) => a + b, 0) / allLats.length : 0;
  const centerLong = allLongs.length > 0 ? allLongs.reduce((a, b) => a + b, 0) / allLongs.length : 0;

  // --- Score clients ---
  for (const c of clientes) {
    const place = placesMap.get(c.client_id);
    const lat = place?.lat ? Number(place.lat) : null;
    const long = place?.long ? Number(place.long) : null;

    // Geographic score (closer = higher, max at 0km, 0 at >10km)
    let distancia_km = 999;
    let score_geo = 0;
    if (lat && long && centerLat && centerLong) {
      distancia_km = calcularDistanciaKm(centerLat, centerLong, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km * 10)); // 0km=100, 10km=0
    }

    // Commercial score based on existing score_comercial (1-5 scale → 0-100)
    const rawScore = c.score_comercial ?? 0;
    const score_comercial = Math.min(100, (rawScore / 5) * 100);

    // Rotation score: days since last recommendation (longer = higher priority)
    let score_rotacion = 100; // default: never recommended = max priority
    if (c.last_recommendation_at) {
      const daysSinceRec = (Date.now() - new Date(c.last_recommendation_at).getTime()) / (1000 * 60 * 60 * 24);
      score_rotacion = Math.min(100, daysSinceRec * 5); // 20 days = 100
    }

    // Seller affinity: does this client belong to this seller?
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

    // Weighted composite: geo 50%, seller 25%, commercial 15%, rotation 10%
    const score_total = score_geo * 0.50 + score_vendedor * 0.25 + score_comercial * 0.15 + score_rotacion * 0.10;

    candidates.push({
      client_id: c.client_id,
      razon_social: c.razon_social || c.fantasia || 'Sin nombre',
      es_prospecto: false,
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
    if (lat && long && centerLat && centerLong) {
      distancia_km = calcularDistanciaKm(centerLat, centerLong, lat, long);
      score_geo = Math.max(0, 100 - (distancia_km * 10));
    }

    // Prospects: commercial score based on rating
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

    // Prospects have no seller affinity (score_vendedor = 0)
    const score_total = score_geo * 0.60 + score_comercial * 0.20 + score_rotacion * 0.20;

    candidates.push({
      client_id: p.place_id,
      razon_social: p.nombre,
      es_prospecto: true,
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

  // Sort by total score descending
  candidates.sort((a, b) => b.score_total - a.score_total);
  return candidates;
}

// ============================================================
// REDUCED AI PROMPT (vendor-centric)
// ============================================================

const RECOMMENDATION_SYSTEM_PROMPT = `Eres un planificador de rutas de ventas para vendedores de vinos premium (marca CUPRA).

CONTEXTO: Vendemos vinos en canales ON_TRADE (restaurantes/bares) y OFF_TRADE (vinotecas/retailers).

TU TAREA: De los candidatos PRE-RANKEADOS que recibís por vendedor, seleccioná los mejores 8 para la agenda del día.

REGLAS:
1. Seleccioná EXACTAMENTE 8 por vendedor: idealmente 6 clientes existentes + 2 prospectos
2. Si hay menos de 6 clientes, completá con más prospectos hasta llegar a 8
3. PRIORIZÁ la concentración geográfica: las 8 visitas deben formar una ruta compacta
4. Los candidatos ya vienen con scores calculados (geo, comercial, rotación, afinidad_vendedor)
5. Si un cliente tiene "vendedor_anterior", mencionalo en la justificación
6. Si hay feedbacks negativos, evitá ese candidato

JUSTIFICACIÓN: Para cada seleccionado, escribí 2-3 líneas explicando:
- Por qué está en la ruta (cercanía a otros, score alto, etc.)
- Dato comercial relevante (ticket, días sin compra, cambio de vendedor)

FORMATO: Usá la tool "generate_recommendations" con la estructura indicada.`;

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

    // ---- 4. Load clients ----
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

    // ---- 5. Exclude clients with recent sales (15 days) ----
    const quinceDiasAtras = new Date();
    quinceDiasAtras.setDate(quinceDiasAtras.getDate() - 15);
    const quinceDiasAtrasDate = quinceDiasAtras.toISOString().split('T')[0];

    const { data: ventasRecientes } = await supabaseClient
      .from("ventas_cupra").select("client_id").gte("fecha_emision", quinceDiasAtrasDate);
    const clientsConVentasRecientes = new Set(ventasRecientes?.map(v => v.client_id).filter(Boolean) || []);
    clientes = clientes.filter(c => !clientsConVentasRecientes.has(c.client_id));

    // ---- 6. Exclude clients already assigned today ----
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

    // ---- 7. Load prospects ----
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
    // 9. PRE-SCORE: Per-vendor deterministic scoring
    // ============================================================
    const vendorCandidates: Record<string, ScoredCandidate[]> = {};

    for (const vendedor of vendedoresData) {
      const scored = preScoreCandidates(
        clientes, prospectos, placesMap,
        feedbacksMapClientes, feedbacksMapProspectos,
        vendedor.user_id, vendedor.nombre,
        sellerNameMap, quinceDiasAtras,
      );
      
      // Take top 20 clients + top 10 prospects for AI
      const topClients = scored.filter(c => !c.es_prospecto).slice(0, 20);
      const topProspects = scored.filter(c => c.es_prospecto).slice(0, 10);
      vendorCandidates[vendedor.user_id] = [...topClients, ...topProspects];

      console.log(`📊 ${vendedor.nombre}: ${topClients.length} clientes + ${topProspects.length} prospectos pre-scored`);
    }

    // ============================================================
    // 10. BUILD REDUCED AI PROMPT (vendor-centric)
    // ============================================================
    const vendorSections = vendedoresData.map(v => {
      const candidates = vendorCandidates[v.user_id] || [];
      const clientCandidates = candidates.filter(c => !c.es_prospecto);
      const prospectCandidates = candidates.filter(c => c.es_prospecto);

      return `
### VENDEDOR: ${v.nombre} (ID: ${v.user_id})
Candidatos pre-rankeados: ${clientCandidates.length} clientes + ${prospectCandidates.length} prospectos
Seleccioná 8 (ideal: 6 clientes + 2 prospectos)

CLIENTES (ordenados por score_total descendente):
${clientCandidates.map((c, i) => 
  `${i+1}. [${c.client_id}] ${c.razon_social} | score_total:${c.score_total} geo:${c.score_geo} comercial:${c.score_comercial} vendedor:${c.score_vendedor} rotacion:${c.score_rotacion} | dist:${c.distancia_km}km | barrio:${c.barrio || '?'} | vendedor_actual:${c.vendedor_actual || '?'}${c.vendedor_anterior ? ` (anterior: ${c.vendedor_anterior})` : ''} | días_sin_compra:${c.dias_desde_ultima_compra ?? '?'} | ticket:$${c.ticket_promedio ?? 0} | vol:${c.categoria_volumen || '?'}${c.feedbacks_recientes.length > 0 ? ` | feedbacks: ${c.feedbacks_recientes.map(f => f.feedback).join('; ')}` : ''}`
).join('\n')}

PROSPECTOS (ordenados por score_total descendente):
${prospectCandidates.map((c, i) => 
  `${i+1}. [${c.client_id}] ${c.razon_social} | score_total:${c.score_total} geo:${c.score_geo} | dist:${c.distancia_km}km | barrio:${c.barrio || '?'} | tipo:${c.tipo_negocio || '?'} | rating:${c.rating ?? '?'}${c.feedbacks_recientes.length > 0 ? ` | feedbacks: ${c.feedbacks_recientes.map(f => f.feedback).join('; ')}` : ''}`
).join('\n')}`;
    }).join('\n\n');

    const prompt = `${vendorSections}

${instrucciones_adicionales ? `\nINSTRUCCIONES ADICIONALES DEL ASIGNADOR:\n${instrucciones_adicionales}\n` : ''}
TOTAL ESPERADO: ${vendedoresData.length * 8} recomendaciones (8 por vendedor).
Seleccioná priorizando ruta geográfica compacta.`;

    console.log(`📏 Prompt reducido: ${prompt.length} chars (vs ~65K antes)`);

    // ============================================================
    // 11. CALL AI
    // ============================================================
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurado");

    console.log("🚀 Enviando a IA...");
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
            description: "Genera recomendaciones de visitas optimizadas por ruta",
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
    // 12. ENRICH & SAVE
    // ============================================================
    const request_id = crypto.randomUUID();
    const validVendedorIds = new Set(vendedoresData.map(v => v.user_id));
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const enrichedRecommendations = [];

    for (const rec of aiRecommendations.recomendaciones) {
      // Validate vendedor_id
      let vendedorId = rec.vendedor_id;
      if (!vendedorId || !uuidRegex.test(vendedorId) || !validVendedorIds.has(vendedorId)) {
        vendedorId = vendedoresData[0]?.user_id;
        if (!vendedorId) continue;
      }

      // Find in clients first
      const clienteCompleto = clientes.find(c => c.client_id === rec.client_id);
      const prospectoCompleto = !clienteCompleto ? prospectos.find(p => p.place_id === rec.client_id) : null;
      if (!clienteCompleto && !prospectoCompleto) continue;

      const esProspecto = !clienteCompleto;
      const place = !esProspecto ? placesMap.get(rec.client_id) : null;

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

    // Save to DB (strip lat/long)
    const recommendationsForDb = enrichedRecommendations.map(({ lat, long, ...rest }) => rest);
    const { error: insertError } = await supabaseClient.from("recomendaciones_ia").insert(recommendationsForDb);
    if (insertError) { console.error("❌ Error insertando:", insertError); throw insertError; }

    console.log(`✅ ${enrichedRecommendations.length} recomendaciones guardadas`);

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
