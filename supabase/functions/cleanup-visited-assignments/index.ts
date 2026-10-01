import { authorize, corsHeaders, failure, json } from "../_shared/location-service.ts";

// Las visitas completadas son historial, no datos temporales.
// Las llamadas antiguas reciben una respuesta explícita, sin borrar filas.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    await authorize(req, true);
    return json({ success: false, error: "La limpieza fue retirada para conservar el historial de visitas.", deletedCount: 0 }, 410);
  } catch (error) { return failure(error); }
});
