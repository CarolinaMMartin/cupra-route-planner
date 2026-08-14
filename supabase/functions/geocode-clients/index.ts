import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

async function geocodeFetch(params: string): Promise<any> {
  const resp = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?${params}`, {
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_API_KEY,
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gateway ${resp.status}: ${body}`);
  }
  return await resp.json();
}

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
    let limit = 0;
    try {
      const body = await req.json();
      limit = Number(body?.limit) > 0 ? Number(body.limit) : 0;
    } catch { /* sin body */ }

    if (!GOOGLE_API_KEY || !LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Credenciales del conector Google Maps no configuradas" }),
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
      .select("client_id, direccion_principal, codigo_postal, ciudad_principal, provincia_principal, barrio_principal")
      .not("direccion_principal", "is", null);

    if (clientsError) throw new Error(`Error fetching clients: ${clientsError.message}`);

    // R7 (OT7): jamás geocodificar por texto un cliente que ya tiene ubicación
    // del ERP o corregida a mano. El geocoding es el último recurso.
    const { data: existingPlaces, error: placesError } = await supabase
      .from("client_places")
      .select("client_id, fuente_geocoding, direccion_verificada");

    if (placesError) throw new Error(`Error fetching places: ${placesError.message}`);

    const placedClientIds = new Set((existingPlaces || []).map((p: any) => p.client_id));
    const ubicacionConfiable = new Set(
      (existingPlaces || [])
        .filter((p: any) => p.direccion_verificada === true || ["excel", "erp", "correccion_manual"].includes(p.fuente_geocoding))
        .map((p: any) => p.client_id)
    );

    let pending = (allClients || []).filter(
      (c: any) =>
        !placedClientIds.has(c.client_id) &&
        !ubicacionConfiable.has(c.client_id) &&
        c.direccion_principal
    );
    if (limit > 0) pending = pending.slice(0, limit);

    const results = {
      total: pending.length,
      geocoded: 0,
      errors: 0,
      skipped: 0,
      error_details: [] as string[],
    };

    for (const client of pending) {
      // R7: el string se arma Calle + Número + Código Postal + Ciudad.
      // Si la ciudad falta o viene sucia y el CP es 1xxx/C1xxx, se asume CABA.
      const cp = (client.codigo_postal || "").toString().trim();
      const cpEsCaba = /^C?1\d{3}/i.test(cp);
      let ciudad = (client.ciudad_principal || "").trim();
      let provincia = (client.provincia_principal || "").trim();
      if (cpEsCaba && (!ciudad || /^(buenos aires|cbx|s\/d|-)$/i.test(ciudad))) {
        ciudad = "Ciudad Autónoma de Buenos Aires";
        provincia = "Ciudad Autónoma de Buenos Aires";
      }
      const parts = [
        client.direccion_principal,
        cp || null,
        ciudad || null,
        provincia || null,
        "Argentina",
      ].filter(Boolean);
      const address = parts.join(", ");


      try {
        const data = await geocodeFetch(`address=${encodeURIComponent(address)}&language=es&region=ar`);

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
          codigo_postal: cp || null,
          place_id: placeId,
          google_maps_link: googleMapsLink,
          fuente_geocoding: "geocoding_auto",
        };

        const { data: existingPlace } = await supabase
          .from("client_places")
          .select("id")
          .eq("client_id", client.client_id)
          .maybeSingle();

        const { error: upsertError } = existingPlace
          ? await supabase.from("client_places").update(placeData).eq("id", existingPlace.id)
          : await supabase.from("client_places").insert({ client_id: client.client_id, ...placeData, is_primary: false });


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
      .limit(limit > 0 ? limit : 600);

    reverse.total = (placesSinBarrio || []).length;

    for (const place of placesSinBarrio || []) {
      try {
        const data = await geocodeFetch(`latlng=${place.lat},${place.long}&language=es`);
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

    // R7: un solo primario por cliente, ganando manual > ERP > geocoding
    await supabase.rpc("reconciliar_places_primarios");

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
