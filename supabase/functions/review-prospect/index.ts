import { authorize, corsHeaders, json, failure, RequestError } from "../_shared/location-service.ts";
import { loadIdentityContext } from "../_shared/prospect-review-service.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { db, user } = await authorize(req, true);
    const body = await req.json().catch(() => { throw new RequestError("Solicitud inválida",400,"INVALID_REQUEST"); });
    if (!body || !["list", "resolve"].includes(body.action)) throw new RequestError("Solicitud inválida",400,"INVALID_REQUEST");
    const { context, matcher } = await loadIdentityContext(db);
    if (body.action === "list") {
      if (body.prospect_ids !== undefined && (!Array.isArray(body.prospect_ids) || body.prospect_ids.length>500 || body.prospect_ids.some((s: unknown)=>typeof s!=="string"))) throw new RequestError("Selección inválida",400,"INVALID_REQUEST");
      const ids = body.prospect_ids ? new Set(body.prospect_ids) : null;
      const reviews = context.prospectos.filter(p => !p.client_id && !p.es_cliente_cupra && (!ids || ids.has(p.place_id)))
        .map(p => ({ prospecto: p, coincidencias: matcher.matches(p, body.include_reviewed === true) })).filter(r => r.coincidencias.length)
        .sort((a,b)=>a.prospecto.nombre.localeCompare(b.prospecto.nombre,"es"));
      return json({ success: true, revisiones: reviews.slice(0,50), total: reviews.length });
    }
    const p = context.prospectos.find(p => p.place_id === body.prospecto_id);
    if (!p || !["unificado","distinto"].includes(body.decision)) throw new RequestError("Revisión inválida",400,"INVALID_REQUEST");
    if (p.client_id === body.cliente_id && body.decision === "unificado") return json({ success: true, ya_resuelto: true });
    const match = matcher.matches(p, true).find(c => c.client_id === body.cliente_id);
    if (!match || body.prospecto_huella !== p.huella || body.cliente_huella !== match.huella) throw new RequestError("Los datos cambiaron. Actualizá la revisión antes de confirmar.",409,"STALE_REVIEW");
    const { data, error } = await db.rpc("resolver_revision_cupra", { p_actor: user.id, p_prospecto_id:p.place_id,
      p_cliente_id:match.client_id, p_decision:body.decision, p_prospecto_huella:p.huella, p_cliente_huella:match.huella });
    if (error) throw new RequestError(error.message,error.code==="40001"?409:422,"REVIEW_FAILED");
    return json(data);
  } catch (error) { return failure(error); }
}
if (import.meta.main) Deno.serve(handler);
