import { authorize, corsHeaders, failure, json } from "../_shared/location-service.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { db } = await authorize(req, true);
    const { data, error } = await db.rpc("generar_notificaciones_pendientes");
    if (error) throw new Error(error.message);
    return json({ success: true, processed: data, message: `Se crearon ${data} notificaciones` });
  } catch (error) { return failure(error); }
});
