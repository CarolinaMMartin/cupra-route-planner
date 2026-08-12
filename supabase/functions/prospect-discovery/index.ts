import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CABA_VIEWPORT = {
  low: { latitude: -34.705, longitude: -58.531 },
  high: { latitude: -34.526, longitude: -58.335 },
};

const ALLOWED_TYPES = new Set(['liquor_store', 'wine_bar', 'restaurant', 'bar']);
const ALLOWED_QUEUE_STATUSES = new Set(['NUEVO', 'EN_REVISION', 'DESCARTADO']);
const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.attributions',
].join(',');

interface SearchRequest {
  action: 'search';
  query: string;
  zone?: string;
  includedType?: string | null;
}

interface QueueRequest {
  action: 'queue';
  placeIds: string[];
  query: string;
  zone?: string;
}

interface ListRequest {
  action: 'list';
}

interface StatusRequest {
  action: 'update_status';
  placeId: string;
  status: string;
}

type DiscoveryRequest = SearchRequest | QueueRequest | ListRequest | StatusRequest;

interface GoogleAttribution {
  provider?: string;
  providerUri?: string;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  attributions?: GoogleAttribution[];
}

interface GoogleSearchResponse {
  places?: GooglePlace[];
  error?: unknown;
}

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const normalizeName = (value: unknown): string => String(value || '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]/g, '');

const isValidPlaceId = (value: unknown): value is string => (
  typeof value === 'string' && value.length >= 5 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value)
);

const premiumScore = (place: GooglePlace): number => {
  let score = 0;
  const rating = Number(place.rating || 0);
  const ratings = Number(place.userRatingCount || 0);
  const types = new Set<string>(place.types || []);

  if (types.has('liquor_store') || types.has('wine_bar')) score += 4;
  if (rating >= 4.5) score += 3;
  else if (rating >= 4.2) score += 2;
  else if (rating >= 4) score += 1;
  if (ratings >= 100) score += 2;
  else if (ratings >= 25) score += 1;
  if (place.priceLevel === 'PRICE_LEVEL_EXPENSIVE' || place.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE') score += 2;
  return score;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Método no permitido' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const accessToken = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return jsonResponse({ success: false, error: 'Sesión requerida' }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) return jsonResponse({ success: false, error: 'Sesión inválida o vencida' }, 401);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('rol, activo')
      .eq('user_id', authData.user.id)
      .single();
    if (profileError || profile?.rol !== 'asignador' || profile.activo !== true) {
      return jsonResponse({ success: false, error: 'Solo un asignador puede buscar prospectos' }, 403);
    }

    const body = await req.json() as DiscoveryRequest;

    if (body.action === 'list') {
      const { data, error } = await supabase
        .from('prospect_discovery_queue')
        .select('id, place_id, fuente, estado, consulta, zona, notas, discovered_at, updated_at')
        .in('estado', ['NUEVO', 'EN_REVISION'])
        .order('discovered_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(`No se pudo leer la cola: ${error.message}`);
      return jsonResponse({ success: true, queue: data || [] });
    }

    if (body.action === 'update_status') {
      if (!isValidPlaceId(body.placeId) || !ALLOWED_QUEUE_STATUSES.has(body.status)) {
        return jsonResponse({ success: false, error: 'Estado o place_id inválido' }, 400);
      }
      const { error } = await supabase
        .from('prospect_discovery_queue')
        .update({ estado: body.status })
        .eq('place_id', body.placeId);
      if (error) throw new Error(`No se pudo actualizar la cola: ${error.message}`);
      return jsonResponse({ success: true });
    }

    if (body.action === 'queue') {
      const query = String(body.query || '').trim().slice(0, 120);
      const zone = String(body.zone || '').trim().slice(0, 80) || null;
      const placeIds = Array.from(new Set((body.placeIds || []).filter(isValidPlaceId))).slice(0, 20);
      if (!query || placeIds.length === 0) {
        return jsonResponse({ success: false, error: 'Consulta y lugares requeridos' }, 400);
      }

      const { data: existing, error: existingError } = await supabase
        .from('prospect_discovery_queue')
        .select('place_id, estado')
        .in('place_id', placeIds);
      if (existingError) throw new Error(`No se pudo validar la cola: ${existingError.message}`);

      const existingMap = new Map((existing || []).map((row) => [row.place_id, row.estado]));
      const newIds = placeIds.filter((placeId) => !existingMap.has(placeId));
      const discardedIds = placeIds.filter((placeId) => existingMap.get(placeId) === 'DESCARTADO');

      if (newIds.length > 0) {
        const { error: insertError } = await supabase.from('prospect_discovery_queue').insert(
          newIds.map((placeId) => ({
            place_id: placeId,
            consulta: query,
            zona: zone,
            creado_por: authData.user.id,
          })),
        );
        if (insertError) throw new Error(`No se pudo guardar la cola: ${insertError.message}`);
      }

      if (discardedIds.length > 0) {
        const { error: reactivateError } = await supabase
          .from('prospect_discovery_queue')
          .update({ estado: 'NUEVO', consulta: query, zona: zone, creado_por: authData.user.id })
          .in('place_id', discardedIds);
        if (reactivateError) throw new Error(`No se pudo reactivar la cola: ${reactivateError.message}`);
      }

      return jsonResponse({
        success: true,
        added: newIds.length + discardedIds.length,
        already_queued: placeIds.length - newIds.length - discardedIds.length,
      });
    }

    if (body.action !== 'search') return jsonResponse({ success: false, error: 'Acción inválida' }, 400);

    const query = String(body.query || '').trim();
    const zone = String(body.zone || '').trim();
    const includedType = body.includedType && ALLOWED_TYPES.has(body.includedType)
      ? body.includedType
      : null;
    if (query.length < 3 || query.length > 120 || zone.length > 80) {
      return jsonResponse({ success: false, error: 'Consulta o zona inválida' }, 400);
    }

    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
      || Deno.env.get('VITE_GOOGLE_MAPS_API_KEY')
      || '';
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY') || '';
    if (!googleApiKey || !lovableApiKey) {
      return jsonResponse({
        success: false,
        error: 'Google Places no está configurado: falta la conexión de Google Maps',
      }, 503);
    }

    const textQuery = [query, zone, 'Ciudad Autónoma de Buenos Aires', 'Argentina'].filter(Boolean).join(', ');
    const searchBody: Record<string, unknown> = {
      textQuery,
      pageSize: 10,
      languageCode: 'es',
      regionCode: 'AR',
      locationRestriction: { rectangle: CABA_VIEWPORT },
    };
    if (includedType) {
      searchBody.includedType = includedType;
      searchBody.strictTypeFiltering = true;
    }

    const googleResponse = await fetch('https://connector-gateway.lovable.dev/google_maps/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
        'X-Connection-Api-Key': googleApiKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify(searchBody),
    });
    const googleData = await googleResponse.json() as GoogleSearchResponse;
    if (!googleResponse.ok) {
      console.error('Google Places error:', googleData);
      return jsonResponse({ success: false, error: 'Google Places no pudo completar la búsqueda' }, 502);
    }

    const places = (googleData.places || [])
      .filter((place): place is GooglePlace & { id: string } => Boolean(place.id) && place.businessStatus !== 'CLOSED_PERMANENTLY');
    const placeIds = places.map((place) => place.id);

    const queuedIds = new Set<string>();
    const existingProspectIds = new Set<string>();
    if (placeIds.length > 0) {
      const [{ data: queued }, { data: existingProspects }] = await Promise.all([
        supabase.from('prospect_discovery_queue').select('place_id').in('place_id', placeIds).neq('estado', 'DESCARTADO'),
        supabase.from('prospectos').select('place_id').in('place_id', placeIds),
      ]);
      for (const row of queued || []) queuedIds.add(row.place_id);
      for (const row of existingProspects || []) existingProspectIds.add(row.place_id);
    }

    const { data: clients } = await supabase.from('clientes').select('client_id, razon_social, fantasia');
    const clientNameMap = new Map<string, { client_id: string; nombre: string }>();
    for (const client of clients || []) {
      for (const candidate of [client.fantasia, client.razon_social]) {
        if (typeof candidate !== 'string') continue;
        const key = normalizeName(candidate);
        if (key && !clientNameMap.has(key)) {
          clientNameMap.set(key, { client_id: client.client_id, nombre: candidate });
        }
      }
    }

    const results = places.map((place) => {
      const displayName = place.displayName?.text || '';
      return {
        place_id: place.id,
        nombre: displayName,
        direccion: place.formattedAddress || null,
        latitud: place.location?.latitude ?? null,
        longitud: place.location?.longitude ?? null,
        tipo_principal: place.primaryType || null,
        tipos: place.types || [],
        estado_negocio: place.businessStatus || null,
        google_maps_uri: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}`,
        rating: place.rating ?? null,
        total_ratings: place.userRatingCount ?? null,
        nivel_precio: place.priceLevel || null,
        attributions: place.attributions || [],
        premium_score: premiumScore(place),
        queued: queuedIds.has(place.id),
        existing_prospect: existingProspectIds.has(place.id),
        existing_client: clientNameMap.get(normalizeName(displayName)) || null,
      };
    }).sort((a, b) => b.premium_score - a.premium_score);

    return jsonResponse({
      success: true,
      results,
      storage_policy: 'Solo se persiste place_id y metadatos internos de seguimiento.',
    });
  } catch (error) {
    console.error('prospect-discovery error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado',
    }, 500);
  }
});
