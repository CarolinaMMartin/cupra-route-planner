import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VentaData {
  client_id?: string | null;
  ticket?: string | null;
  letra?: string | null;
  fecha_emision?: string | null;
  cuit_dni?: string | null;
  razon_social?: string | null;
  fantasia?: string | null;
  cajas?: number | null;
  codigo_producto?: string | null;
  nombre?: string | null;
  marca?: string | null;
  facturacion_ars?: number | null;
  vendedor?: string | null;
  telefono?: string | null;
  celular?: string | null;
  correo?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  categorias?: string | null;
}

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
  ciudad_principa?: string | null;
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

interface PlaceData {
  client_id: string;
  lat: number;
  long: number;
  barrio_principal?: string | null;
  direccion_principal?: string | null;
  provincia_principal?: string | null;
  comuna?: string | null;
  place_id?: string | null;
  google_maps_link?: string | null;
  is_primary?: boolean;
}

interface RequestBody {
  ventas?: VentaData[];
  clientes?: ClienteData[];
  places?: PlaceData[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Iniciando carga de ventas CUPRA');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    const body: RequestBody = await req.json();
    console.log('📦 Datos recibidos:', {
      ventas: body.ventas?.length || 0,
      clientes: body.clientes?.length || 0,
      places: body.places?.length || 0,
    });

    const results = {
      ventas: { inserted: 0, updated: 0, errors: 0 },
      clientes: { inserted: 0, updated: 0, errors: 0 },
      places: { inserted: 0, updated: 0, errors: 0 },
    };

    // 1. UPSERT Ventas
    if (body.ventas && body.ventas.length > 0) {
      console.log('💰 Procesando ventas...');
      
      const { error: ventasError } = await supabase
        .from('ventas_cupra')
        .upsert(body.ventas, {
          onConflict: 'ticket,letra,fecha_emision,client_id',
          ignoreDuplicates: false,
        });

      if (ventasError) {
        console.error('❌ Error en ventas:', ventasError);
        results.ventas.errors = body.ventas.length;
      } else {
        console.log('✅ Ventas procesadas exitosamente');
        results.ventas.inserted = body.ventas.length;
      }
    }

    // 2. UPSERT Clientes
    if (body.clientes && body.clientes.length > 0) {
      console.log('👥 Procesando clientes...');
      
      const { error: clientesError } = await supabase
        .from('clientes')
        .upsert(body.clientes, {
          onConflict: 'client_id',
          ignoreDuplicates: false,
        });

      if (clientesError) {
        console.error('❌ Error en clientes:', clientesError);
        results.clientes.errors = body.clientes.length;
      } else {
        console.log('✅ Clientes procesados exitosamente');
        results.clientes.inserted = body.clientes.length;
      }
    }

    // 3. UPSERT Client Places
    if (body.places && body.places.length > 0) {
      console.log('📍 Procesando lugares...');
      
      const { error: placesError } = await supabase
        .from('client_places')
        .upsert(body.places, {
          onConflict: 'client_id,lat,long',
          ignoreDuplicates: false,
        });

      if (placesError) {
        console.error('❌ Error en places:', placesError);
        results.places.errors = body.places.length;
      } else {
        console.log('✅ Places procesados exitosamente');
        results.places.inserted = body.places.length;
      }
    }

    console.log('🎉 Proceso completado:', results);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Datos procesados exitosamente',
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
