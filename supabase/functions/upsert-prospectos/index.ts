import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { prospectos } = await req.json();
    
    if (!prospectos || !Array.isArray(prospectos)) {
      console.error('Invalid payload: prospectos debe ser un array');
      return new Response(
        JSON.stringify({ error: 'prospectos debe ser un array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Procesando ${prospectos.length} prospectos desde n8n`);

    const results = [];
    const errors = [];

    for (const prospecto of prospectos) {
      try {
        // Validar campos requeridos
        if (!prospecto.place_id || !prospecto.nombre || !prospecto.direccion) {
          errors.push({
            prospecto: prospecto.nombre || 'sin nombre',
            error: 'Faltan campos requeridos (place_id, nombre, direccion)'
          });
          continue;
        }

        // Verificar si ya es cliente de Cupra buscando por teléfono o nombre
        let esClienteCupra = false;
        
        if (prospecto.telefono) {
          const { data: clienteByPhone } = await supabase
            .from('clientes')
            .select('client_id')
            .contains('telefonos', [prospecto.telefono])
            .maybeSingle();
          
          if (clienteByPhone) {
            esClienteCupra = true;
            console.log(`Prospecto ${prospecto.nombre} ya es cliente (por teléfono)`);
          }
        }

        // Si no se encontró por teléfono, buscar por nombre
        if (!esClienteCupra && prospecto.nombre) {
          const { data: clienteByName } = await supabase
            .from('clientes')
            .select('client_id')
            .ilike('razon_social', `%${prospecto.nombre}%`)
            .maybeSingle();
          
          if (clienteByName) {
            esClienteCupra = true;
            console.log(`Prospecto ${prospecto.nombre} ya es cliente (por nombre)`);
          }
        }

        // Preparar datos para insertar/actualizar
        const prospectoData = {
          place_id: prospecto.place_id,
          nombre: prospecto.nombre,
          telefono: prospecto.telefono || null,
          direccion: prospecto.direccion,
          barrio: prospecto.barrio || null,
          comuna: prospecto.comuna || null,
          ciudad: prospecto.ciudad || 'Buenos Aires',
          provincia: prospecto.provincia || 'Ciudad Autónoma de Buenos Aires',
          latitud: prospecto.latitud || 0,
          longitud: prospecto.longitud || 0,
          rating: prospecto.rating || 0,
          total_ratings: prospecto.total_ratings || 0,
          nivel_precio: prospecto.nivel_precio || null,
          tipo_principal: prospecto.tipo_principal || null,
          tipos: prospecto.tipos || [],
          sirve_vinos: prospecto.sirve_vinos || false,
          website: prospecto.website || null,
          estado_negocio: prospecto.estado_negocio || null,
          es_cliente_cupra: esClienteCupra,
          updated_at: new Date().toISOString()
        };

        // Upsert en la tabla prospectos (actualiza si existe, inserta si no)
        const { data, error } = await supabase
          .from('prospectos')
          .upsert(prospectoData, { 
            onConflict: 'place_id',
            ignoreDuplicates: false 
          })
          .select()
          .single();

        if (error) {
          console.error(`Error al procesar prospecto ${prospecto.nombre}:`, error);
          errors.push({
            prospecto: prospecto.nombre,
            error: error.message
          });
        } else {
          results.push({
            place_id: data.place_id,
            nombre: data.nombre,
            es_cliente_cupra: data.es_cliente_cupra
          });
        }

      } catch (error) {
        console.error(`Error inesperado al procesar prospecto:`, error);
        errors.push({
          prospecto: prospecto.nombre || 'desconocido',
          error: error instanceof Error ? error.message : 'Error desconocido'
        });
      }
    }

    console.log(`Procesamiento completo. Éxitos: ${results.length}, Errores: ${errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: prospectos.length,
        inserted: results.length,
        errorsCount: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error general en upsert-prospectos:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Error desconocido',
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
