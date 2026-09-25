import { authorize, corsHeaders, failure, geocodeAddress, reverseGeocode, json, RequestError } from "../_shared/location-service.ts";
import { argentinaCoordinates } from "../_shared/import-values.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { db } = await authorize(req, true);
    const body = await req.json().catch(() => ({}));
    const tipo = body.tipo === "prospectos" ? "prospectos" : "clientes";
    const after = typeof body.after === "string" ? body.after : "";
    const { data: rows, error } = await db.rpc("pendientes_geocodificacion", { p_tipo: tipo, p_despues: after, p_limite: 5, p_batch: typeof body.batch_id === "string" ? body.batch_id : null });
    if (error) throw new Error(error.message);
    const results = { total: 0, geocoded: 0, errors: 0, skipped: 0, error_details: [] as string[] };
    const reverse = { total: 0, resueltos: 0, errores: 0 };
    const deadline = Date.now() + 30_000;
    let cursor = after;
    let serviceError: string | null = null;
    for (const row of rows || []) {
      if (Date.now() >= deadline) break;
      results.total++;
      cursor = row.id;
      try {
        const hasCoords = argentinaCoordinates(Number(row.lat), Number(row.lng));
        if (hasCoords) reverse.total++;
        if (!hasCoords && !row.direccion?.trim()) throw new RequestError("Falta la dirección del comercio", 422, "NO_ADDRESS");
        const location = hasCoords
          ? await reverseGeocode(Number(row.lat), Number(row.lng))
          : await geocodeAddress([row.direccion, row.codigo_postal, row.barrio, row.ciudad, row.provincia, "Argentina"].filter(Boolean).join(", "));
        if (tipo === "prospectos") {
          const { error: saveError } = await db.from("prospectos").update({
            latitud: location.lat, longitud: location.lng, google_place_id: location.place_id,
            barrio: location.barrio || row.barrio, provincia: location.provincia || row.provincia,
            ciudad: location.ciudad || row.ciudad,
          }).eq("place_id", row.id).or("latitud.eq.0,longitud.eq.0");
          if (saveError) throw new Error(saveError.message);
        } else if (hasCoords) {
          // Reverse lookup adds geographic labels without touching coordinates, source or verified address.
          const { error: saveError } = await db.rpc("completar_barrio_ubicacion", {
            p_id: row.location_id, p_lat: Number(row.lat), p_lng: Number(row.lng),
            p_barrio: location.barrio, p_comuna: location.comuna,
          });
          if (saveError) throw new Error(saveError.message);
          reverse.resueltos++;
        } else {
          const { error: saveError } = await db.rpc("guardar_ubicacion_cliente", {
            p_client_id: row.id, p_datos: { lat: location.lat, long: location.lng,
              direccion_principal: location.formatted_address, barrio_principal: location.barrio, provincia_principal: location.provincia,
              comuna: location.comuna, place_id: location.place_id, precision_geocoding: location.location_type },
          });
          if (saveError) throw new Error(saveError.message);
        }
        results.geocoded++;
      } catch (cause) {
        results.errors++;
        results.error_details.push(`${row.nombre || row.id}: ${cause instanceof Error ? cause.message : "No se pudo ubicar"}`);
        if (cause instanceof RequestError && cause.code === "GOOGLE_ERROR") { serviceError = cause.message; break; }
      }
    }
    const { count, error: countError } = await db.from("clientes").select("client_id", { count: "exact", head: true }).or("barrio_principal.is.null,barrio_principal.eq.");
    if (countError) throw new Error(countError.message);
    return json({ success: true, results, reverse, service_error: serviceError, next_cursor: results.total ? cursor : null, pendientes_barrio: count ?? 0 });
  } catch (error) { return failure(error); }
});
