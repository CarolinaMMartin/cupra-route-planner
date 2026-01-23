import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlaceInput {
  client_id?: string;
  direccion?: string;
  barrio?: string;
  comuna_distrito?: string;
  provincia?: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  google_maps_link?: string;
  is_primary?: boolean;
  geocoding_status?: string;
}

// Normalización de provincia antes de guardar
const normalizeProvince = (prov: string | null | undefined): string | null => {
  if (!prov) return null;
  const trimmed = prov.trim();
  const lower = trimmed.toLowerCase();
  
  // CABA variantes
  if (lower.includes('ciudad autónoma') || lower === 'caba') {
    return 'Ciudad Autónoma de Buenos Aires';
  }
  
  // Provincia de Buenos Aires variantes
  if (lower === 'buenos aires' || 
      lower === 'buenos aires province' ||
      lower === 'provincia de buenos aires') {
    return 'Provincia de Buenos Aires';
  }
  
  // Mantener original si no es variante conocida
  return trimmed;
};

interface PlaceData {
  client_id: string;
  lat: number;
  long: number;
  direccion_principal?: string | null;
  barrio_principal?: string | null;
  comuna?: string | null;
  provincia_principal?: string | null;
  place_id?: string | null;
  google_maps_link?: string | null;
  is_primary?: boolean;
}

interface RequestBody {
  places: PlaceInput[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📍 Iniciando carga de lugares (client_places)');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    const body: RequestBody = await req.json();
    console.log('📦 Datos recibidos:', {
      places: body.places?.length || 0,
    });

    if (!body.places || body.places.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No se recibieron lugares para procesar',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Transformar y validar datos
    const placesData: PlaceData[] = [];
    const errors: string[] = [];

    body.places.forEach((place, index) => {
      // Validar campos requeridos
      if (!place.client_id) {
        errors.push(`Registro ${index}: falta client_id`);
        return;
      }
      if (place.lat === undefined || place.lat === null) {
        errors.push(`Registro ${index}: falta lat`);
        return;
      }
      if (place.lng === undefined || place.lng === null) {
        errors.push(`Registro ${index}: falta lng`);
        return;
      }

      // Mapear campos y limpiar espacios en client_id
      placesData.push({
        client_id: place.client_id.trim(), // Limpiar espacios en blanco
        lat: place.lat,
        long: place.lng, // Nota: columna se llama "long" no "lng"
        direccion_principal: place.direccion?.trim() || null,
        barrio_principal: place.barrio?.trim() || null,
        comuna: place.comuna_distrito?.trim() || null,
        provincia_principal: normalizeProvince(place.provincia),
        place_id: place.place_id?.trim() || null,
        google_maps_link: place.google_maps_link?.trim() || null,
        is_primary: place.is_primary !== undefined ? place.is_primary : true,
      });
    });

    if (errors.length > 0) {
      console.error('❌ Errores de validación:', errors);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Errores de validación',
          details: errors,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    console.log(`✅ ${placesData.length} lugares validados, procediendo con upsert...`);

    // Realizar upsert
    const { error: upsertError } = await supabase
      .from('client_places')
      .upsert(placesData, {
        onConflict: 'client_id,lat,long',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      console.error('❌ Error en upsert:', upsertError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error al insertar lugares',
          details: upsertError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    console.log('🎉 Proceso completado exitosamente');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Lugares procesados exitosamente',
        processed: placesData.length,
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
