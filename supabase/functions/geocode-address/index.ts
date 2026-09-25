import { authorize, corsHeaders, failure, geocodeAddress, json, RequestError } from "../_shared/location-service.ts";
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    await authorize(req, false);
    const body = await req.json();
    if (typeof body.direccion !== "string" || !body.direccion.trim()) throw new RequestError("Falta la dirección", 400, "BAD_REQUEST");
    const parts = [body.direccion, body.barrio, body.codigo_postal, body.ciudad, body.provincia, "Argentina"];
    const address = parts.filter(p => typeof p === "string" && p.trim()).join(", ");
    if (address.length > 700) throw new RequestError("La dirección es demasiado extensa", 400, "BAD_REQUEST");
    return json({ status: "OK", ...await geocodeAddress(address) });
  } catch (error) { return failure(error); }
});
