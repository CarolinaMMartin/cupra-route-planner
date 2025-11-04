import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClienteData {
  client_id: string;
  razon_social?: string | null;
  cuit_dni?: string | null;
  fantasia?: string | null;
  primera_compra?: string | null;
  ultima_compra?: string | null;
  dias_desde_ultima_compra?: number | null;
  cantidad_ordenes?: number | null;
  monto_total_historico?: number | null;
  ticket_promedio?: number | null;
  categoria_recencia?: string | null;
  categoria_volumen?: string | null;
  score_recencia?: number | null;
  score_volumen?: number | null;
  score_comercial?: number | null;
  participacion_mercado?: number | null;
  ciudad_principal?: string | null;
  barrio_principal?: string | null;
  direccion_principal?: string | null;
  provincia_principal?: string | null;
  vendedor_principal?: string | null;
  productos_comprados?: string[] | null;
  todas_ciudades?: string[] | null;
  todos_barrios?: string[] | null;
  todas_direcciones?: string[] | null;
  todos_vendedores?: string[] | null;
  requiere_visita?: string | null;
  canal?: string | null;
  etiquetas?: string[] | null;
  telefonos?: string[] | null;
  emails?: string[] | null;
}

interface RequestBody {
  clientes: ClienteData[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Iniciando carga de clientes CUPRA');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    const body: RequestBody = await req.json();
    console.log('📦 Datos recibidos:', {
      clientes: body.clientes?.length || 0,
    });

    if (!body.clientes || body.clientes.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No se recibieron clientes para procesar',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const results = {
      inserted: 0,
      updated: 0,
      errors: 0,
    };

    console.log('👥 Procesando clientes...');
    
    // Filtrar campos que no existen en la tabla
    const clientesLimpios = body.clientes.map(cliente => {
      const { comuna_principal, todas_comunas, todas_provincias, ...rest } = cliente as any;
      return rest;
    });
    
    // ESTRATEGIA DE PROTECCIÓN DE TRACKING:
    // Separamos la lógica en dos pasos para proteger campos de gestión interna
    // que NO deben sobreescribirse con datos de n8n
    
    // CAMPOS PROTEGIDOS (NO se actualizan desde n8n):
    // - last_recommendation_at: Lo actualiza generate-recommendations
    // - excluir_recomendaciones: Lo actualiza el usuario manualmente
    // - ultima_visita: Lo actualiza el sistema de visitas
    // - id, created_at, updated_at: Gestión automática de Supabase
    
    // CAMPOS ACTUALIZABLES (vienen de n8n):
    const camposVentas = [
      'razon_social', 'cuit_dni', 'fantasia',
      'primera_compra', 'ultima_compra', 'dias_desde_ultima_compra',
      'cantidad_ordenes', 'monto_total_historico', 'ticket_promedio',
      'categoria_recencia', 'categoria_volumen',
      'score_recencia', 'score_volumen', 'score_comercial',
      'participacion_mercado', 'ciudad_principal', 'barrio_principal',
      'direccion_principal', 'provincia_principal', 'vendedor_principal',
      'productos_comprados', 'todas_ciudades', 'todos_barrios',
      'todas_direcciones', 'todos_vendedores', 'requiere_visita', 'canal', 'etiquetas',
      'telefonos', 'emails'
    ];

    // PASO 1: Identificar clientes existentes
    const clientIds = clientesLimpios.map(c => c.client_id);
    const { data: existingClients, error: fetchError } = await supabase
      .from('clientes')
      .select('client_id')
      .in('client_id', clientIds);

    if (fetchError) {
      console.error('❌ Error al verificar clientes existentes:', fetchError);
      return new Response(
        JSON.stringify({
          success: false,
          error: fetchError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const existingClientIds = new Set(existingClients?.map(c => c.client_id) || []);
    const clientesNuevos = clientesLimpios.filter(c => !existingClientIds.has(c.client_id));
    const clientesExistentes = clientesLimpios.filter(c => existingClientIds.has(c.client_id));

    console.log(`📊 Estadísticas: ${clientesNuevos.length} nuevos, ${clientesExistentes.length} existentes`);

    // PASO 2: Insertar clientes nuevos con valores por defecto para campos protegidos
    if (clientesNuevos.length > 0) {
      const clientesParaInsert = clientesNuevos.map(cliente => ({
        ...cliente,
        last_recommendation_at: null,
        excluir_recomendaciones: false,
      }));

      const { error: insertError } = await supabase
        .from('clientes')
        .insert(clientesParaInsert);

      if (insertError) {
        console.error('❌ Error insertando clientes nuevos:', insertError);
        results.errors += clientesNuevos.length;
      } else {
        console.log(`✅ ${clientesNuevos.length} clientes nuevos insertados`);
        results.inserted = clientesNuevos.length;
      }
    }

    // PASO 3: Actualizar clientes existentes SOLO con campos de ventas
    if (clientesExistentes.length > 0) {
      let updateSuccessCount = 0;
      let updateErrorCount = 0;

      for (const cliente of clientesExistentes) {
        // Construir objeto con solo los campos de ventas
        const updateData: any = { updated_at: new Date().toISOString() };
        camposVentas.forEach(campo => {
          if (cliente[campo] !== undefined) {
            updateData[campo] = cliente[campo];
          }
        });

        const { error: updateError } = await supabase
          .from('clientes')
          .update(updateData)
          .eq('client_id', cliente.client_id);

        if (updateError) {
          console.error(`❌ Error actualizando cliente ${cliente.client_id}:`, updateError);
          updateErrorCount++;
        } else {
          updateSuccessCount++;
        }
      }

      console.log(`✅ ${updateSuccessCount} clientes existentes actualizados (solo campos de ventas)`);
      results.updated = updateSuccessCount;
      results.errors += updateErrorCount;
    }

    console.log('🎉 Proceso completado:', results);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Clientes procesados exitosamente',
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('💥 Error general:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
