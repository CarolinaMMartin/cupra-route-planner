import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

async function gatewayFetch(path: string, params: string): Promise<any> {
  const resp = await fetch(`${GATEWAY_URL}${path}?${params}`, {
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

const geocodeFetch = (params: string) => gatewayFetch("/maps/api/geocode/json", params);

/** Búsqueda del local por nombre comercial (Places API v1). */
async function buscarNegocioPorNombre(textQuery: string): Promise<any | null> {
  const resp = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus",
    },
    body: JSON.stringify({ textQuery, pageSize: 3, languageCode: "es", regionCode: "AR" }),
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Places ${resp.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw);
  const place = (data.places || [])[0];
  if (!place?.location) return null;
  return {
    lat: Number(place.location.latitude),
    lng: Number(place.location.longitude),
    place_id: place.id || null,
    formatted_address: place.formattedAddress || null,
    business_status: place.businessStatus || null,
  };
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

// Un "barrio" que en realidad es una ciudad/provincia envenena las
// recomendaciones regionales: nunca se guarda como barrio.
const BARRIOS_PROHIBIDOS = new Set([
  "BUENOS AIRES",
  "CIUDAD AUTONOMA DE BUENOS AIRES",
  "CAPITAL FEDERAL",
  "CABA",
  "ARGENTINA",
]);

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function barrioValido(barrio: string | null): string | null {
  if (!barrio) return null;
  const limpio = barrio.trim();
  if (!limpio) return null;
  if (BARRIOS_PROHIBIDOS.has(sinAcentos(limpio))) return null;
  return limpio;
}

function extraerBarrio(components: any[]): string | null {
  return barrioValido(
    extractComponent(components, "sublocality_level_1") ||
    extractComponent(components, "sublocality") ||
    extractComponent(components, "neighborhood") ||
    extractComponent(components, "locality") ||
    extractComponent(components, "postal_town") ||
    extractComponent(components, "administrative_area_level_3")
  );
}

/**
 * Control de precisión (regla fija del sistema regional): solo se acepta una
 * coordenada que apunte a una puerta concreta. Un centro de calle, de barrio,
 * de ciudad o de provincia se descarta: es preferible un cliente sin ubicación
 * a un cliente ubicado en el lugar equivocado.
 */
const TIPOS_DEMASIADO_AMPLIOS = [
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "locality",
  "sublocality",
  "neighborhood",
  "postal_code",
  "route",
];

function evaluarPrecision(result: any, direccionTieneAltura: boolean): { ok: boolean; precision: string; motivo?: string } {
  const tipos: string[] = result.types || [];
  const locationType: string = result.geometry?.location_type || "";
  const tieneAltura = (result.address_components || []).some((c: any) => c.types?.includes("street_number"));

  if (tipos.some((t) => TIPOS_DEMASIADO_AMPLIOS.includes(t)) && !tipos.includes("street_address") && !tipos.includes("premise") && !tipos.includes("subpremise")) {
    return { ok: false, precision: "area", motivo: `resultado de área (${tipos.join("/")})` };
  }
  if (locationType === "APPROXIMATE") {
    return { ok: false, precision: "aproximada", motivo: "Google devolvió un punto aproximado" };
  }
  if (locationType === "GEOMETRIC_CENTER" && !tieneAltura) {
    return { ok: false, precision: "centro_calle", motivo: "centro de calle sin altura" };
  }
  if (direccionTieneAltura && !tieneAltura) {
    return { ok: false, precision: "sin_altura", motivo: "Google no reconoció la altura de la calle" };
  }
  return {
    ok: true,
    precision: locationType === "ROOFTOP" ? "rooftop" : locationType === "RANGE_INTERPOLATED" ? "interpolada" : "puerta",
  };
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

    const { data: allClients, error: clientsError } = await supabase
      .from("clientes")
      .select("client_id, razon_social, fantasia, direccion_principal, codigo_postal, ciudad_principal, provincia_principal, barrio_principal");

    if (clientsError) throw new Error(`Error fetching clients: ${clientsError.message}`);

    const { data: existingPlaces, error: placesError } = await supabase
      .from("client_places")
      .select("id, client_id, fuente_geocoding, direccion_verificada, ubicacion_confiable");

    if (placesError) throw new Error(`Error fetching places: ${placesError.message}`);

    // R7 (OT7): jamás re-geocodificar un cliente con ubicación del ERP o
    // corregida a mano. Sí se reintenta todo lo que no sea confiable.
    const ubicacionConfiable = new Set(
      (existingPlaces || [])
        .filter((p: any) => p.ubicacion_confiable === true)
        .map((p: any) => p.client_id)
    );
    const placeIdPorCliente = new Map<string, string>();
    for (const p of existingPlaces || []) {
      if (!ubicacionConfiable.has(p.client_id)) placeIdPorCliente.set(p.client_id, p.id);
    }

    let pending = (allClients || []).filter((c: any) => !ubicacionConfiable.has(c.client_id));
    if (limit > 0) pending = pending.slice(0, limit);

    const results = {
      total: pending.length,
      geocoded: 0,
      por_nombre: 0,
      rechazados_precision: 0,
      errors: 0,
      skipped: 0,
      error_details: [] as string[],
      baja_precision: [] as string[],
    };

    for (const client of pending) {
      // R7: el string se arma Calle + Número + Código Postal + Ciudad.
      const cp = (client.codigo_postal || "").toString().trim();
      const cpEsCaba = /^C?1\d{3}/i.test(cp);
      let ciudad = (client.ciudad_principal || "").trim();
      let provincia = (client.provincia_principal || "").trim();
      if (cpEsCaba && (!ciudad || /^(buenos aires|cbx|s\/d|-)$/i.test(ciudad))) {
        ciudad = "Ciudad Autónoma de Buenos Aires";
        provincia = "Ciudad Autónoma de Buenos Aires";
      }
      const direccion = (client.direccion_principal || "").trim();
      const direccionTieneAltura = /\d/.test(direccion);
      const address = [direccion || null, cp || null, ciudad || null, provincia || null, "Argentina"]
        .filter(Boolean)
        .join(", ");

      try {
        let aceptado: any = null;
        let precision = "";
        let motivoRechazo = "";

        if (direccion) {
          const data = await geocodeFetch(`address=${encodeURIComponent(address)}&language=es&region=ar`);
          if (data.status === "OK" && data.results?.length) {
            for (const candidato of data.results) {
              const { lat, lng } = candidato.geometry?.location || {};
              if (!isValidArgentina(Number(lat), Number(lng))) continue;
              const veredicto = evaluarPrecision(candidato, direccionTieneAltura);
              if (veredicto.ok) {
                aceptado = candidato;
                precision = veredicto.precision;
                break;
              }
              motivoRechazo = veredicto.motivo || "precisión insuficiente";
            }
          } else {
            motivoRechazo = `Google status ${data.status}`;
          }
          await sleep(150);
        }

        // Respaldo por nombre comercial: muchos clientes son locales
        // conocidos y Google los ubica con precisión de puerta.
        if (!aceptado) {
          const nombre = (client.fantasia || client.razon_social || "").trim();
          if (nombre) {
            const query = [nombre, direccion, ciudad || "Buenos Aires", "Argentina"].filter(Boolean).join(", ");
            const candidato = await buscarNegocioPorNombre(query);
            if (candidato && isValidArgentina(candidato.lat, candidato.lng) && candidato.business_status !== "CLOSED_PERMANENTLY") {
              const detalle = await geocodeFetch(`latlng=${candidato.lat},${candidato.lng}&language=es`);
              const componentes = detalle.results?.[0]?.address_components || [];
              aceptado = {
                geometry: { location: { lat: candidato.lat, lng: candidato.lng } },
                address_components: componentes,
                formatted_address: candidato.formatted_address || address,
                place_id: candidato.place_id || null,
              };
              precision = "negocio_maps";
              results.por_nombre++;
            } else if (!motivoRechazo) {
              motivoRechazo = "Google Maps no encontró el local por nombre";
            }

            await sleep(150);
          }
        }

        if (!aceptado) {
          results.rechazados_precision++;
          results.baja_precision.push(
            `${client.client_id} ${client.razon_social || ""}: ${motivoRechazo || "sin dirección utilizable"}`
          );
          // Nunca se guarda una coordenada dudosa: el cliente queda marcado
          // como sin ubicación para que se corrija a mano.
          continue;
        }

        const lat = Number(aceptado.geometry.location.lat);
        const lng = Number(aceptado.geometry.location.lng);
        let components = aceptado.address_components || [];
        let barrio = extraerBarrio(components);

        if (!barrio) {
          const inverso = await geocodeFetch(`latlng=${lat},${lng}&language=es`);
          if (inverso.status === "OK" && inverso.results?.length) {
            for (const r of inverso.results) {
              const b = extraerBarrio(r.address_components || []);
              if (b) { barrio = b; components = r.address_components; break; }
            }
          }
          await sleep(120);
        }

        const adminArea2 = extractComponent(components, "administrative_area_level_2");
        const normalizedProv = normalizeProvince(extractComponent(components, "administrative_area_level_1"));
        const comuna = resolveComuna(barrio, adminArea2);
        const placeId = aceptado.place_id || null;

        // Regla dura: sin barrio no hay ubicación utilizable en un sistema
        // que recomienda por zona.
        if (!barrio) {
          results.rechazados_precision++;
          results.baja_precision.push(`${client.client_id} ${client.razon_social || ""}: sin barrio resoluble`);
          continue;
        }

        const placeData = {
          lat,
          long: lng,
          barrio_principal: barrio,
          comuna,
          provincia_principal: normalizedProv || client.provincia_principal,
          direccion_principal: aceptado.formatted_address || address,
          codigo_postal: cp || null,
          place_id: placeId,
          google_maps_link: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null,
          fuente_geocoding: precision === "negocio_maps" ? "places_negocio" : "geocoding_auto",
          precision_geocoding: precision,
          ubicacion_confiable: true,
        };

        const existingId = placeIdPorCliente.get(client.client_id);
        const { error: upsertError } = existingId
          ? await supabase.from("client_places").update(placeData).eq("id", existingId)
          : await supabase.from("client_places").insert({ client_id: client.client_id, ...placeData, is_primary: false });

        if (upsertError) {
          results.errors++;
          results.error_details.push(`${client.client_id}: upsert error: ${upsertError.message}`);
          continue;
        }

        await supabase
          .from("clientes")
          .update({
            barrio_principal: barrio,
            ...(normalizedProv ? { provincia_principal: normalizedProv } : {}),
          })
          .eq("client_id", client.client_id);

        results.geocoded++;
      } catch (e: any) {
        results.errors++;
        results.error_details.push(`${client.client_id}: ${e.message}`);
      }

      await sleep(150); // Throttle
    }

    // ===== Auditoría de las coordenadas que vinieron del ERP =====
    // El ERP repite coordenadas entre clientes distintos y a veces el punto
    // no corresponde a la dirección. Cada punto del ERP se contrasta contra
    // la geocodificación de su propia dirección: si difieren más de 300 m,
    // manda la dirección.
    const auditoriaErp = { total: 0, verificadas: 0, corregidas: 0, sin_verificar: 0, errores: 0 };
    const { data: puntosErp } = await supabase
      .from("client_places")
      .select("id, client_id, lat, long, direccion_principal, codigo_postal, provincia_principal, precision_geocoding, direccion_verificada")
      .in("precision_geocoding", ["erp", "erp_no_verificada"])
      .neq("direccion_verificada", true)
      .limit(limit > 0 ? limit : 400);

    auditoriaErp.total = (puntosErp || []).length;

    for (const place of puntosErp || []) {
      try {
        const dir = (place.direccion_principal || "").trim();
        if (!dir) {
          await supabase.from("client_places")
            .update({ precision_geocoding: "erp_no_verificada", ubicacion_confiable: false })
            .eq("id", place.id);
          auditoriaErp.sin_verificar++;
          continue;
        }

        const data = await geocodeFetch(
          `address=${encodeURIComponent([dir, place.codigo_postal, place.provincia_principal, "Argentina"].filter(Boolean).join(", "))}&language=es&region=ar`
        );
        let preciso: any = null;
        let precision = "";
        for (const candidato of data.results || []) {
          const lat = Number(candidato.geometry?.location?.lat);
          const lng = Number(candidato.geometry?.location?.lng);
          if (!isValidArgentina(lat, lng)) continue;
          const veredicto = evaluarPrecision(candidato, /\d/.test(dir));
          if (veredicto.ok) { preciso = candidato; precision = veredicto.precision; break; }
        }

        if (!preciso) {
          await supabase.from("client_places")
            .update({ precision_geocoding: "erp_no_verificada", ubicacion_confiable: false })
            .eq("id", place.id);
          auditoriaErp.sin_verificar++;
          await sleep(150);
          continue;
        }

        const latGeo = Number(preciso.geometry.location.lat);
        const lngGeo = Number(preciso.geometry.location.lng);
        const distanciaKm = haversineKm(Number(place.lat), Number(place.long), latGeo, lngGeo);
        const componentes = preciso.address_components || [];
        const barrio = extraerBarrio(componentes);
        const provincia = normalizeProvince(extractComponent(componentes, "administrative_area_level_1"));
        const comuna = resolveComuna(barrio, extractComponent(componentes, "administrative_area_level_2"));

        if (distanciaKm > 0.3) {
          await supabase.from("client_places").update({
            lat: latGeo,
            long: lngGeo,
            ...(barrio ? { barrio_principal: barrio, comuna } : {}),
            ...(provincia ? { provincia_principal: provincia } : {}),
            direccion_principal: preciso.formatted_address || dir,
            place_id: preciso.place_id || null,
            precision_geocoding: precision,
            ubicacion_confiable: true,
          }).eq("id", place.id);
          if (barrio) {
            await supabase.from("clientes").update({ barrio_principal: barrio }).eq("client_id", place.client_id);
          }
          auditoriaErp.corregidas++;
        } else {
          await supabase.from("client_places").update({
            ...(barrio ? { barrio_principal: barrio, comuna } : {}),
            precision_geocoding: "erp_verificada",
            ubicacion_confiable: true,
          }).eq("id", place.id);
          auditoriaErp.verificadas++;
        }
      } catch {
        auditoriaErp.errores++;
      }
      await sleep(150);
    }



    // ===== Re-verificación de sucursales geocodificadas con el criterio viejo =====
    // Toda ubicación no confiable se vuelve a resolver con el control de
    // precisión. Si no llega a precisión de puerta, se borra: un punto falso
    // en el mapa es peor que no tener el punto.
    const reverificacion = { total: 0, confirmadas: 0, eliminadas: 0, errores: 0 };
    const { data: dudosas } = await supabase
      .from("client_places")
      .select("id, client_id, direccion_principal, codigo_postal, provincia_principal")
      .eq("ubicacion_confiable", false)
      .limit(limit > 0 ? limit : 400);

    reverificacion.total = (dudosas || []).length;

    for (const place of dudosas || []) {
      try {
        const dir = (place.direccion_principal || "").trim();
        const tieneAltura = /\d/.test(dir);
        let confirmada: any = null;
        let precision = "";

        if (dir) {
          const data = await geocodeFetch(
            `address=${encodeURIComponent([dir, place.codigo_postal, place.provincia_principal, "Argentina"].filter(Boolean).join(", "))}&language=es&region=ar`
          );
          for (const candidato of data.results || []) {
            const lat = Number(candidato.geometry?.location?.lat);
            const lng = Number(candidato.geometry?.location?.lng);
            if (!isValidArgentina(lat, lng)) continue;
            const veredicto = evaluarPrecision(candidato, tieneAltura);
            if (veredicto.ok) { confirmada = candidato; precision = veredicto.precision; break; }
          }
          await sleep(150);
        }

        if (!confirmada) {
          await supabase.from("client_places").delete().eq("id", place.id);
          reverificacion.eliminadas++;
          continue;
        }

        const componentes = confirmada.address_components || [];
        const barrio = extraerBarrio(componentes);
        if (!barrio) {
          await supabase.from("client_places").delete().eq("id", place.id);
          reverificacion.eliminadas++;
          continue;
        }

        await supabase
          .from("client_places")
          .update({
            lat: Number(confirmada.geometry.location.lat),
            long: Number(confirmada.geometry.location.lng),
            barrio_principal: barrio,
            comuna: resolveComuna(barrio, extractComponent(componentes, "administrative_area_level_2")),
            provincia_principal: normalizeProvince(extractComponent(componentes, "administrative_area_level_1")),
            direccion_principal: confirmada.formatted_address || dir,
            place_id: confirmada.place_id || null,
            precision_geocoding: precision,
            ubicacion_confiable: true,
          })
          .eq("id", place.id);

        reverificacion.confirmadas++;
      } catch {
        reverificacion.errores++;
      }
      await sleep(120);
    }



    // ===== Completar barrio de ubicaciones confiables que aún no lo tienen =====
    const reverse = { total: 0, resueltos: 0, errores: 0 };
    const { data: placesSinBarrio } = await supabase
      .from("client_places")
      .select("id, client_id, lat, long")
      .or("barrio_principal.is.null,barrio_principal.eq.")
      .not("lat", "is", null)
      .limit(limit > 0 ? limit : 600);

    reverse.total = (placesSinBarrio || []).length;

    for (const place of placesSinBarrio || []) {
      try {
        const data = await geocodeFetch(`latlng=${place.lat},${place.long}&language=es`);
        let barrio: string | null = null;
        let components: any[] = [];
        if (data.status === "OK") {
          for (const r of data.results || []) {
            const b = extraerBarrio(r.address_components || []);
            if (b) { barrio = b; components = r.address_components; break; }
          }
        }
        if (!barrio) { reverse.errores++; await sleep(120); continue; }

        const adminArea2 = extractComponent(components, "administrative_area_level_2");
        const provincia = normalizeProvince(extractComponent(components, "administrative_area_level_1"));

        await supabase
          .from("client_places")
          .update({ barrio_principal: barrio, comuna: resolveComuna(barrio, adminArea2), provincia_principal: provincia })
          .eq("id", place.id);

        await supabase
          .from("clientes")
          .update({ barrio_principal: barrio, ...(provincia ? { provincia_principal: provincia } : {}) })
          .eq("client_id", place.client_id);

        reverse.resueltos++;
      } catch {
        reverse.errores++;
      }
      await sleep(120);
    }

    // R7: un solo primario por cliente, ganando manual > ERP > geocoding
    await supabase.rpc("reconciliar_places_primarios");
    // Propaga el barrio de la ubicación principal a la ficha del cliente
    await supabase.rpc("sync_clientes_barrio_from_places");

    const { count: pendientesBarrio } = await supabase
      .from("clientes")
      .select("client_id", { count: "exact", head: true })
      .or("barrio_principal.is.null,barrio_principal.eq.");
    const { count: totalClientes } = await supabase
      .from("clientes")
      .select("client_id", { count: "exact", head: true });
    const { count: sinUbicacionConfiable } = await supabase
      .from("client_places")
      .select("id", { count: "exact", head: true })
      .eq("ubicacion_confiable", false);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        reverse,
        reverificacion,

        pendientes_barrio: pendientesBarrio ?? 0,
        total_clientes: totalClientes ?? 0,
        ubicaciones_no_confiables: sinUbicacionConfiable ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
