import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";

// Argentina coordinate bounds
const LAT_MIN = -56, LAT_MAX = -21, LNG_MIN = -74, LNG_MAX = -53;

function isValidArgentina(lat: number, lng: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
}

function extractComponent(components: any[], type: string): string | null {
  const c = components.find((c: any) => c.types?.includes(type));
  return c?.long_name || null;
}

const BARRIOS_A_COMUNA: Record<string, string> = {
  PALERMO: "Comuna 14",
  RECOLETA: "Comuna 2",
  "SAN NICOLAS": "Comuna 1",
  MONSERRAT: "Comuna 1",
  "SAN TELMO": "Comuna 1",
  "LA BOCA": "Comuna 4",
  BARRACAS: "Comuna 4",
  BELGRANO: "Comuna 13",
  NUÑEZ: "Comuna 13",
  COLEGIALES: "Comuna 13",
  CABALLITO: "Comuna 6",
  ALMAGRO: "Comuna 5",
  BOEDO: "Comuna 5",
  "VILLA CRESPO": "Comuna 15",
  CHACARITA: "Comuna 15",
  FLORES: "Comuna 7",
  "VILLA DEVOTO": "Comuna 11",
  "VILLA URQUIZA": "Comuna 12",
  SAAVEDRA: "Comuna 12",
  "PUERTO MADERO": "Comuna 1",
  RETIRO: "Comuna 1",
  BALVANERA: "Comuna 3",
  "SAN CRISTOBAL": "Comuna 3",
  "PARQUE PATRICIOS": "Comuna 4",
  "VILLA LURO": "Comuna 10",
  LINIERS: "Comuna 9",
  MATADEROS: "Comuna 9",
  "PARQUE CHACABUCO": "Comuna 7",
  POMPEYA: "Comuna 4",
  CONSTITUCION: "Comuna 1",
  AGRONOMIA: "Comuna 15",
  "PARQUE CHAS": "Comuna 15",
  "VILLA ORTUZAR": "Comuna 15",
  "VILLA DEL PARQUE": "Comuna 11",
};

function resolveComuna(barrio: string | null, adminArea2: string | null): string | null {
  if (barrio) {
    const key = barrio.toUpperCase().trim();
    if (BARRIOS_A_COMUNA[key]) return BARRIOS_A_COMUNA[key];
  }
  if (adminArea2 && adminArea2.toLowerCase().startsWith("comuna")) return adminArea2;
  return null;
}

function normalizeProvince(prov: string | null): string | null {
  if (!prov) return null;
  const upper = prov.toUpperCase().trim();
  if (upper.includes("BUENOS AIRES") && (upper.includes("AUTONOMA") || upper.includes("CABA") || upper.includes("CIUDAD")))
    return "Ciudad Autónoma de Buenos Aires";
  if (upper === "BUENOS AIRES" || upper.includes("PROVINCIA DE BUENOS"))
    return "Buenos Aires";
  return prov.trim();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find clients without coordinates
    const { data: allClients, error: clientsError } = await supabase
      .from("clientes")
      .select("client_id, direccion_principal, ciudad_principal, provincia_principal, barrio_principal")
      .not("direccion_principal", "is", null);

    if (clientsError) throw new Error(`Error fetching clients: ${clientsError.message}`);

    const { data: existingPlaces, error: placesError } = await supabase
      .from("client_places")
      .select("client_id");

    if (placesError) throw new Error(`Error fetching places: ${placesError.message}`);

    const placedClientIds = new Set((existingPlaces || []).map((p: any) => p.client_id));

    const pending = (allClients || []).filter(
      (c: any) => !placedClientIds.has(c.client_id) && c.direccion_principal && c.ciudad_principal
    );

    const results = {
      total: pending.length,
      geocoded: 0,
      errors: 0,
      skipped: 0,
      error_details: [] as string[],
    };

    for (const client of pending) {
      const parts = [
        client.direccion_principal,
        client.ciudad_principal,
        client.provincia_principal,
        "Argentina",
      ].filter(Boolean);
      const address = parts.join(", ");

      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== "OK" || !data.results?.length) {
          results.errors++;
          results.error_details.push(`${client.client_id}: Google status ${data.status}`);
          await sleep(200);
          continue;
        }

        const result = data.results[0];
        const { lat, lng } = result.geometry.location;

        if (!isValidArgentina(lat, lng)) {
          results.errors++;
          results.error_details.push(`${client.client_id}: coords outside Argentina (${lat},${lng})`);
          await sleep(200);
          continue;
        }

        const components = result.address_components || [];
        const barrio =
          extractComponent(components, "sublocality_level_1") ||
          extractComponent(components, "sublocality") ||
          extractComponent(components, "neighborhood");
        const adminArea2 = extractComponent(components, "administrative_area_level_2");
        const provincia = extractComponent(components, "administrative_area_level_1");
        const placeId = result.place_id || null;
        const comuna = resolveComuna(barrio, adminArea2);
        const normalizedProv = normalizeProvince(provincia);
        const formattedAddress = result.formatted_address || address;
        const googleMapsLink = `https://www.google.com/maps/place/?q=place_id:${placeId}`;

        // Check if client_places row already exists
        const placeData = {
          lat,
          long: lng,
          barrio_principal: barrio || client.barrio_principal,
          comuna,
          provincia_principal: normalizedProv || client.provincia_principal,
          direccion_principal: formattedAddress,
          place_id: placeId,
          google_maps_link: googleMapsLink,
          is_primary: true,
        };

        const { data: existingPlace } = await supabase
          .from("client_places")
          .select("id")
          .eq("client_id", client.client_id)
          .maybeSingle();

        const { error: upsertError } = existingPlace
          ? await supabase.from("client_places").update(placeData).eq("id", existingPlace.id)
          : await supabase.from("client_places").insert({ client_id: client.client_id, ...placeData });

        if (upsertError) {
          results.errors++;
          results.error_details.push(`${client.client_id}: upsert error: ${upsertError.message}`);
          await sleep(200);
          continue;
        }

        // Sync barrio/provincia back to clientes if missing
        const updates: Record<string, any> = {};
        if (!client.barrio_principal && barrio) updates.barrio_principal = barrio;
        if (!client.provincia_principal && normalizedProv) updates.provincia_principal = normalizedProv;

        if (Object.keys(updates).length > 0) {
          await supabase
            .from("clientes")
            .update(updates)
            .eq("client_id", client.client_id);
        }

        results.geocoded++;
      } catch (e: any) {
        results.errors++;
        results.error_details.push(`${client.client_id}: ${e.message}`);
      }

      await sleep(200); // Throttle: 5 req/sec
    }

    // ===== Reverse geocoding: lugares con coordenadas pero sin barrio =====
    const reverse = { total: 0, resueltos: 0, errores: 0 };
    const { data: placesSinBarrio } = await supabase
      .from("client_places")
      .select("id, client_id, lat, long, barrio_principal")
      .is("barrio_principal", null)
      .not("lat", "is", null)
      .limit(600);

    reverse.total = (placesSinBarrio || []).length;

    for (const place of placesSinBarrio || []) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${place.lat},${place.long}&language=es&key=${GOOGLE_API_KEY}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.status !== "OK" || !data.results?.length) { reverse.errores++; await sleep(120); continue; }

        const components = data.results[0].address_components || [];
        const barrio =
          extractComponent(components, "sublocality_level_1") ||
          extractComponent(components, "sublocality") ||
          extractComponent(components, "neighborhood") ||
          extractComponent(components, "locality");
        const adminArea2 = extractComponent(components, "administrative_area_level_2");
        const provincia = normalizeProvince(extractComponent(components, "administrative_area_level_1"));
        const comuna = resolveComuna(barrio, adminArea2);

        if (!barrio) { reverse.errores++; await sleep(120); continue; }

        await supabase
          .from("client_places")
          .update({ barrio_principal: barrio, comuna, provincia_principal: provincia })
          .eq("id", place.id);

        await supabase
          .from("clientes")
          .update({
            barrio_principal: barrio,
            ...(provincia ? { provincia_principal: provincia } : {}),
          })
          .eq("client_id", place.client_id)
          .is("barrio_principal", null);

        reverse.resueltos++;
      } catch {
        reverse.errores++;
      }
      await sleep(120);
    }

    return new Response(
      JSON.stringify({ success: true, results, reverse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
