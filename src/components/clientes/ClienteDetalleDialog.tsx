import { useEffect, useState } from "react";
import { toTitleCase } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Loader2, MapPin, Phone, Mail, Users, ShoppingCart, MessageSquare } from "lucide-react";

interface Props {
  cliente: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatCurrency: (n: number) => string;
}

const normalizeRS = (rs: string | null | undefined) =>
  (rs || "").trim().toUpperCase().replace(/\s+/g, " ");

const ClienteDetalleDialog = ({ cliente, open, onOpenChange, formatCurrency }: Props) => {
  const [loading, setLoading] = useState(false);
  const [ventas, setVentas] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !cliente) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        let rows: any[] = [];
        if (cliente.client_id) {
          const { data } = await supabase
            .from("ventas_cupra")
            .select("ticket, fecha_emision, facturacion_ars, nombre, marca, codigo_producto, cajas, vendedor, razon_social, tipo_comprobante")
            .eq("client_id", cliente.client_id)
            .order("fecha_emision", { ascending: false })
            .limit(2000);
          rows = data || [];
        }
        if (rows.length === 0 && cliente.razon_social) {
          const { data } = await supabase
            .from("ventas_cupra")
            .select("ticket, fecha_emision, facturacion_ars, nombre, marca, codigo_producto, cajas, vendedor, razon_social, tipo_comprobante")
            .ilike("razon_social", cliente.razon_social.trim())
            .order("fecha_emision", { ascending: false })
            .limit(2000);
          rows = (data || []).filter(
            (r) => normalizeRS(r.razon_social) === normalizeRS(cliente.razon_social)
          );
        }
        if (!cancelled) setVentas(rows);

        if (cliente.client_id) {
          const { data: fbs } = await supabase
            .from("cliente_feedbacks")
            .select("id, feedback, visita_realizada, motivo_no_visita, tipo_interaccion, created_at, vendedor_id")
            .eq("client_id", cliente.client_id)
            .order("created_at", { ascending: false })
            .limit(50);
          let list = fbs || [];
          if (list.length > 0) {
            const ids = Array.from(new Set(list.map((f: any) => f.vendedor_id).filter(Boolean)));
            const { data: profs } = await supabase
              .from("profiles")
              .select("user_id, nombre")
              .in("user_id", ids);
            const nombres = new Map((profs || []).map((p: any) => [p.user_id, p.nombre]));

            // Lectura estructurada del comentario (IA). Si no existe, la tarjeta queda igual.
            const { data: exts } = await supabase
              .from("feedback_extraccion")
              .select("feedback_id, revisit_date, objecion, interes_producto, riesgo_cobranza, no_ofrecer, contacto_nombre, contacto_rol, resumen, confianza")
              .in("feedback_id", list.map((f: any) => f.id));
            const extMap = new Map((exts || []).map((e: any) => [e.feedback_id, e]));

            list = list.map((f: any) => ({
              ...f,
              vendedor_nombre: nombres.get(f.vendedor_id) || null,
              extraccion: extMap.get(f.id) || null,
            }));
          }
          if (!cancelled) setFeedbacks(list);
        } else if (!cancelled) {
          setFeedbacks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, cliente]);

  if (!cliente) return null;

  const total = ventas.reduce((s, v) => s + Number(v.facturacion_ars || 0), 0);
  const ticketsMap = new Map<string, { ticket: string; fecha: string | null; monto: number; vendedor: string | null; items: number }>();
  for (const v of ventas) {
    const key = `${v.ticket || "s/t"}-${v.fecha_emision || ""}`;
    if (!ticketsMap.has(key)) {
      ticketsMap.set(key, { ticket: v.ticket || "—", fecha: v.fecha_emision, monto: 0, vendedor: v.vendedor, items: 0 });
    }
    const e = ticketsMap.get(key)!;
    e.monto += Number(v.facturacion_ars || 0);
    e.items += 1;
    if (!e.vendedor && v.vendedor) e.vendedor = v.vendedor;
  }
  const tickets = Array.from(ticketsMap.values()).sort((a, b) =>
    (b.fecha || "").localeCompare(a.fecha || "")
  );

  const vendedoresMap = new Map<string, { ventas: number; tickets: Set<string>; ultima: string | null }>();
  for (const v of ventas) {
    const nombre = v.vendedor?.trim();
    if (!nombre) continue;
    if (!vendedoresMap.has(nombre)) vendedoresMap.set(nombre, { ventas: 0, tickets: new Set(), ultima: null });
    const e = vendedoresMap.get(nombre)!;
    e.ventas += Number(v.facturacion_ars || 0);
    if (v.ticket) e.tickets.add(v.ticket);
    if (v.fecha_emision && (!e.ultima || v.fecha_emision > e.ultima)) e.ultima = v.fecha_emision;
  }
  const vendedoresHist = Array.from(vendedoresMap.entries())
    .map(([vendedor, d]) => ({ vendedor, ventas: d.ventas, tickets: d.tickets.size, ultima: d.ultima }))
    .sort((a, b) => b.ventas - a.ventas);

  const productosMap = new Map<string, { nombre: string; cajas: number; monto: number }>();
  for (const v of ventas) {
    const nombre = v.nombre || v.codigo_producto || "Sin detalle";
    if (!productosMap.has(nombre)) productosMap.set(nombre, { nombre, cajas: 0, monto: 0 });
    const e = productosMap.get(nombre)!;
    e.cajas += Number(v.cajas || 0);
    e.monto += Number(v.facturacion_ars || 0);
  }
  const productos = Array.from(productosMap.values()).sort((a, b) => b.monto - a.monto).slice(0, 15);

  const fmtDate = (d: string | null) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-AR") : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {toTitleCase(cliente.razon_social || cliente.fantasia) || "Cliente"}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
            {cliente.cuit_dni && <Badge variant="secondary">CUIT/DNI {cliente.cuit_dni}</Badge>}
            {cliente.canal && <Badge variant="outline">{cliente.canal}</Badge>}
            {(cliente.vendedor_actual || cliente.vendedor_principal) && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> Vendedor actual: {toTitleCase(cliente.vendedor_actual || cliente.vendedor_principal)}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-visible pr-3">
          <div className="space-y-5 pb-2">

            {/* Datos de contacto y ubicación */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {cliente.direccion_principal || "Sin dirección"}
                  {cliente.barrio_principal ? ` · ${cliente.barrio_principal}` : ""}
                  {cliente.ciudad_principal ? ` · ${cliente.ciudad_principal}` : ""}
                </span>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <Phone className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{cliente.telefonos?.length ? cliente.telefonos.join(", ") : "Sin teléfono"}</span>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <Mail className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="truncate">{cliente.emails?.length ? cliente.emails.join(", ") : "Sin email"}</span>
              </div>
            </div>

            {/* KPIs del cliente */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="matte-card p-4">
                <div className="kpi-label">Facturación histórica</div>
                <div className="text-lg font-semibold text-accent">{formatCurrency(total)}</div>
              </Card>
              <Card className="matte-card p-4">
                <div className="kpi-label">Tickets</div>
                <div className="text-lg font-semibold">{tickets.length}</div>
              </Card>
              <Card className="matte-card p-4">
                <div className="kpi-label">Ticket promedio</div>
                <div className="text-lg font-semibold">
                  {formatCurrency(tickets.length ? total / tickets.length : 0)}
                </div>
              </Card>
              <Card className="matte-card p-4">
                <div className="kpi-label">Última compra</div>
                <div className="text-lg font-semibold">{fmtDate(tickets[0]?.fecha ?? cliente.ultima_compra ?? null)}</div>
              </Card>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando historial...
              </div>
            ) : (
              <>
                {/* Observaciones de vendedores */}
                <Card className="matte-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="section-title flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-foreground/40" /> Observaciones del vendedor
                      {feedbacks.length > 0 && <Badge variant="secondary">{feedbacks.length}</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {feedbacks.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin comentarios registrados por vendedores.</p>
                    )}
                    {feedbacks.map((f) => (
                      <div key={f.id} className="p-2.5 rounded-lg bg-card/50 border border-border/40 text-sm space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{toTitleCase(f.vendedor_nombre) || "Vendedor"}</span>
                          <span>{new Date(f.created_at).toLocaleDateString("es-AR")}</span>
                          <Badge variant={f.visita_realizada ? "secondary" : "outline"}>
                            {f.visita_realizada ? "Visitó" : "No visitó"}
                          </Badge>
                          {f.tipo_interaccion && <Badge variant="outline">{f.tipo_interaccion}</Badge>}
                        </div>
                        <p className="whitespace-pre-wrap">{f.feedback}</p>
                        {!f.visita_realizada && f.motivo_no_visita && (
                          <p className="text-xs text-muted-foreground">Motivo: {f.motivo_no_visita}</p>
                        )}
                        {f.extraccion && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {f.extraccion.revisit_date && (
                              <Badge variant="secondary">
                                Volver: {new Date(`${f.extraccion.revisit_date}T12:00:00Z`).toLocaleDateString("es-AR")}
                              </Badge>
                            )}
                            {f.extraccion.objecion && <Badge variant="outline">Objeción: {f.extraccion.objecion}</Badge>}
                            {(f.extraccion.interes_producto || []).map((p: string) => (
                              <Badge key={p} variant="outline">Interés: {p}</Badge>
                            ))}
                            {f.extraccion.riesgo_cobranza && f.extraccion.riesgo_cobranza !== "ninguno" && (
                              <Badge variant="destructive">Cobranza: {f.extraccion.riesgo_cobranza}</Badge>
                            )}
                            {f.extraccion.no_ofrecer && <Badge variant="destructive">No ofrecer aún</Badge>}
                            {f.extraccion.contacto_nombre && (
                              <Badge variant="outline">
                                Contacto: {f.extraccion.contacto_nombre}
                                {f.extraccion.contacto_rol ? ` (${f.extraccion.contacto_rol})` : ""}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Vendedores históricos */}
                <Card className="matte-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="section-title flex items-center gap-2">
                      <Users className="h-4 w-4 text-foreground/40" /> Vendedores que tuvo
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {vendedoresHist.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin vendedores registrados en ventas.</p>
                    )}
                    {vendedoresHist.map((v) => (
                      <div key={v.vendedor} className="flex items-center justify-between p-2.5 rounded-lg bg-card/50 border border-border/40 text-sm">
                        <div>
                          <span className="font-medium">{toTitleCase(v.vendedor)}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {v.tickets} tickets · últ. {fmtDate(v.ultima)}
                          </span>
                        </div>
                        <span className="text-accent font-semibold">{formatCurrency(v.ventas)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Historial de ventas */}
                <Card className="matte-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="section-title flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-foreground/40" /> Historial de ventas ({tickets.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {tickets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin ventas registradas.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs uppercase text-muted-foreground border-b border-border/40">
                              <th className="text-left py-2 font-medium">Fecha</th>
                              <th className="text-left py-2 font-medium">Ticket</th>
                              <th className="text-left py-2 font-medium">Vendedor</th>
                              <th className="text-right py-2 font-medium">Ítems</th>
                              <th className="text-right py-2 font-medium">Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tickets.map((t, i) => (
                              <tr key={`${t.ticket}-${i}`} className="border-b border-border/20">
                                <td className="py-2">{fmtDate(t.fecha)}</td>
                                <td className="py-2">{t.ticket}</td>
                                <td className="py-2 text-muted-foreground">{toTitleCase(t.vendedor) || "—"}</td>
                                <td className="py-2 text-right text-muted-foreground">{t.items}</td>
                                <td className="py-2 text-right font-medium text-accent">{formatCurrency(t.monto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Productos */}
                <Card className="matte-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="section-title">Productos comprados</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {productos.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin productos registrados.</p>
                    )}
                    {productos.map((p) => (
                      <div key={p.nombre} className="flex items-center justify-between text-sm p-2 rounded bg-card/40">
                        <span className="truncate mr-3">{p.nombre}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {p.cajas} cajas · <span className="text-accent font-medium">{formatCurrency(p.monto)}</span>
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClienteDetalleDialog;
