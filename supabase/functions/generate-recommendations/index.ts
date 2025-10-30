import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función para calcular distancia Haversine entre dos puntos (en km)
function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const RECOMMENDATION_SYSTEM_PROMPT = `Eres un sistema experto en optimización de visitas comerciales para vendedores de vinos premium (marca CUPRA).

CONTEXTO DEL NEGOCIO:
- Vendemos vinos en canales ON_TRADE (restaurantes, bares) y OFF_TRADE (vinotecas, retailers)
- Los clientes TOP_10 representan el 80% del volumen
- Los vendedores tienen zonas de trabajo específicas (barrios/comunas asignadas)
- Los vendedores deben mantener contacto regular (ideal: cada 30-45 días)

TU TAREA:
Analizar la cartera de clientes y recomendar visitas priorizadas SOLO para las zonas donde cada vendedor opera.

CRITERIOS DE SCORING:
1. Score Comercial (40%):
   - TOP_10: 100 pts | ALTO: 70 pts | MEDIO: 50 pts | BAJO: 30 pts

2. Urgencia de Visita (30%):
   - 30-60 días sin compra: 100 pts (ventana ideal)
   - 60-90 días: 80 pts
   - > 90 días: 60 pts (riesgo de pérdida)
   - < 30 días: 40 pts (puede esperar)

3. Concentración Geográfica (20%) - CRÍTICO:
   - Clientes en MISMO BARRIO/COMUNA: 100 pts
   - Clientes en BARRIOS ADYACENTES (<3km): 70 pts  
   - Clientes en MISMA ZONA FILTRADA: 50 pts
   - Clientes fuera de la zona filtrada: 0 pts (DESCARTAR)
   
   ⚠️ REGLA ESTRICTA: Solo recomendar clientes dentro de los barrios/comunas especificados en los FILTROS APLICADOS.
   NO asignar clientes que estén lejos de la zona de operación del vendedor.

4. Potencial de Venta (10%):
   - Ticket promedio > $500k: 100 pts
   - $200k-$500k: 70 pts
   - < $200k: 40 pts

REGLAS DE DISTRIBUCIÓN:
- PRIORIDAD #1: Respetar las zonas geográficas filtradas (barrios/comunas)
- Distribuir equitativamente entre vendedores DENTRO de sus zonas
- AGRUPAR clientes del MISMO barrio o barrios adyacentes para optimizar rutas
- Si un cliente tiene "vendedor_principal", darle bonus +20 pts a ese vendedor
- No duplicar asignaciones del mismo cliente
- DESCARTAR clientes que no estén en las zonas filtradas

FORMATO DE RESPUESTA:
Para cada recomendación debes proporcionar justificación clara mencionando el barrio/zona y scores detallados.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { vendedores, provincia, comuna, barrio, area_id, max_recomendaciones = 10 } = await req.json();

    console.log('📥 Request recibido:', { vendedores, provincia, comuna, barrio, area_id, max_recomendaciones });

    // 1. Si hay area_id, cargar vendedores y barrios del área
    let vendedoresFinales = vendedores || [];
    let barriosFinales = barrio || [];
    
    if (area_id) {
      console.log('🗺️ Cargando datos del área:', area_id);
      
      // Cargar vendedores del área
      const { data: areaVendedores } = await supabaseClient
        .from('areas_vendedores')
        .select('vendedor_id')
        .eq('area_id', area_id);
      
      if (areaVendedores && areaVendedores.length > 0) {
        vendedoresFinales = areaVendedores.map(av => av.vendedor_id);
      }
      
      // Cargar barrios del área
      const { data: areaPlaces } = await supabaseClient
        .from('areas_places')
        .select('place_id, places(barrio_principal)')
        .eq('area_id', area_id);
      
      if (areaPlaces && areaPlaces.length > 0) {
        barriosFinales = areaPlaces
          .map((ap: any) => ap.places?.barrio_principal)
          .filter(Boolean);
      }
      
      console.log('✅ Área procesada:', { vendedoresFinales, barriosFinales });
    }

    // 2. Cargar datos de vendedores
    // Los IDs pueden venir como profile.id o user_id, intentar buscar por ambos
    const { data: vendedoresData, error: vendedoresError } = await supabaseClient
      .from('profiles')
      .select('user_id, nombre, email, id')
      .or(`user_id.in.(${vendedoresFinales.join(',')}),id.in.(${vendedoresFinales.join(',')})`);

    if (vendedoresError) {
      console.error('❌ Error cargando vendedores:', vendedoresError);
      throw vendedoresError;
    }

    if (!vendedoresData || vendedoresData.length === 0) {
      console.error('❌ No se encontraron vendedores con los IDs proporcionados:', vendedoresFinales);
      return new Response(
        JSON.stringify({
          recomendaciones: [],
          resumen: {
            total_recomendaciones: 0,
            descripcion: 'No se encontraron vendedores con los IDs proporcionados. Verifica que los vendedores estén activos.',
            distribucion_por_vendedor: {},
            zonas_priorizadas: []
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Vendedores cargados: ${vendedoresData.length}`);

    // 3. Construir query de clientes con filtros + JOIN con client_places para coordenadas
    let clientesQuery = supabaseClient
      .from('clientes')
      .select(`
        *,
        client_places!inner(
          lat, long, barrio_principal, comuna, 
          provincia_principal, google_maps_link, direccion_principal
        )
      `)
      .eq('client_places.is_primary', true)
      .not('monto_total_historico', 'is', null)
      .order('monto_total_historico', { ascending: false })
      .limit(200);

    // Aplicar filtro de provincia (case-insensitive) en client_places
    if (provincia && provincia !== 'all') {
      clientesQuery = clientesQuery.ilike('client_places.provincia_principal', `%${provincia}%`);
    }
    
    // Aplicar filtro de barrios (case-insensitive, coincidencias parciales) en client_places
    if (barriosFinales.length > 0) {
      // Crear condiciones OR para cada barrio usando la sintaxis correcta de Supabase
      const barriosConditions = barriosFinales
        .map((b: string) => `barrio_principal.ilike.%${b}%`)
        .join(',');
      clientesQuery = clientesQuery.or(barriosConditions, { foreignTable: 'client_places' });
    }

    let { data: clientes, error: clientesError } = await clientesQuery;
    if (clientesError) throw clientesError;

    console.log(`📊 Clientes cargados con filtros: ${clientes?.length || 0}`);
    
    // Si no se encontraron clientes con los filtros, intentar sin barrios
    if (!clientes || clientes.length === 0) {
      console.log('⚠️ Sin resultados con filtros de barrio. Buscando clientes sin ese filtro...');
      
      const fallbackQuery = supabaseClient
        .from('clientes')
        .select(`
          *,
          client_places!inner(
            lat, long, barrio_principal, comuna, 
            provincia_principal, google_maps_link, direccion_principal
          )
        `)
        .eq('client_places.is_primary', true)
        .not('monto_total_historico', 'is', null)
        .order('monto_total_historico', { ascending: false })
        .limit(100);
      
      if (provincia && provincia !== 'all') {
        fallbackQuery.ilike('client_places.provincia_principal', `%${provincia}%`);
      }
      
      const { data: clientesFallback, error: errorFallback } = await fallbackQuery;
      if (errorFallback) throw errorFallback;
      
      clientes = clientesFallback;
      console.log(`📊 Clientes cargados (fallback): ${clientes?.length || 0}`);
    }

    if (!clientes || clientes.length === 0) {
      return new Response(
        JSON.stringify({
          recomendaciones: [],
          resumen: {
            total_recomendaciones: 0,
            descripcion: 'No se encontraron clientes con los filtros aplicados',
            distribucion_por_vendedor: {},
            zonas_priorizadas: []
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Preparar contexto para la IA
    const vendedoresContext = vendedoresData?.map(v => ({
      id: v.user_id,
      nombre: v.nombre,
      email: v.email
    })) || [];

    const clientesContext = clientes.slice(0, 100).map(c => {
      const place = Array.isArray(c.client_places) ? c.client_places[0] : c.client_places;
      return {
        client_id: c.client_id,
        razon_social: c.razon_social,
        categoria_volumen: c.categoria_volumen,
        categoria_recencia: c.categoria_recencia,
        dias_desde_ultima_compra: c.dias_desde_ultima_compra,
        ticket_promedio: c.ticket_promedio,
        barrio: place?.barrio_principal || c.barrio_principal,
        ciudad: c.ciudad_principa,
        provincia: place?.provincia_principal || c.provincia_principal,
        vendedor_principal: c.vendedor_principal,
        score_volumen: c.score_volumen,
        score_recencia: c.score_recencia,
        score_comercial: c.score_comercial,
        lat: place?.lat,
        long: place?.long,
        direccion: place?.direccion_principal
      };
    });

    const prompt = `
VENDEDORES DISPONIBLES:
${JSON.stringify(vendedoresContext, null, 2)}

CLIENTES CANDIDATOS (top 100 por volumen):
${JSON.stringify(clientesContext, null, 2)}

FILTROS APLICADOS:
- Provincia: ${provincia || 'Todas'}
- Barrios: ${barriosFinales.length > 0 ? barriosFinales.join(', ') : 'Todos'}
- Máximo por vendedor: ${max_recomendaciones}

ANALIZA y genera recomendaciones óptimas distribuyendo equitativamente entre los ${vendedoresContext.length} vendedores.
Considera scores comerciales, recencia, proximidad geográfica y potencial de venta.
`;

    // 5. Llamar a Lovable AI con tool calling
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY no configurado');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: RECOMMENDATION_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'generate_recommendations',
            description: 'Genera recomendaciones estructuradas de clientes para visitar',
            parameters: {
              type: 'object',
              properties: {
                recomendaciones: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      client_id: { type: 'string' },
                      vendedor_id: { type: 'string' },
                      prioridad: { type: 'number', minimum: 1, maximum: 10 },
                      justificacion: { type: 'string' },
                      score_final: { type: 'number' },
                      factores: {
                        type: 'object',
                        properties: {
                          score_comercial: { type: 'number' },
                          proximidad_geografica: { type: 'number' },
                          dias_sin_visita: { type: 'number' },
                          potencial_venta: { type: 'number' }
                        }
                      }
                    },
                    required: ['client_id', 'vendedor_id', 'prioridad', 'justificacion', 'score_final', 'factores']
                  }
                },
                resumen_analisis: { type: 'string' }
              },
              required: ['recomendaciones', 'resumen_analisis']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'generate_recommendations' } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ Error de Lovable AI:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Límite de consultas IA alcanzado. Reintenta en unos minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Lovable AI error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log('✅ Respuesta de IA recibida:', JSON.stringify(aiData).substring(0, 200));

    // 6. Extraer recomendaciones del tool call
    const toolCall = aiData.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error('❌ Estructura de respuesta IA:', JSON.stringify(aiData));
      throw new Error('No se recibió tool call de la IA');
    }

    console.log('🔧 Tool call arguments:', toolCall.function.arguments?.substring(0, 100));
    
    if (!toolCall.function.arguments || toolCall.function.arguments.trim() === '') {
      console.error('❌ Arguments vacíos. Tool call completo:', JSON.stringify(toolCall));
      throw new Error('La IA no devolvió argumentos válidos');
    }

    let aiRecommendations;
    try {
      aiRecommendations = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      console.error('❌ Error parseando arguments:', parseError);
      console.error('Arguments recibidos:', toolCall.function.arguments);
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Error parseando respuesta de IA: ${errorMsg}`);
    }
    console.log(`🎯 IA generó ${aiRecommendations.recomendaciones.length} recomendaciones`);

    // 7. Enriquecer con datos completos de clientes
    const request_id = crypto.randomUUID();
    const enrichedRecommendations = [];

    for (const rec of aiRecommendations.recomendaciones) {
      const clienteCompleto = clientes.find(c => c.client_id === rec.client_id);
      if (!clienteCompleto) continue;

      // Extraer datos de client_places
      const place = Array.isArray(clienteCompleto.client_places) 
        ? clienteCompleto.client_places[0] 
        : clienteCompleto.client_places;

      enrichedRecommendations.push({
        request_id,
        client_id: rec.client_id,
        vendedor_recomendado_id: rec.vendedor_id,
        razon_social: clienteCompleto.razon_social,
        cuit_dni: clienteCompleto.cuit_dni,
        priority_score: Math.round(rec.score_final),
        score_geografico: Math.round(rec.factores.proximidad_geografica),
        ai_reasoning: rec.justificacion,
        factores_ia: rec.factores,
        justificacion: rec.justificacion,
        
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
        ciudades: clienteCompleto.todas_ciudades || [clienteCompleto.ciudad_principa],
        provincias: [place?.provincia_principal || clienteCompleto.provincia_principal],
        barrio_principal: place?.barrio_principal || clienteCompleto.barrio_principal,
        direccion_principal: place?.direccion_principal || clienteCompleto.direccion_principal,
        google_maps_link: place?.google_maps_link || null,
        
        // Otros
        vendedores: clienteCompleto.todos_vendedores || [],
        etiquetas: clienteCompleto.etiquetas || [],
        telefonos: [],
        created_at: new Date().toISOString()
      });
    }

    // 8. Guardar en base de datos
    const { error: insertError } = await supabaseClient
      .from('recomendaciones_ia')
      .insert(enrichedRecommendations);

    if (insertError) {
      console.error('❌ Error insertando recomendaciones:', insertError);
      throw insertError;
    }

    console.log('✅ Recomendaciones guardadas en BD');

    // 9. Calcular distribución por vendedor
    const distribucion: Record<string, number> = {};
    enrichedRecommendations.forEach(rec => {
      distribucion[rec.vendedor_recomendado_id] = (distribucion[rec.vendedor_recomendado_id] || 0) + 1;
    });

    // 10. Identificar zonas priorizadas
    const zonas = new Set<string>();
    enrichedRecommendations.forEach(rec => {
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
          request_id
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('❌ Error en generate-recommendations:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Error desconocido',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});