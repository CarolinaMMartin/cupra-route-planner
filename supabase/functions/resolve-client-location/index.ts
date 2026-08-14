import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const LAT_MIN = -56, LAT_MAX = -21, LNG_MIN = -74, LNG_MAX = -53;
const isValidArgentina = (lat: number, lng: number) =>
  lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;

async function geocode(address: string) {
  const params = `address=${encodeURIComponent(address)}&language=es&region=ar`;
  const resp = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?${params}`, {
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_API_KEY,
    },
  });
  if (!resp.ok) throw new Error(`Gateway ${resp.status}`);
  return await resp.json();
}

function extractComponent(components: any[], type: string): string | null {
  const c = (components || []).find((c: any) => c.types?.includes(type));
  return c?.long_name || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await anonClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim();
    if (!clientId) {
      return new Response(JSON.stringify({ error: "client_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const manual = body?.manual === true;
    let lat = Number(body?.lat);
    let lng = Number(body?.lng);
    let direccion = typeof body?.direccion === "string" ? body.direccion.trim() : "";
    let barrio: string | null = null;
    let provincia: string | null = null;
    let placeId: string | null = null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Si no vienen coordenadas, geocodificamos la dirección
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (!direccion) {
        return new Response(JSON.stringify({ error: "Falta dirección o coordenadas" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!GOOGLE_API_KEY || !LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ error: "Conector de Google Maps no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const query = /argentina/i.test(direccion) ? direccion : `${direccion}, Argentina`;
      const data = await geocode(query);
      if (data.status !== "OK" || !data.results?.length) {
        return new Response(
          JSON.stringify({ error: "No se pudo ubicar esa dirección en el mapa" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const result = data.results[0];
      lat = result.geometry.location.lat;
      lng = result.geometry.location.lng;
      direccion = result.formatted_address || direccion;
      barrio =
        extractComponent(result.address_components, "sublocality_level_1") ||
        extractComponent(result.address_components, "neighborhood");
      provincia = extractComponent(result.address_components, "administrative_area_level_1");
      placeId = result.place_id || null;
    }

    if (!isValidArgentina(lat, lng)) {
      return new Response(
        JSON.stringify({ error: "Las coordenadas quedan fuera de Argentina" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: existing } = await supabase
      .from("client_places")
      .select("id, direccion_verificada")
      .eq("client_id", clientId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Nunca degradar una corrección manual con un guardado automático
    if (existing?.direccion_verificada && !manual) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: Record<string, any> = {
      lat,
      long: lng,
      is_primary: true,
      direccion_verificada: manual,
      fuente_geocoding: manual ? "correccion_manual" : "geocoding_auto",
    };
    if (direccion) payload.direccion_principal = direccion;
    if (barrio) payload.barrio_principal = barrio;
    if (provincia) payload.provincia_principal = provincia;
    if (placeId) {
      payload.place_id = placeId;
      payload.google_maps_link = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
    }

    const { error } = existing
      ? await supabase.from("client_places").update(payload).eq("id", existing.id)
      : await supabase.from("client_places").insert({ client_id: clientId, ...payload });

    if (error) throw new Error(error.message);

    if (manual && direccion) {
      await supabase
        .from("clientes")
        .update({ direccion_principal: direccion })
        .eq("client_id", clientId);
    }

    return new Response(
      JSON.stringify({ ok: true, lat, lng, direccion, barrio, provincia }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[resolve-client-location]", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || "Error inesperado" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
