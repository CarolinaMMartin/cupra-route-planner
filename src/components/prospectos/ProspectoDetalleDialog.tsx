import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  Globe,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Star,
  User,
} from "lucide-react";

export interface ProspectoDetalle {
  id: string;
  place_id: string;
  nombre: string;
  telefono?: string | null;
  direccion?: string | null;
  barrio?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  rating?: number | null;
  total_ratings?: number | null;
  nivel_precio?: string | null;
  tipo_principal?: string | null;
  tipos?: string[] | null;
  website?: string | null;
  email?: string | null;
  instagram?: string | null;
  estado_negocio?: string | null;
  resumen_google?: string | null;
  es_cliente_cupra?: boolean | null;
  client_id?: string | null;
  sirve_vinos?: boolean | null;
  last_recommendation_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  latitud?: number | null;
  longitud?: number | null;
}

interface Props {
  prospecto: ProspectoDetalle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatTipo = (tipo?: string | null) =>
  tipo ? tipo.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : "—";

const nivelPrecio = (nivel?: string | null) => {
  if (!nivel) return "—";
  const map: Record<string, string> = {
    PRICE_LEVEL_INEXPENSIVE: "$ Económico",
    PRICE_LEVEL_MODERATE: "$$ Moderado",
    PRICE_LEVEL_EXPENSIVE: "$$$ Caro",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$ Muy caro",
  };
  return map[nivel] || nivel;
};

const fecha = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const Campo = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="text-sm text-foreground break-words">{children}</div>
  </div>
);

export function ProspectoDetalleDialog({ prospecto, open, onOpenChange }: Props) {
  const [feedbacks, setFeedbacks] = useState<
    { id: string; feedback: string; created_at: string; estado_cliente: string | null; vendedor: string | null }[]
  >([]);
  const [asignaciones, setAsignaciones] = useState<{ id: string; estado: string; vendedor: string | null }[]>([]);

  useEffect(() => {
    if (!open || !prospecto?.place_id) return;
    let cancelado = false;

    const cargar = async () => {
      const [{ data: fb }, { data: asig }, { data: perfiles }] = await Promise.all([
        supabase
          .from("cliente_feedbacks")
          .select("id, feedback, created_at, estado_cliente, vendedor_id")
          .eq("prospecto_place_id", prospecto.place_id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("asignaciones_vendedores_clientes")
          .select("id, estado, vendedor_id")
          .eq("prospecto_place_id", prospecto.place_id),
        supabase.from("profiles").select("user_id, nombre"),
      ]);
      if (cancelado) return;
      const nombrePorId = new Map((perfiles || []).map((p) => [p.user_id, p.nombre]));
      setFeedbacks(
        (fb || []).map((f) => ({
          id: f.id,
          feedback: f.feedback,
          created_at: f.created_at,
          estado_cliente: f.estado_cliente,
          vendedor: nombrePorId.get(f.vendedor_id) || null,
        }))
      );
      setAsignaciones(
        (asig || []).map((a) => ({
          id: a.id,
          estado: a.estado,
          vendedor: nombrePorId.get(a.vendedor_id) || null,
        }))
      );
    };

    void cargar();
    return () => {
      cancelado = true;
    };
  }, [open, prospecto?.place_id]);

  if (!prospecto) return null;

  const p = prospecto;
  const mapsUrl =
    p.latitud && p.longitud
      ? `https://www.google.com/maps/search/?api=1&query=${p.latitud},${p.longitud}${
          p.place_id && !p.place_id.startsWith("excel-") ? `&query_place_id=${p.place_id}` : ""
        }`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [p.nombre, p.direccion, p.ciudad].filter(Boolean).join(" ")
        )}`;
  const waNumero = p.telefono ? p.telefono.replace(/\D/g, "") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{p.nombre}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span>{formatTipo(p.tipo_principal)}</span>
            {p.es_cliente_cupra && (
              <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent">
                Ya es cliente CUPRA
              </Badge>
            )}
            {p.sirve_vinos && <Badge variant="outline">Sirve vinos</Badge>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Dirección">
              <span className="inline-flex items-start gap-1.5">
                <MapPin className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                {p.direccion || "—"}
              </span>
            </Campo>
            <Campo label="Zona">
              {[p.barrio, p.ciudad, p.provincia].filter(Boolean).join(" · ") || "—"}
              {p.comuna ? ` · Comuna ${p.comuna}` : ""}
            </Campo>
            <Campo label="Teléfono">
              {p.telefono ? (
                <span className="inline-flex items-center gap-3">
                  <a href={`tel:${p.telefono}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone className="h-4 w-4 text-accent" />
                    {p.telefono}
                  </a>
                  <a
                    href={`https://wa.me/54${waNumero}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                </span>
              ) : (
                <span className="text-muted-foreground">Sin teléfono</span>
              )}
            </Campo>
            <Campo label="Email">
              {p.email ? (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <Mail className="h-4 w-4 text-accent" />
                  {p.email}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Campo>
            <Campo label="Reputación Google">
              {p.rating ? (
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-accent" />
                  {p.rating.toFixed(1)} ({p.total_ratings || 0} reseñas)
                </span>
              ) : (
                <span className="text-muted-foreground">Sin reseñas</span>
              )}
            </Campo>
            <Campo label="Nivel de precio">{nivelPrecio(p.nivel_precio)}</Campo>
            <Campo label="Web / redes">
              <span className="flex flex-wrap items-center gap-3">
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                    <Globe className="h-4 w-4 text-accent" /> Sitio
                  </a>
                ) : null}
                {p.instagram ? (
                  <a href={p.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                    <Instagram className="h-4 w-4 text-accent" /> Instagram
                  </a>
                ) : null}
                {!p.website && !p.instagram && <span className="text-muted-foreground">—</span>}
              </span>
            </Campo>
            <Campo label="Estado">{p.estado_negocio || "Nuevo"}</Campo>
            <Campo label="Alta en el sistema">{fecha(p.created_at)}</Campo>
            <Campo label="Última recomendación">{fecha(p.last_recommendation_at)}</Campo>
          </div>

          {p.tipos && p.tipos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.tipos.slice(0, 10).map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">
                  {formatTipo(t)}
                </Badge>
              ))}
            </div>
          )}

          {p.resumen_google && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Datos comerciales</p>
                <p className="text-sm text-foreground whitespace-pre-line">{p.resumen_google}</p>
              </div>
            </>
          )}

          <Separator />
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Asignaciones</p>
            {asignaciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin asignaciones activas</p>
            ) : (
              asignaciones.map((a) => (
                <p key={a.id} className="text-sm inline-flex items-center gap-2 mr-4">
                  <User className="h-4 w-4 text-accent" />
                  {a.vendedor || "Vendedor"} · {a.estado}
                </p>
              ))
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Historial de visitas</p>
            {feedbacks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay feedback de vendedores</p>
            ) : (
              feedbacks.map((f) => (
                <div key={f.id} className="rounded-md border border-border/50 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{f.vendedor || "Vendedor"}</span>
                    <span>{fecha(f.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground">{f.feedback}</p>
                  {f.estado_cliente && <Badge variant="outline" className="text-xs">{f.estado_cliente}</Badge>}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={mapsUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Ver en Google Maps
              </a>
            </Button>
            {p.telefono && (
              <Button asChild size="sm" className="gap-2 wine-button">
                <a href={`tel:${p.telefono}`}>
                  <Phone className="h-4 w-4" /> Llamar
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProspectoDetalleDialog;
