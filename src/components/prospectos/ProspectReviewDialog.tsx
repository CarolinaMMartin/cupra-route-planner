import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { IdentityMatch, IdentityProspect } from "../../../supabase/functions/_shared/prospect-identity";

interface Review { prospecto: IdentityProspect; coincidencias: IdentityMatch[] }
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; prospectIds?: string[];
  onResolved?: (id: string, decision: "unificado" | "distinto") => void;
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("review-prospect", { body });
  if (error || !data?.success) {
    const detail = error?.context instanceof Response ? await error.context.json().catch(() => null) : null;
    throw new Error(detail?.error || data?.error || "No se pudo guardar la revisión. Reintentá.");
  }
  return data;
}

export function ProspectReviewDialog({ open, onOpenChange, prospectIds, onResolved }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const generation = useRef(0);
  const idsKey = prospectIds ? [...prospectIds].sort().join("\n") : null;
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(null);
    try {
      const data = await invoke({ action: "list", ...(idsKey !== null ? { prospect_ids: idsKey ? idsKey.split("\n") : [] } : {}), include_reviewed: includeReviewed });
      if (request === generation.current) { setReviews(data.revisiones); setTotal(data.total); }
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : "No se pudo cargar la revisión."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [idsKey, includeReviewed]);
  useEffect(() => {
    if (open) { setNotice(null); void load(); }
    return () => { generation.current++; };
  }, [open, load]);
  const resolve = async (p: IdentityProspect, c: IdentityMatch, decision: "unificado" | "distinto") => {
    if (saving) return;
    if (decision === "unificado" && !window.confirm(`¿Unificar “${p.nombre}” con el cliente “${c.nombre}”? Se completarán datos vacíos y se agregarán contactos. Los datos existentes, las ventas y el vendedor se conservarán.`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invoke({ action: "resolve", prospecto_id: p.place_id, cliente_id: c.client_id, decision,
        prospecto_huella: p.huella, cliente_huella: c.huella });
      setNotice(decision === "unificado" ? "Información unificada y guardada. El negocio queda vinculado al cliente y deja de ofrecerse como prospecto nuevo." : "Decisión guardada. Esta coincidencia no volverá a bloquearlo mientras sus datos de identidad no cambien.");
      onResolved?.(p.place_id, decision); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Revisar y unificar información</DialogTitle><DialogDescription>
        Compará el prospecto con los clientes similares. Una coincidencia de teléfono o ubicación puede corresponder a negocios distintos.
      </DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">Al unificar se completan campos vacíos, se agregan contactos y se guarda la información encontrada con su fuente. Los datos en conflicto quedan disponibles para consulta.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeReviewed} disabled={saving} onChange={e=>setIncludeReviewed(e.target.checked)} />Incluir coincidencias marcadas como negocios distintos</label>
      {notice && <p role="status" className="border p-3 text-sm">{notice}</p>}
      {error && <div role="alert" className="text-sm text-destructive">{error}<Button variant="outline" size="sm" className="ml-2" disabled={saving} onClick={load}>Actualizar revisión</Button></div>}
      {loading ? <p role="status" className="flex gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Consultando coincidencias...</p> : <>
        {!reviews.length && !error && <p className="text-sm">No quedan coincidencias pendientes en esta selección.</p>}
        {total>50 && <p className="text-sm text-muted-foreground">Mostrando 50 de {total}. Al resolverlas aparecerán las siguientes.</p>}
        {reviews.map(({ prospecto:p, coincidencias }) => <section key={p.place_id} className="border-t pt-4 space-y-3">
          <p className="font-medium">Prospecto: {p.nombre}</p>
          {p.informacion_encontrada && <div className="text-sm border-l-2 pl-3"><p className="font-medium">Última información encontrada en Google</p>
            {["nombre","direccion","telefono","website"].filter(key=>p.informacion_encontrada?.[key]).map(key=><p className="break-words" key={key}>{String(p.informacion_encontrada![key])}</p>)}
          </div>}
          {coincidencias.map(c => <div key={c.client_id} className="border p-3 space-y-3">
            <p className="text-sm font-medium">Cliente similar: {c.nombre}</p>
            <p className="text-xs text-muted-foreground">{c.motivos.join(" · ")}{c.distancia_m!==null ? ` · ${c.distancia_m} m entre ubicaciones` : ""}{c.vendedor ? ` · Vendedor: ${c.vendedor}` : ""}</p>
            <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-1">Dato</th><th className="p-1">Prospecto</th><th className="p-1">Cliente</th></tr></thead><tbody>
              <tr><th className="p-1 font-normal">Dirección</th><td className="p-1 break-words">{p.direccion || "Sin dato"}</td><td className="p-1 break-words">{c.direccion || "Sin dato"}</td></tr>
              <tr><th className="p-1 font-normal">Teléfono</th><td className="p-1">{p.telefono || "Sin dato"}</td><td className="p-1">{c.telefonos.join(" · ") || "Sin dato"}</td></tr>
              <tr><th className="p-1 font-normal">Email</th><td className="p-1 break-all">{String(p.email || "Sin dato")}</td><td className="p-1 break-all">{c.emails.join(" · ") || "Sin dato"}</td></tr>
            </tbody></table></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={saving} onClick={()=>resolve(p,c,"unificado")}>Unificar información</Button><Button size="sm" variant="outline" disabled={saving} onClick={()=>resolve(p,c,"distinto")}>Son negocios distintos</Button></div>
          </div>)}
        </section>)}
      </>}
      {saving && <p role="status" className="text-sm">Guardando decisión e información...</p>}
    </DialogContent>
  </Dialog>;
}
