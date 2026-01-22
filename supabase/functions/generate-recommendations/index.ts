import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Función para calcular distancia Haversine entre dos puntos (en km)
function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const RECOMMENDATION_SYSTEM_PROMPT = `Eres un sistema experto en optimización de visitas comerciales para vendedores de vinos premium (marca CUPRA).

CONTEXTO DEL NEGOCIO:
- Vendemos vinos en canales ON_TRADE (restaurantes, bares) y OFF_TRADE (vinotecas, retailers)
- Los clientes TOP_10 representan el 80% del volumen
- Los vendedores tienen zonas de trabajo específicas (barrios/comunas asignadas)
- Los vendedores deben mantener contacto regular (ideal: cada 15-20 días)

TU TAREA:
Analizar la cartera de clientes y prospectos y generar recomendaciones de visitas.

⚠️ REGLA OBLIGATORIA - EXACTAMENTE 8 RECOMENDACIONES POR VENDEDOR:
Para CADA vendedor debes generar EXACTAMENTE 8 recomendaciones con esta distribución:
- 6 CLIENTES EXISTENTES de CUPRA (registros con "es_prospecto": false)
- 2 PROSPECTOS NUEVOS (registros con "es_prospecto": true)

Si NO hay suficientes clientes existentes para un vendedor:
- Usa todos los clientes existentes disponibles
- Completa hasta llegar a 8 con prospectos nuevos adicionales

NUNCA devuelvas menos de 8 recomendaciones por vendedor.
NUNCA devuelvas más de 8 recomendaciones por vendedor.

CRITERIO PRINCIPAL DE SELECCIÓN - PROXIMIDAD GEOGRÁFICA:
⚠️ CRÍTICO: Las 8 recomendaciones de cada vendedor DEBEN estar GEOGRÁFICAMENTE CERCANAS entre sí.
- Prioriza clientes y prospectos que estén en el MISMO BARRIO o BARRIOS ADYACENTES
- Usa las coordenadas (lat/long) para determinar cercanía
- Clientes/prospectos a menos de 2km entre sí son ideales
- El vendedor NO puede trasladarse largas distancias en un día

ORDEN DE PRIORIDAD PARA SELECCIÓN:
1. Concentración Geográfica (50%): Agrupar recomendaciones en un cluster geográfico compacto
2. Vendedor Asignado (25%): Priorizar clientes con vendedor_principal del vendedor actual
3. Score Comercial (15%): TOP_10 > ALTO > MEDIO > BAJO
4. Urgencia de Visita (10%): 15-30 días sin compra es la ventana ideal

FEEDBACK DE VENDEDORES:
- Cada registro tiene un array "feedbacks_recientes" con sus feedbacks específicos
- Si hay feedback negativo (ej: "NO volver a recomendar", "Local Cerrado"), EVITA ese registro
- NO inventes feedbacks - solo usa los que existen en el array de cada registro

JUSTIFICACIÓN DETALLADA:
Para cada recomendación, explica en 3-5 líneas:
- Ubicación exacta (barrio/comuna) y por qué está cerca de las otras recomendaciones
- Si es cliente: relación con el vendedor, score comercial, días desde última compra
- Si es prospecto: tipo de negocio, potencial, por qué es interesante
- Por qué es buen momento para visitarlo

FORMATO DE RESPUESTA:
- Genera EXACTAMENTE 8 recomendaciones por cada vendedor en la lista
- Identifica clientes por "es_prospecto": false y prospectos por "es_prospecto": true
- Para prospectos, el "client_id" es en realidad el "place_id" de Google Maps

RECUERDA: 8 recomendaciones por vendedor = 6 clientes existentes + 2 prospectos (o más prospectos si no hay suficientes clientes).`;

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

    console.log("📥 Request recibido:", {
      vendedores,
      provincia,
      comuna,
      barrio,
      area_id,
      max_recomendaciones,
      instrucciones_adicionales,
    });

    // 1. Si hay area_id, cargar vendedores y barrios del área
    let vendedoresFinales = vendedores || [];
    let barriosFinales = barrio || [];
    let comunasFinales = comuna || [];

    if (area_id) {
      console.log("🗺️ Cargando datos del área:", area_id);

      // Cargar vendedores del área
      const { data: areaVendedores } = await supabaseClient
        .from("areas_vendedores")
        .select("vendedor_id")
        .eq("area_id", area_id);

      if (areaVendedores && areaVendedores.length > 0) {
        vendedoresFinales = areaVendedores.map((av) => av.vendedor_id);
      }

      // Cargar barrios del área
      const { data: areaPlaces } = await supabaseClient
        .from("areas_places")
        .select("place_id, places(barrio_principal, comuna)")
        .eq("area_id", area_id);

      if (areaPlaces && areaPlaces.length > 0) {
        barriosFinales = areaPlaces.map((ap: any) => ap.places?.barrio_principal).filter(Boolean);
        comunasFinales = areaPlaces.map((ap: any) => ap.places?.comuna).filter(Boolean);
      }

      console.log("✅ Área procesada:", { vendedoresFinales, barriosFinales, comunasFinales });
    }

    // 2. Cargar datos de vendedores
    // Los IDs pueden venir como profile.id o user_id, intentar buscar por ambos
    const { data: vendedoresData, error: vendedoresError } = await supabaseClient
      .from("profiles")
      .select("user_id, nombre, email, id")
      .or(`user_id.in.(${vendedoresFinales.join(",")}),id.in.(${vendedoresFinales.join(",")})`);

    if (vendedoresError) {
      console.error("❌ Error cargando vendedores:", vendedoresError);
      throw vendedoresError;
    }

    if (!vendedoresData || vendedoresData.length === 0) {
      console.error("❌ No se encontraron vendedores con los IDs proporcionados:", vendedoresFinales);
      return new Response(
        JSON.stringify({
          recomendaciones: [],
          resumen: {
            total_recomendaciones: 0,
            descripcion:
              "No se encontraron vendedores con los IDs proporcionados. Verifica que los vendedores estén activos.",
            distribucion_por_vendedor: {},
            zonas_priorizadas: [],
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`✅ Vendedores cargados: ${vendedoresData.length}`);

    // 3. NUEVO FLUJO: Primero geografía desde client_places, luego datos de clientes
    // Calcular fecha límite de 15 días para rotación (PRIORIZACIÓN, no exclusión)
    const quinceDiasAtras = new Date();
    quinceDiasAtras.setDate(quinceDiasAtras.getDate() - 15);
    const quinceDiasAtrasISO = quinceDiasAtras.toISOString();
    const quinceDiasAtrasDate = quinceDiasAtrasISO.split('T')[0]; // Solo fecha para ventas

    console.log(`📍 Zona seleccionada: ${barriosFinales.length > 0 ? barriosFinales.join(", ") : comunasFinales.length > 0 ? comunasFinales.join(", ") : provincia || "Todas"}`);

    // PASO 1: Cargar ubicaciones de client_places con filtros geográficos PRIMERO
    let placesQuery = supabaseClient
      .from("client_places")
      .select("*")
      .eq("is_primary", true);

    // Aplicar filtros geográficos a client_places
    if (provincia && provincia !== "all") {
      placesQuery = placesQuery.ilike("provincia_principal", `%${provincia}%`);
    }
    
    // FIX: Combinar condiciones de comuna y barrio en un solo .or() para evitar sobrescritura
    const geoConditionsPlaces: string[] = [];
    if (comunasFinales.length > 0) {
      comunasFinales.forEach((c: string) => geoConditionsPlaces.push(`comuna.ilike.%${c}%`));
    }
    if (barriosFinales.length > 0) {
      barriosFinales.forEach((b: string) => geoConditionsPlaces.push(`barrio_principal.ilike.%${b}%`));
    }
    if (geoConditionsPlaces.length > 0) {
      console.log(`🔍 Condiciones geográficas client_places: ${geoConditionsPlaces.join(" OR ")}`);
      placesQuery = placesQuery.or(geoConditionsPlaces.join(","));
    }

    const { data: clientPlaces, error: placesError } = await placesQuery;
    if (placesError) throw placesError;

    console.log(`📍 client_places encontrados: ${clientPlaces?.length || 0}`);

    // FIX: Deduplicar client_ids para evitar IDs repetidos
    const clientIdsEnZona = Array.from(new Set(clientPlaces?.map(p => p.client_id) || []));
    console.log(`🆔 client_ids únicos en zona: ${clientIdsEnZona.length}`);

    // Crear mapa de places para uso posterior
    const placesMap = new Map();
    clientPlaces?.forEach((place) => {
      placesMap.set(place.client_id, place);
    });
    // PASO 2: Cargar datos de clientes SIN filtro de rotación (rotación es priorización)
    let clientes: any[] = [];
    if (clientIdsEnZona.length > 0) {
      const { data: clientesData, error: clientesError } = await supabaseClient
        .from("clientes")
        .select("*")
        .in("client_id", clientIdsEnZona)
        .not("monto_total_historico", "is", null)
        .or("excluir_recomendaciones.is.null,excluir_recomendaciones.eq.false")
        .order("monto_total_historico", { ascending: false })
        .limit(300);

      if (clientesError) throw clientesError;
      clientes = clientesData || [];
    }

    console.log(`👥 Clientes en zona (total): ${clientes.length}`);

    // PASO 3: Cargar client_ids con ventas en últimos 15 días para excluirlos
    const { data: ventasRecientes, error: ventasError } = await supabaseClient
      .from("ventas_cupra")
      .select("client_id")
      .gte("fecha_emision", quinceDiasAtrasDate);

    if (ventasError) {
      console.error("⚠️ Error cargando ventas recientes:", ventasError);
    }

    const clientsConVentasRecientes = new Set(
      ventasRecientes?.map(v => v.client_id).filter(Boolean) || []
    );

    console.log(`💰 Clientes con ventas en últimos 15 días: ${clientsConVentasRecientes.size}`);

    // Filtrar clientes que tienen ventas recientes (estos sí se excluyen)
    if (clientes.length > 0 && clientsConVentasRecientes.size > 0) {
      const clientesAntes = clientes.length;
      clientes = clientes.filter(c => !clientsConVentasRecientes.has(c.client_id));
      console.log(`📊 Clientes después de filtrar ventas recientes: ${clientes.length} (excluidos: ${clientesAntes - clientes.length})`);
    }

    // NUEVO PASO: Cargar asignaciones del día para excluir
    // Calcular "hoy" en zona horaria Argentina (UTC-3) para evitar errores después de las 21:00
    const now = new Date();
    now.setHours(now.getUTCHours() - 3); // Ajustar UTC a Argentina (UTC-3)
    const hoy = now.toISOString().split('T')[0];
    console.log(`📅 Fecha Argentina para filtro: ${hoy}`);
    const { data: asignacionesHoy, error: asignacionesError } = await supabaseClient
      .from("asignaciones_vendedores_clientes")
      .select("client_id, prospecto_place_id, vendedor_id, es_prospecto")
      .gte("created_at", `${hoy}T00:00:00`)
      .neq("estado", "Visitado"); // Solo excluir si no fue visitado aún

    if (asignacionesError) {
      console.error("⚠️ Error cargando asignaciones del día:", asignacionesError);
    }

    // Crear sets para búsqueda rápida
    const clientesAsignadosHoy = new Set(
      asignacionesHoy?.filter(a => a.client_id).map(a => a.client_id) || []
    );
    const prospectosAsignadosHoy = new Set(
      asignacionesHoy?.filter(a => a.prospecto_place_id).map(a => a.prospecto_place_id) || []
    );

    console.log(`📋 Asignaciones del día: ${asignacionesHoy?.length || 0}`);
    console.log(`   - Clientes ya asignados hoy: ${clientesAsignadosHoy.size}`);
    console.log(`   - Prospectos ya asignados hoy: ${prospectosAsignadosHoy.size}`);

    // Filtrar clientes que ya están asignados hoy
    if (clientes.length > 0 && clientesAsignadosHoy.size > 0) {
      const clientesAntes = clientes.length;
      clientes = clientes.filter(c => !clientesAsignadosHoy.has(c.client_id));
      console.log(`📋 Clientes después de filtrar asignados hoy: ${clientes.length} (excluidos: ${clientesAntes - clientes.length})`);
    }

    // PASO 4: Separar clientes por rotación para PRIORIZACIÓN (no exclusión)
    const clientesNoRecomendadosReciente = clientes.filter(c => 
      !c.last_recommendation_at || 
      new Date(c.last_recommendation_at) < quinceDiasAtras
    );

    const clientesRecomendadosReciente = clientes.filter(c => 
      c.last_recommendation_at && 
      new Date(c.last_recommendation_at) >= quinceDiasAtras
    );

    console.log(`✅ Sin recomendación reciente (prioridad alta): ${clientesNoRecomendadosReciente.length}`);
    console.log(`⚠️ Recomendados recientemente (prioridad baja): ${clientesRecomendadosReciente.length}`);

    // Combinar: primero los no recomendados recientemente, luego los recientes
    // Esto permite priorizar sin excluir
    clientes = [...clientesNoRecomendadosReciente, ...clientesRecomendadosReciente];

    // PASO 5: Cargar prospectos nuevos (últimos 30 días) con misma lógica
    const treintaDiasAtras = new Date();
    treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

    let prospectosQuery = supabaseClient
      .from("prospectos")
      .select("*")
      .gte("created_at", treintaDiasAtras.toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    // Aplicar mismos filtros geográficos a prospectos
    if (provincia && provincia !== "all") {
      prospectosQuery = prospectosQuery.ilike("provincia", `%${provincia}%`);
    }
    
    // FIX: Combinar condiciones de comuna y barrio en un solo .or() para evitar sobrescritura
    const geoConditionsProspectos: string[] = [];
    if (comunasFinales.length > 0) {
      comunasFinales.forEach((c: string) => geoConditionsProspectos.push(`comuna.ilike.%${c}%`));
    }
    if (barriosFinales.length > 0) {
      barriosFinales.forEach((b: string) => geoConditionsProspectos.push(`barrio.ilike.%${b}%`));
    }
    if (geoConditionsProspectos.length > 0) {
      console.log(`🔍 Condiciones geográficas prospectos: ${geoConditionsProspectos.join(" OR ")}`);
      prospectosQuery = prospectosQuery.or(geoConditionsProspectos.join(","));
    }

    let { data: prospectosData, error: prospectosError } = await prospectosQuery;
    if (prospectosError) throw prospectosError;

    let prospectos = prospectosData || [];
    console.log(`🆕 Prospectos en zona: ${prospectos.length}`);

    // Filtrar prospectos que ya están asignados hoy
    if (prospectos.length > 0 && prospectosAsignadosHoy.size > 0) {
      const prospectosAntes = prospectos.length;
      prospectos = prospectos.filter(p => !prospectosAsignadosHoy.has(p.place_id));
      console.log(`📋 Prospectos después de filtrar asignados hoy: ${prospectos.length} (excluidos: ${prospectosAntes - prospectos.length})`);
    }

    // Separar prospectos por rotación para priorización
    const prospectosNoRecomendadosReciente = prospectos.filter(p => 
      !p.last_recommendation_at || 
      new Date(p.last_recommendation_at) < quinceDiasAtras
    );

    const prospectosRecomendadosReciente = prospectos.filter(p => 
      p.last_recommendation_at && 
      new Date(p.last_recommendation_at) >= quinceDiasAtras
    );

    console.log(`✅ Prospectos sin recomendación reciente: ${prospectosNoRecomendadosReciente.length}`);
    console.log(`⚠️ Prospectos recomendados recientemente: ${prospectosRecomendadosReciente.length}`);

    // Combinar prospectos priorizados
    prospectos = [...prospectosNoRecomendadosReciente, ...prospectosRecomendadosReciente];

    // PASO 6: Verificar si hay datos para procesar
    if (clientes.length === 0 && prospectos.length === 0) {
      return new Response(
        JSON.stringify({
          recomendaciones: [],
          resumen: {
            total_recomendaciones: 0,
            descripcion: "No se encontraron clientes ni prospectos en la zona seleccionada",
            distribucion_por_vendedor: {},
            zonas_priorizadas: [],
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // PASO 7: Cargar feedback de vendedores
    const { data: feedbacks, error: feedbacksError } = await supabaseClient
      .from("cliente_feedbacks")
      .select(
        "client_id, prospecto_place_id, vendedor_id, visita_realizada, feedback, motivo_no_visita, tipo_interaccion, created_at",
      )
      .order("created_at", { ascending: false });

    if (feedbacksError) {
      console.error("⚠️ Error cargando feedbacks:", feedbacksError);
    }

    console.log(`💬 Feedbacks cargados: ${feedbacks?.length || 0}`);

    // Organizar feedbacks por client_id y prospecto_place_id
    const feedbacksMapClientes = new Map();
    const feedbacksMapProspectos = new Map();
    feedbacks?.forEach((fb) => {
      if (fb.client_id) {
        if (!feedbacksMapClientes.has(fb.client_id)) {
          feedbacksMapClientes.set(fb.client_id, []);
        }
        feedbacksMapClientes.get(fb.client_id).push(fb);
      }
      if (fb.prospecto_place_id) {
        if (!feedbacksMapProspectos.has(fb.prospecto_place_id)) {
          feedbacksMapProspectos.set(fb.prospecto_place_id, []);
        }
        feedbacksMapProspectos.get(fb.prospecto_place_id).push(fb);
      }
    });

    console.log(`📝 Feedbacks de clientes mapeados: ${feedbacksMapClientes.size}`);
    console.log(`📝 Feedbacks de prospectos mapeados: ${feedbacksMapProspectos.size}`);

    // PASO 8: Cargar contexto adicional si hay instrucciones específicas
    let contextoDatos: {
      productos_disponibles?: string[];
      marcas_disponibles?: string[];
      etiquetas_disponibles?: string[];
      productos_mas_vendidos?: string[];
    } = {};
    if (instrucciones_adicionales) {
      console.log("🔍 Analizando instrucciones adicionales para obtener contexto...");

      const { data: ventasData } = await supabaseClient
        .from("ventas_cupra")
        .select("nombre, marca, codigo_producto")
        .limit(500);

      const productosUnicos = new Set<string>();
      const marcasUnicas = new Set<string>();
      ventasData?.forEach((v) => {
        if (v.nombre) productosUnicos.add(v.nombre);
        if (v.marca) marcasUnicas.add(v.marca);
      });

      const { data: clientesEtiquetas } = await supabaseClient
        .from("clientes")
        .select("etiquetas, productos_comprados")
        .not("etiquetas", "is", null);

      const etiquetasUnicas = new Set<string>();
      const productosCompradosUnicos = new Set<string>();
      clientesEtiquetas?.forEach((c) => {
        c.etiquetas?.forEach((e: string) => etiquetasUnicas.add(e));
        c.productos_comprados?.forEach((p: string) => productosCompradosUnicos.add(p));
      });

      contextoDatos = {
        productos_disponibles: Array.from(productosUnicos).slice(0, 50),
        marcas_disponibles: Array.from(marcasUnicas),
        etiquetas_disponibles: Array.from(etiquetasUnicas),
        productos_mas_vendidos: Array.from(productosCompradosUnicos).slice(0, 30),
      };

      console.log("📦 Contexto adicional cargado:", {
        productos: contextoDatos.productos_disponibles?.length || 0,
        marcas: contextoDatos.marcas_disponibles?.length || 0,
        etiquetas: contextoDatos.etiquetas_disponibles?.length || 0,
      });
    }

    // Log final de resumen antes de enviar a IA
    console.log(`📊 RESUMEN FINAL:`);
    console.log(`   - Clientes disponibles para IA: ${clientes.length}`);
    console.log(`   - Prospectos disponibles para IA: ${prospectos.length}`);
    console.log(`   - Total candidatos: ${clientes.length + prospectos.length}`);

    // 4. Preparar contexto para la IA
    const vendedoresContext =
      vendedoresData?.map((v) => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email,
      })) || [];

    // Tomar MÁS clientes que prospectos para priorizar clientes existentes
    // Límite: 80 clientes y 30 prospectos para completar si no hay suficientes clientes
    const clientesContext = clientes.slice(0, 80).map((c, index) => {
      const place = placesMap.get(c.client_id);
      const clientFeedbacks = feedbacksMapClientes.get(c.client_id) || [];
      
      // Marcar prioridad basada en posición (los primeros son los no recomendados recientemente)
      const esPrioridadAlta = index < clientesNoRecomendadosReciente.length;

      return {
        client_id: c.client_id,
        razon_social: c.razon_social,
        categoria_volumen: c.categoria_volumen,
        categoria_recencia: c.categoria_recencia,
        dias_desde_ultima_compra: c.dias_desde_ultima_compra,
        ticket_promedio: c.ticket_promedio,
        barrio: place?.barrio_principal || c.barrio_principal,
        ciudad: c.ciudad_principal,
        provincia: place?.provincia_principal || c.provincia_principal,
        vendedor_principal: c.vendedor_principal,
        score_volumen: c.score_volumen,
        score_recencia: c.score_recencia,
        score_comercial: c.score_comercial,
        lat: place?.lat,
        long: place?.long,
        direccion: place?.direccion_principal,
        es_prospecto: false,
        prioridad_rotacion: esPrioridadAlta ? "alta" : "baja", // Indicar prioridad por rotación
        feedbacks_recientes: clientFeedbacks.slice(0, 3).map((fb: any) => ({
          visita_realizada: fb.visita_realizada,
          feedback: fb.feedback,
          motivo_no_visita: fb.motivo_no_visita,
          tipo_interaccion: fb.tipo_interaccion,
          fecha: fb.created_at,
        })),
      };
    });

    // Agregar más prospectos al contexto (hasta 30 para completar si faltan clientes)
    const prospectosContext = prospectos.slice(0, 30).map((p, index) => {
      const prospectoFeedbacks = feedbacksMapProspectos.get(p.place_id) || [];
      
      // Marcar prioridad basada en posición
      const esPrioridadAlta = index < prospectosNoRecomendadosReciente.length;

      if (prospectoFeedbacks.length > 0) {
        console.log(`🎯 Prospecto con feedback: ${p.nombre} (${p.place_id}) - ${prospectoFeedbacks.length} feedbacks`);
      }

      return {
        client_id: p.place_id,
        razon_social: p.nombre,
        categoria_volumen: "NUEVO",
        categoria_recencia: "NUEVO",
        dias_desde_ultima_compra: null,
        ticket_promedio: 0,
        barrio: p.barrio,
        ciudad: p.ciudad,
        provincia: p.provincia,
        vendedor_principal: null,
        score_volumen: "NUEVO",
        score_recencia: "NUEVO",
        score_comercial: "NUEVO",
        lat: p.latitud,
        long: p.longitud,
        direccion: p.direccion,
        es_prospecto: true,
        prioridad_rotacion: esPrioridadAlta ? "alta" : "baja",
        tipo_negocio: p.tipo_principal,
        rating: p.rating,
        website: p.website,
        telefono: p.telefono,
        feedbacks_recientes: prospectoFeedbacks.slice(0, 3).map((fb: any) => ({
          visita_realizada: fb.visita_realizada,
          feedback: fb.feedback,
          motivo_no_visita: fb.motivo_no_visita,
          tipo_interaccion: fb.tipo_interaccion,
          fecha: fb.created_at,
        })),
      };
    });

    const todosContext = [...clientesContext, ...prospectosContext];

    // Contar clientes y prospectos con prioridad alta para informar a la IA
    const clientesPrioridadAlta = clientesContext.filter(c => c.prioridad_rotacion === "alta").length;
    const prospectosPrioridadAlta = prospectosContext.filter(p => p.prioridad_rotacion === "alta").length;

    const prompt = `
VENDEDORES DISPONIBLES (${vendedoresContext.length} vendedores):
${JSON.stringify(vendedoresContext, null, 2)}

⚠️ IMPORTANTE: Debes generar EXACTAMENTE 8 recomendaciones para CADA vendedor.
Total esperado: ${vendedoresContext.length * 8} recomendaciones (${vendedoresContext.length} vendedores x 8 recomendaciones)

CLIENTES EXISTENTES (es_prospecto: false) - PRIORIDAD ALTA:
Total disponibles: ${clientesContext.length} clientes (${clientesPrioridadAlta} con prioridad_rotacion: "alta")
⚠️ Debes seleccionar hasta 6 clientes existentes por vendedor. Si hay menos de 6, usa todos los disponibles.
${JSON.stringify(clientesContext, null, 2)}

PROSPECTOS NUEVOS (es_prospecto: true) - PARA COMPLETAR:
Total disponibles: ${prospectosContext.length} prospectos (${prospectosPrioridadAlta} con prioridad_rotacion: "alta")
⚠️ Usa prospectos para completar hasta llegar a 8 recomendaciones por vendedor.
${JSON.stringify(prospectosContext, null, 2)}

FILTROS APLICADOS:
- Provincia: ${provincia || "Todas"}
- Comunas: ${comunasFinales.length > 0 ? comunasFinales.join(", ") : "Todas"}
- Barrios: ${barriosFinales.length > 0 ? barriosFinales.join(", ") : "Todos"}
- Excluidos por asignación hoy: ${clientesAsignadosHoy.size} clientes, ${prospectosAsignadosHoy.size} prospectos

DISTRIBUCIÓN OBLIGATORIA POR VENDEDOR:
- IDEAL: 6 clientes existentes + 2 prospectos = 8 total
- SI HAY POCOS CLIENTES: Usa todos los clientes disponibles y completa con más prospectos hasta 8
- EJEMPLO: Si solo hay 3 clientes disponibles → 3 clientes + 5 prospectos = 8 total
- TODOS los vendedores deben tener EXACTAMENTE 8 recomendaciones

PRIORIZACIÓN POR ROTACIÓN:
- Los registros con "prioridad_rotacion": "alta" NO fueron recomendados en los últimos 15 días
- Los registros con "prioridad_rotacion": "baja" fueron recomendados recientemente
- PRIORIZA siempre los de prioridad "alta", pero usa los de prioridad "baja" si es necesario para completar

CRITERIO CLAVE: Selecciona clientes y prospectos que estén GEOGRÁFICAMENTE CERCANOS entre sí para optimizar la ruta del vendedor.

${
  instrucciones_adicionales
    ? `INSTRUCCIONES ADICIONALES DEL ASIGNADOR:
${instrucciones_adicionales}

CONTEXTO DE DATOS DISPONIBLES:
${JSON.stringify(contextoDatos, null, 2)}
`
    : ""
}

GENERA ${vendedoresContext.length * 8} RECOMENDACIONES TOTALES (8 por cada vendedor).`;

    // 5. Llamar a Lovable AI con tool calling
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurado");

    let aiResponse;
    try {
      console.log("🚀 Enviando request a Lovable AI...");
      console.log("📏 Tamaño del prompt:", prompt.length, "caracteres");

      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
          tools: [
            {
              type: "function",
              function: {
                name: "generate_recommendations",
                description: "Genera recomendaciones estructuradas de clientes para visitar",
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
            },
          ],
          tool_choice: { type: "function", function: { name: "generate_recommendations" } },
        }),
      });

      console.log("📨 Respuesta recibida. Status:", aiResponse.status);
    } catch (fetchError) {
      console.error("❌ Error en fetch a Lovable AI:", fetchError);
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(`Error al conectar con Lovable AI: ${errorMsg}`);
    }

    if (!aiResponse.ok) {
      let errorText = "No se pudo leer el error";
      try {
        errorText = await aiResponse.text();
      } catch (readError) {
        console.error("❌ Error leyendo respuesta de error:", readError);
      }
      console.error("❌ Error de Lovable AI:", aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de consultas IA alcanzado. Reintenta en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Por favor recarga tu cuenta." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`Lovable AI error: ${aiResponse.status} - ${errorText}`);
    }

    let aiData;
    try {
      console.log("📖 Leyendo respuesta JSON...");
      aiData = await aiResponse.json();
      console.log("✅ Respuesta de IA recibida:", JSON.stringify(aiData).substring(0, 200));
    } catch (jsonError) {
      console.error("❌ Error parseando JSON de respuesta:", jsonError);
      const errorMsg = jsonError instanceof Error ? jsonError.message : String(jsonError);
      throw new Error(`Error leyendo respuesta de IA: ${errorMsg}`);
    }

    // 6. Extraer recomendaciones del tool call
    const toolCall = aiData.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("❌ Estructura de respuesta IA:", JSON.stringify(aiData));
      throw new Error("No se recibió tool call de la IA");
    }

    console.log("🔧 Tool call arguments:", toolCall.function.arguments?.substring(0, 100));

    if (!toolCall.function.arguments || toolCall.function.arguments.trim() === "") {
      console.error("❌ Arguments vacíos. Tool call completo:", JSON.stringify(toolCall));
      throw new Error("La IA no devolvió argumentos válidos");
    }

    let aiRecommendations;
    try {
      aiRecommendations = JSON.parse(toolCall.function.arguments);
      console.log(`🎯 IA generó ${aiRecommendations.recomendaciones.length} recomendaciones`);
      
      // Logging detallado para debugging
      aiRecommendations.recomendaciones.forEach((rec: any, idx: number) => {
        console.log(`📝 Rec ${idx + 1}: client_id=${rec.client_id?.substring(0, 20)}..., vendedor_id=${rec.vendedor_id}`);
      });
    } catch (parseError) {
      console.error("❌ Error parseando arguments:", parseError);
      console.error("Arguments recibidos:", toolCall.function.arguments);
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Error parseando respuesta de IA: ${errorMsg}`);
    }

    // 7. Enriquecer con datos completos de clientes y prospectos
    const request_id = crypto.randomUUID();
    const enrichedRecommendations = [];
    
    // Crear un Set de vendedor IDs válidos para validación rápida
    const validVendedorIds = new Set(vendedoresData.map(v => v.user_id));
    
    // Función para validar y obtener un vendedor_id válido
    const getValidVendedorId = (vendedorId: string): string | null => {
      // Verificar si el vendedor_id es válido (UUID correcto y existe en la lista)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      if (!vendedorId || !uuidRegex.test(vendedorId)) {
        console.error(`❌ UUID inválido detectado: ${vendedorId}`);
        return null;
      }
      
      if (!validVendedorIds.has(vendedorId)) {
        console.error(`❌ Vendedor ID no encontrado en lista válida: ${vendedorId}`);
        return null;
      }
      
      return vendedorId;
    };

    for (const rec of aiRecommendations.recomendaciones) {
      // Validar vendedor_id antes de procesar
      const validVendedorId = getValidVendedorId(rec.vendedor_id);
      if (!validVendedorId) {
        // Si el vendedor_id es inválido, usar el primer vendedor disponible como fallback
        const fallbackVendedorId = vendedoresData[0]?.user_id;
        if (!fallbackVendedorId) {
          console.error(`❌ No hay vendedores disponibles para fallback. Saltando recomendación.`);
          continue;
        }
        console.log(`⚠️ Usando vendedor fallback ${fallbackVendedorId} para rec ${rec.client_id}`);
        rec.vendedor_id = fallbackVendedorId;
      }
      
      // Buscar primero en clientes
      let clienteCompleto = clientes.find((c) => c.client_id === rec.client_id);
      let prospectoCompleto = null;
      let esProspecto = false;

      // Si no se encuentra en clientes, buscar en prospectos (por place_id)
      if (!clienteCompleto) {
        prospectoCompleto = prospectos.find((p) => p.place_id === rec.client_id);
        if (!prospectoCompleto) continue;
        esProspecto = true;
      }

      // Extraer datos de client_places del Map (solo para clientes)
      const place = !esProspecto ? placesMap.get(rec.client_id) : null;

      if (esProspecto && prospectoCompleto) {
        // Enriquecer con datos de prospecto
        enrichedRecommendations.push({
          request_id,
          client_id: null, // No tiene client_id porque no es cliente aún
          prospecto_place_id: prospectoCompleto.place_id,
          vendedor_recomendado_id: rec.vendedor_id,
          razon_social: prospectoCompleto.nombre,
          cuit_dni: null,
          priority_score: Math.round(rec.score_final),
          score_geografico: Math.round(rec.factores.score_proximidad || 0),
          ai_reasoning: rec.justificacion,
          // Incluir datos adicionales del prospecto en factores_ia
          factores_ia: {
            ...rec.factores,
            tipo_negocio: prospectoCompleto.tipo_principal,
            rating: prospectoCompleto.rating,
            website: prospectoCompleto.website,
          },
          justificacion: rec.justificacion,
          es_prospecto: true,

          // Datos comerciales (vacíos para prospectos)
          monto_total_vendido: 0,
          orders_count: 0,
          avg_ticket: 0,
          first_purchase_at: null,
          last_purchase_at: null,
          days_since_last_purchase: null,
          participacion: 0,

          // Scores especiales para prospectos
          score_volumen_num: null,
          score_recencia_num: null,
          score_volumen: "NUEVO",
          score_recencia: "NUEVO",
          score_comercial: "NUEVO",

          // Ubicación del prospecto
          lat: prospectoCompleto.latitud || null,
          long: prospectoCompleto.longitud || null,
          ciudades: [prospectoCompleto.ciudad],
          provincias: [prospectoCompleto.provincia],
          barrio_principal: prospectoCompleto.barrio,
          direccion_principal: prospectoCompleto.direccion,
          google_maps_link: `https://www.google.com/maps/search/?api=1&query=${prospectoCompleto.latitud},${prospectoCompleto.longitud}&query_place_id=${prospectoCompleto.place_id}`,

          // Otros
          vendedores: [],
          etiquetas: ["NUEVO", "PROSPECTO"],
          telefonos: prospectoCompleto.telefono ? [prospectoCompleto.telefono] : [],
          created_at: new Date().toISOString(),
          last_recomendation: new Date().toISOString(),
          ultima_sugerencia: new Date().toISOString(),
        });
      } else if (clienteCompleto) {
        // Enriquecer con datos de cliente
        enrichedRecommendations.push({
          request_id,
          client_id: rec.client_id,
          prospecto_place_id: null,
          vendedor_recomendado_id: rec.vendedor_id,
          razon_social: clienteCompleto.razon_social,
          cuit_dni: clienteCompleto.cuit_dni,
          priority_score: Math.round(rec.score_final),
          score_geografico: Math.round(rec.factores.score_proximidad || 0),
          ai_reasoning: rec.justificacion,
          factores_ia: rec.factores,
          justificacion: rec.justificacion,
          es_prospecto: false,

          // Datos comerciales
          monto_total_vendido: clienteCompleto.monto_total_historico,
          orders_count: clienteCompleto.cantidad_ordenes,
          avg_ticket: clienteCompleto.ticket_promedio,
          first_purchase_at: clienteCompleto.primera_compra,
          last_purchase_at: clienteCompleto.ultima_compra,
          days_since_last_purchase: clienteCompleto.dias_desde_ultima_compra,
          participacion: clienteCompleto.participacion_mercado,

          // Scores
          score_volumen_num: clienteCompleto.score_volumen,
          score_recencia_num: clienteCompleto.score_recencia,
          score_volumen: clienteCompleto.categoria_volumen,
          score_recencia: clienteCompleto.categoria_recencia,
          score_comercial: clienteCompleto.score_comercial,

          // Ubicación con datos de client_places
          lat: place?.lat || null,
          long: place?.long || null,
          ciudades: clienteCompleto.todas_ciudades || [clienteCompleto.ciudad_principa],
          provincias: [place?.provincia_principal || clienteCompleto.provincia_principal],
          barrio_principal: place?.barrio_principal || clienteCompleto.barrio_principal,
          direccion_principal: place?.direccion_principal || clienteCompleto.direccion_principal,
          google_maps_link: place?.google_maps_link || null,

          // Otros
          vendedores: clienteCompleto.todos_vendedores || [],
          etiquetas: clienteCompleto.etiquetas || [],
          telefonos: [],
          created_at: new Date().toISOString(),
          last_recomendation: new Date().toISOString(),
          ultima_sugerencia: new Date().toISOString(),
        });
      }
    }

    // 8. Guardar en base de datos (excluir lat/long que no existen en la tabla)
    const recommendationsForDb = enrichedRecommendations.map(({ lat, long, ...rest }) => rest);
    const { error: insertError } = await supabaseClient.from("recomendaciones_ia").insert(recommendationsForDb);

    if (insertError) {
      console.error("❌ Error insertando recomendaciones:", insertError);
      throw insertError;
    }

    console.log("✅ Recomendaciones guardadas en BD");

    // NOTA: last_recommendation_at se actualiza en el frontend al confirmar asignaciones (KanbanAssignment.tsx)

    // 9. Calcular distribución por vendedor
    const distribucion: Record<string, number> = {};
    enrichedRecommendations.forEach((rec) => {
      distribucion[rec.vendedor_recomendado_id] = (distribucion[rec.vendedor_recomendado_id] || 0) + 1;
    });

    // 10. Identificar zonas priorizadas
    const zonas = new Set<string>();
    enrichedRecommendations.forEach((rec) => {
      if (rec.barrio_principal) zonas.add(rec.barrio_principal);
    });

    return new Response(
      JSON.stringify({
        recomendaciones: enrichedRecommendations,
        resumen: {
          total_recomendaciones: enrichedRecommendations.length,
          descripcion: aiRecommendations.resumen_analisis,
          distribucion_por_vendedor: distribucion,
          zonas_priorizadas: Array.from(zonas).slice(0, 5),
          request_id,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("❌ Error en generate-recommendations:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Error desconocido",
        details: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
