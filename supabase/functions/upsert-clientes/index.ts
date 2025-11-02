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
    
    const { error: clientesError } = await supabase
      .from('clientes')
      .upsert(body.clientes, {
        onConflict: 'client_id',
        ignoreDuplicates: false,
      });

    if (clientesError) {
      console.error('❌ Error en clientes:', clientesError);
      results.errors = body.clientes.length;
      
      return new Response(
        JSON.stringify({
          success: false,
          error: clientesError.message,
          results,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    console.log('✅ Clientes procesados exitosamente');
    results.inserted = body.clientes.length;

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
