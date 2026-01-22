import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función auxiliar para procesar en batches
async function processBatch(supabase: any, prospectos: any[], batchSize: number = 50) {
  const results = [];
  const errors = [];

  // Dividir en batches
  for (let i = 0; i < prospectos.length; i += batchSize) {
    const batch = prospectos.slice(i, i + batchSize);
    console.log(`Procesando batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(prospectos.length/batchSize)}`);

    // Preparar datos del batch
    const batchData = [];
    
    for (const prospecto of batch) {
      try {
        // Validar campos requeridos
        if (!prospecto.place_id || !prospecto.nombre || !prospecto.direccion) {
          errors.push({
            prospecto: prospecto.nombre || 'sin nombre',
            error: 'Faltan campos requeridos (place_id, nombre, direccion)'
          });
          continue;
        }

        // Verificar si ya es cliente (solo por teléfono para optimizar)
        let esClienteCupra = false;
        if (prospecto.telefono) {
          const { data: clienteByPhone } = await supabase
            .from('clientes')
            .select('client_id')
            .contains('telefonos', [prospecto.telefono])
            .limit(1)
            .maybeSingle();
          
          esClienteCupra = !!clienteByPhone;
        }

        batchData.push({
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
        });

      } catch (error) {
        errors.push({
          prospecto: prospecto.nombre || 'desconocido',
          error: error instanceof Error ? error.message : 'Error desconocido'
        });
      }
    }

    // Upsert del batch completo
    if (batchData.length > 0) {
      const { data, error } = await supabase
        .from('prospectos')
        .upsert(batchData, { 
          onConflict: 'place_id',
          ignoreDuplicates: false 
        })
        .select('place_id, nombre, es_cliente_cupra');

      if (error) {
        console.error(`Error en batch:`, error);
        errors.push({
          batch: `Batch ${Math.floor(i/batchSize) + 1}`,
          error: error.message
        });
      } else {
        results.push(...(data || []));
      }

      // === SINCRONIZACIÓN CON PLACES (idempotente con fallback GBA) ===
      const provinciasGBA = ['Provincia de Buenos Aires', 'Buenos Aires', 'Buenos Aires Province'];
      const valoresExcluidos = ['Buenos Aires', 'Gran Buenos Aires', 'ELJ', ''];

      for (const prospecto of batchData) {
        let lugarParaPlaces: string | null = null;
        const provinciaOriginal = prospecto.provincia || '';

        if (provinciaOriginal === 'Ciudad Autónoma de Buenos Aires') {
          // CABA: solo barrio (nunca ciudad, puede ser código postal)
          lugarParaPlaces = prospecto.barrio || null;
        } else if (provinciasGBA.includes(provinciaOriginal)) {
          // GBA: fallback ciudad si barrio es null
          const candidato = prospecto.barrio || prospecto.ciudad;
          if (candidato && !valoresExcluidos.includes(candidato)) {
            lugarParaPlaces = candidato;
          }
        }

        if (lugarParaPlaces) {
          const provinciaNormalizada = provinciaOriginal === 'Ciudad Autónoma de Buenos Aires' 
            ? 'Ciudad Autónoma de Buenos Aires' 
            : 'Provincia de Buenos Aires';

          // UPSERT idempotente - sin verificación previa
          const { error: placesError } = await supabase.from('places').upsert({
            barrio_principal: lugarParaPlaces,
            comuna: prospecto.comuna || null,
            provincia_principal: provinciaNormalizada
          }, { 
            onConflict: 'barrio_principal,provincia_principal',
            ignoreDuplicates: true 
          });

          if (!placesError) {
            console.log(`📍 Localidad sincronizada: ${lugarParaPlaces}`);
          }
        }
      }
    }
  }

  return { results, errors };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    
    // Aceptar tanto { prospectos: [...] } como un objeto individual
    let prospectos: any[];
    
    if (Array.isArray(body.prospectos)) {
      prospectos = body.prospectos;
    } else if (body.prospectos) {
      prospectos = [body.prospectos];
    } else if (body.place_id) {
      // Si viene un prospecto individual directamente
      prospectos = [body];
    } else {
      console.error('Invalid payload: debe enviar prospectos o un prospecto individual');
      return new Response(
        JSON.stringify({ error: 'Formato inválido. Envíe { prospectos: [...] } o un prospecto individual' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Procesando ${prospectos.length} prospecto(s) desde n8n`);

    // Procesar en batches de 50
    const { results, errors } = await processBatch(supabase, prospectos, 50);

    console.log(`Procesamiento completo. Éxitos: ${results.length}, Errores: ${errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: prospectos.length,
        inserted: results.length,
        errorsCount: errors.length,
        results: results.slice(0, 100), // Limitar respuesta a primeros 100
        errors: errors.length > 0 ? errors.slice(0, 50) : undefined
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
