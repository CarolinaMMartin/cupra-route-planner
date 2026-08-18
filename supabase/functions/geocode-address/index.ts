import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractComponent(components: any[], type: string): string | null {
  const c = (components || []).find((comp: any) => comp.types?.includes(type));
  return c?.long_name || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Solo usuarios autenticados: evita exponer un proxy público de Google Maps
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await anonClient.auth.getUser();
    if (!userData?.user) {
      return json({ status: "ERROR", error_code: "UNAUTHORIZED", message: "Sesión expirada. Iniciá sesión nuevamente." }, 401);
    }

    if (!GOOGLE_API_KEY || !LOVABLE_API_KEY) {
      return json({ status: "ERROR", error_code: "CONFIG_ERROR", message: "El servicio de geocodificación no está configurado." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const direccion = String(body?.direccion || "").trim().slice(0, 300);
    const barrio = String(body?.barrio || "").trim().slice(0, 120);
    const ciudad = String(body?.ciudad || "").trim().slice(0, 120);
    const provincia = String(body?.provincia || "").trim().slice(0, 120);
    const codigoPostal = String(body?.codigo_postal || "").trim().slice(0, 12);

    if (!direccion) {
      return json({ status: "ERROR", error_code: "BAD_REQUEST", message: "Falta la dirección." }, 400);
    }

    // El CP va antes de la ciudad, como en el formato postal argentino
    const partes = [direccion, barrio, codigoPostal, ciudad, provincia, "Argentina"].filter(Boolean);
    const address = partes.join(", ");

    const params = new URLSearchParams({ address, language: "es", region: "ar" });
    if (codigoPostal) params.set("components", `postal_code:${codigoPostal}|country:AR`);

    const resp = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_API_KEY,
      },
    });

    if (resp.status === 403) {
      const details: Array<{ reason?: string }> = (await resp.json().catch(() => ({})))?.error?.details ?? [];
      const reason = details.find((d) => d.reason)?.reason;
      if (reason === "API_KEY_HTTP_REFERRER_BLOCKED") {
        return json({ status: "ERROR", error_code: "KEY_REFERRER", message: 'La clave de Google tiene restricción por dominio. Configurala como "None" o por IP.' }, 403);
      }
      if (reason === "API_KEY_SERVICE_BLOCKED") {
        return json({ status: "ERROR", error_code: "KEY_SERVICE", message: "La clave de Google no tiene habilitada la API de Geocoding." }, 403);
      }
      return json({ status: "ERROR", error_code: "DENIED", message: "Google rechazó la consulta (403)." }, 403);
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[geocode-address] gateway ${resp.status}: ${text}`);
      return json({ status: "ERROR", error_code: "NETWORK_ERROR", message: "No se pudo conectar con Google Maps." }, resp.status);
    }

    let data = await resp.json();

    // Si el CP restringe demasiado y no hay resultados, reintenta sin components
    if ((data.status === "ZERO_RESULTS" || !data.results?.length) && codigoPostal) {
      const retry = await fetch(
        `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=es&region=ar`,
        {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_API_KEY,
          },
        },
      );
      if (retry.ok) data = await retry.json();
    }

    if (data.status !== "OK" || !data.results?.length) {
      return json({ status: "ERROR", error_code: "NO_RESULTS", message: "No se encontraron resultados para esa dirección." });
    }

    const result = data.results[0];
    const components: any[] = result.address_components || [];

    const barrioGoogle =
      extractComponent(components, "sublocality_level_1") ||
      extractComponent(components, "sublocality") ||
      extractComponent(components, "neighborhood");
    const adminArea2 = extractComponent(components, "administrative_area_level_2");

    return json({
      status: "OK",
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
      location_type: result.geometry.location_type,
      barrio: barrioGoogle,
      comuna: adminArea2?.toLowerCase().startsWith("comuna") ? adminArea2 : null,
      ciudad: extractComponent(components, "locality"),
      provincia: extractComponent(components, "administrative_area_level_1"),
      postal_code: extractComponent(components, "postal_code"),
      admin_area_level_2: adminArea2,
      barrio_fallback_admin2: barrioGoogle || adminArea2,
      place_id: result.place_id,
    });
  } catch (e: any) {
    console.error("[geocode-address]", e?.message || e);
    return json({ status: "ERROR", error_code: "NETWORK_ERROR", message: "Error inesperado al geocodificar." }, 500);
  }
});
