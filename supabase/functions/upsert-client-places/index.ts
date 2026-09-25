// Compatibility for older open tabs. New clients use resolve-client-location.
import { authorize, corsHeaders, failure, json, RequestError } from "../_shared/location-service.ts";
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { db } = await authorize(req, true);
    const { places } = await req.json();
    if (!Array.isArray(places) || places.length !== 1) throw new RequestError("Guardá una ubicación por vez", 400, "BAD_REQUEST");
    const p = places[0];
    const { data, error } = await db.rpc("guardar_ubicacion_cliente", {
      p_client_id: p.client_id, p_manual: true,
      p_datos: { lat: p.lat, long: p.lng, direccion_principal: p.direccion, barrio_principal: p.barrio,
        provincia_principal: p.provincia, comuna: p.comuna_distrito, place_id: p.place_id },
    });
    if (error) throw new Error(error.message);
    return json({ success: true, results: data });
  } catch (error) { return failure(error); }
});
