import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toTitleCase } from "@/lib/format";
import { Users, Calendar, Edit, Trash2, MapPin, Clock, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AssignorTodayAssignmentsMap from "./AssignorTodayAssignmentsMap";

interface Assignment {
  id: string;
  es_prospecto: boolean;
  client_id?: string;
  prospecto_place_id?: string;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente?: {
    razon_social: string;
    cuit_dni: string;
  };
  prospecto?: {
    nombre: string;
    telefono: string;
    direccion: string;
    barrio: string;
    latitud?: number;
    longitud?: number;
  };
  created_at: string;
  cliente_info?: {
    etiquetas?: string[];
    score_volumen_num?: number;
    score_recencia_num?: number;
    razon_social?: string;
    priority_score?: number;
    provincias?: string[];
    ciudades?: string[];
    score_comercial?: string;
    score_volumen?: string;
    score_recencia?: string;
    vendedores?: string[];
    telefonos?: string[];
    monto_total_vendido?: number;
    orders_count?: number;
    avg_ticket?: number;
    first_purchase_at?: string;
    last_purchase_at?: string;
    days_since_last_purchase?: number;
    participacion?: number;
  };
}

interface TodayAssignmentsProps {
  onEditAssignments?: () => void;
}

const TodayAssignments = ({ onEditAssignments }: TodayAssignmentsProps) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showMapAll, setShowMapAll] = useState(false);
  const [showMapVendedor, setShowMapVendedor] = useState<string | null>(null);
  const [openVendors, setOpenVendors] = useState<Record<string, boolean>>({});

  const { toast } = useToast();

  useEffect(() => {
    fetchTodayAssignments();
  }, []);

  const fetchTodayAssignments = async () => {
    setIsLoading(true);
    try {
      const now = new Date();
      const utcYear = now.getUTCFullYear();
      const utcMonth = now.getUTCMonth();
      const utcDate = now.getUTCDate();
      const utcHours = now.getUTCHours();

      const argDate = utcHours < 3 ? utcDate - 1 : utcDate;
      const argMonth = argDate < 1 ? utcMonth - 1 : utcMonth;
      const argYear = argMonth < 0 ? utcYear - 1 : utcYear;

      const startOfDayArg = new Date(
        Date.UTC(
          argMonth < 0 ? argYear : utcYear,
          argMonth < 0 ? 11 : argDate < 1 ? argMonth : utcMonth,
          argDate < 1 ? new Date(utcYear, utcMonth, 0).getDate() : argDate,
          3, 0, 0, 0
        )
      );

      const { data, error } = await supabase
        .from("asignaciones_vendedores_clientes")
        .select(`
          id, created_at, es_prospecto, client_id, prospecto_place_id,
          vendedor:profiles!asignaciones_vendedores_clientes_vendedor_id_fkey(nombre, email),
          cliente:clientes!asignaciones_vendedores_clientes_client_id_fkey(razon_social, cuit_dni)
        `)
        .gte("created_at", startOfDayArg.toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;

      const prospectoPlaceIds = (data || [])
        .filter((a: any) => a.es_prospecto && a.prospecto_place_id)
        .map((a: any) => a.prospecto_place_id);

      let prospectosMap = new Map();
      if (prospectoPlaceIds.length > 0) {
        const { data: prospectosData, error: prospectosError } = await supabase
          .from("prospectos")
          .select("place_id, nombre, telefono, direccion, barrio, latitud, longitud")
          .in("place_id", prospectoPlaceIds);

        if (!prospectosError && prospectosData) {
          prospectosMap = new Map(prospectosData.map((p) => [p.place_id, p]));
        }
      }

      const assignmentsWithInfo = await Promise.all(
        (data || []).map(async (assignment: any) => {
          try {
            if (assignment.es_prospecto && assignment.prospecto_place_id) {
              const prospectoData = prospectosMap.get(assignment.prospecto_place_id);
              return {
                ...assignment,
                prospecto: prospectoData || null,
                cliente_info: { etiquetas: ["Prospecto"] },
              };
            } else {
              const { data: clienteInfo, error: infoError } = await supabase
                .from("clientes_recomendaciones_temporal")
                .select("*")
                .eq("cuit_dni", assignment.cliente?.cuit_dni)
                .limit(1)
                .maybeSingle();

              if (infoError) {
                console.error("Error fetching cliente info:", infoError);
                return assignment;
              }
              return { ...assignment, cliente_info: clienteInfo };
            }
          } catch (err) {
            console.error("Error processing assignment:", err);
            return assignment;
          }
        })
      );

      setAssignments(assignmentsWithInfo as any);
    } catch (error) {
      console.error("Error fetching assignments:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar las asignaciones del día",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllAssignments = async () => {
    setIsDeleting(true);
    try {
      const now = new Date();
      const utcYear = now.getUTCFullYear();
      const utcMonth = now.getUTCMonth();
      const utcDate = now.getUTCDate();
      const utcHours = now.getUTCHours();

      const argDate = utcHours < 3 ? utcDate - 1 : utcDate;
      const argMonth = argDate < 1 ? utcMonth - 1 : utcMonth;
      const argYear = argMonth < 0 ? utcYear - 1 : utcYear;

      const startOfDayArg = new Date(
        Date.UTC(
          argMonth < 0 ? argYear : utcYear,
          argMonth < 0 ? 11 : argDate < 1 ? argMonth : utcMonth,
          argDate < 1 ? new Date(utcYear, utcMonth, 0).getDate() : argDate,
          3, 0, 0, 0
        )
      );

      const { error } = await supabase
        .from("asignaciones_vendedores_clientes")
        .delete()
        .gte("created_at", startOfDayArg.toISOString());

      if (error) throw error;

      toast({
        title: "Asignaciones eliminadas",
        description: `Se eliminaron ${assignments.length} asignaciones de hoy.`,
      });
      setAssignments([]);
    } catch (error) {
      console.error("Error deleting assignments:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al eliminar las asignaciones",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAssignments = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("asignaciones_vendedores_clientes")
        .delete()
        .in("id", ids);

      if (error) throw error;

      setAssignments((prev) => prev.filter((a) => !ids.includes(a.id)));
      toast({
        title: "Asignaciones eliminadas",
        description: `${label} (${ids.length}).`,
      });
    } catch (error) {
      console.error("Error deleting assignments:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al eliminar las asignaciones",
      });
    } finally {
      setIsDeleting(false);
    }
  };


  const assignmentsByVendedor = assignments.reduce(
    (acc, assignment) => {
      const vendedorNombre = toTitleCase(assignment.vendedor?.nombre) || "Vendedor desconocido";
      if (!acc[vendedorNombre]) {
        acc[vendedorNombre] = { email: assignment.vendedor?.email || "", clientes: [] };
      }
      acc[vendedorNombre].clientes.push(assignment);
      return acc;
    },
    {} as Record<string, { email: string; clientes: Assignment[] }>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Cargando asignaciones…</p>
        </div>
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="flex items-center justify-between p-6 rounded-xl bg-card border border-border">
        <div className="space-y-1">
          <h3 className="font-sans text-sm font-semibold text-foreground flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            No hay asignaciones hoy
          </h3>
          <p className="text-xs text-muted-foreground">
            Generá recomendaciones en la pestaña "Nueva Asignación"
          </p>
        </div>
        {onEditAssignments && (
          <Button onClick={onEditAssignments} variant="outline" size="sm" className="gap-1.5 h-9">
            <Edit className="w-3.5 h-3.5" />
            Modificar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-sans">
          {assignments.length} asignación{assignments.length !== 1 ? "es" : ""} hoy
        </p>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowMapAll(true)}
            variant="outline"
            size="sm"
            className="gap-1.5 h-9"
          >
            <MapPin className="w-3.5 h-3.5" />
            Ver mapa
          </Button>
          {onEditAssignments && (
            <Button
              onClick={onEditAssignments}
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
            >
              <Edit className="w-3.5 h-3.5" />
              Modificar
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-9 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Borrar todas
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-sans">¿Eliminar asignaciones?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminarán las {assignments.length} asignaciones de hoy. Esta acción no se
                  puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-9">Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAllAssignments} className="h-9">
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Vendor groups */}
      <div className="space-y-4">
        {Object.entries(assignmentsByVendedor).map(([vendedorNombre, data]) => (
          <Collapsible
            key={vendedorNombre}
            open={!!openVendors[vendedorNombre]}
            onOpenChange={(open) =>
              setOpenVendors((prev) => ({ ...prev, [vendedorNombre]: open }))
            }
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* Vendor header */}
            <div className="flex items-center justify-between px-5 py-4">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-3 min-w-0 text-left flex-1">
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      openVendors[vendedorNombre] ? "rotate-180" : ""
                    }`}
                  />
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-semibold text-foreground truncate">
                      {toTitleCase(vendedorNombre)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{data.email}</p>
                  </div>
                </button>
              </CollapsibleTrigger>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => setShowMapVendedor(vendedorNombre)}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                >
                  <MapPin className="w-3 h-3" />
                  Ver en mapa
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeleting}
                      className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                      Borrar ruta
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-sans">
                        ¿Borrar la ruta de {toTitleCase(vendedorNombre)}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminarán las {data.clientes.length} asignaciones de hoy de este vendedor.
                        El resto de los vendedores no se ve afectado.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-9">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="h-9"
                        onClick={() =>
                          handleDeleteAssignments(
                            data.clientes.map((c) => c.id),
                            `Se borró la ruta de ${toTitleCase(vendedorNombre)}`,
                          )
                        }
                      >
                        Borrar ruta
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Badge
                  variant="secondary"
                  className="px-2.5 py-0.5 text-xs font-medium tabular-nums"
                >
                  {data.clientes.length} cliente{data.clientes.length !== 1 ? "s" : ""}
                </Badge>
              </div>

            </div>

            {/* Client items */}
            <CollapsibleContent>
            <div className="divide-y divide-border/40 border-t border-border/60">

              {data.clientes.map((assignment) => {
                const clientName = assignment.es_prospecto
                  ? assignment.prospecto?.nombre || "Prospecto sin nombre"
                  : assignment.cliente?.razon_social || "Cliente desconocido";

                return (
                  <div
                    key={assignment.id}
                    className="px-5 py-3.5 hover:bg-muted/30 transition-colors"
                  >
                    {/* Row 1: Name + time */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-sans text-[13px] font-medium text-foreground truncate">
                          {toTitleCase(clientName)}
                        </p>
                        {assignment.es_prospecto && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 font-medium border-primary/40 text-primary shrink-0"
                          >
                            Nuevo
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                          <Clock className="w-3 h-3" />
                          {new Date(assignment.created_at).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isDeleting}
                              aria-label="Quitar asignación"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-sans">¿Quitar esta asignación?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Se quitará {toTitleCase(clientName)} de la ruta de hoy de{" "}
                                {toTitleCase(vendedorNombre)}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="h-9">Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                className="h-9"
                                onClick={() =>
                                  handleDeleteAssignments(
                                    [assignment.id],
                                    `Se quitó ${toTitleCase(clientName)}`,
                                  )
                                }
                              >
                                Quitar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>

                    </div>

                    {/* Row 2: Secondary info */}
                    {assignment.es_prospecto ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {assignment.prospecto?.direccion || "Sin dirección"}
                        {assignment.prospecto?.barrio && ` · ${assignment.prospecto.barrio}`}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        CUIT: {assignment.cliente?.cuit_dni}
                      </p>
                    )}

                    {/* Row 3: Detail metadata (collapsed) */}
                    {assignment.es_prospecto
                      ? assignment.prospecto && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
                            {assignment.prospecto.telefono && (
                              <span>
                                <span className="text-muted-foreground">Tel:</span>{" "}
                                <span className="text-foreground/80">{assignment.prospecto.telefono}</span>
                              </span>
                            )}
                            {assignment.prospecto.barrio && (
                              <span>
                                <span className="text-muted-foreground">Barrio:</span>{" "}
                                <span className="text-foreground/80">{assignment.prospecto.barrio}</span>
                              </span>
                            )}
                          </div>
                        )
                      : assignment.cliente_info && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
                            {assignment.cliente_info.ciudades && assignment.cliente_info.ciudades.length > 0 && (
                              <span>
                                <span className="text-muted-foreground">Ciudad:</span>{" "}
                                <span className="text-foreground/80">
                                  {assignment.cliente_info.ciudades.join(", ")}
                                </span>
                              </span>
                            )}
                            {assignment.cliente_info.score_comercial && (
                              <span>
                                <span className="text-muted-foreground">Score:</span>{" "}
                                <span className="text-foreground/80">
                                  {assignment.cliente_info.score_comercial}
                                </span>
                              </span>
                            )}
                            {assignment.cliente_info.monto_total_vendido != null && (
                              <span>
                                <span className="text-muted-foreground">Vendido:</span>{" "}
                                <span className="text-foreground/80">
                                  ${assignment.cliente_info.monto_total_vendido.toLocaleString("es-AR")}
                                </span>
                              </span>
                            )}
                            {assignment.cliente_info.orders_count != null && (
                              <span>
                                <span className="text-muted-foreground">Órdenes:</span>{" "}
                                <span className="text-foreground/80">{assignment.cliente_info.orders_count}</span>
                              </span>
                            )}
                            {assignment.cliente_info.avg_ticket != null && (
                              <span>
                                <span className="text-muted-foreground">Ticket:</span>{" "}
                                <span className="text-foreground/80">
                                  ${assignment.cliente_info.avg_ticket.toLocaleString("es-AR")}
                                </span>
                              </span>
                            )}
                            {assignment.cliente_info.days_since_last_purchase != null && (
                              <span>
                                <span className="text-muted-foreground">Última compra:</span>{" "}
                                <span className="text-foreground/80">
                                  hace {assignment.cliente_info.days_since_last_purchase} días
                                </span>
                              </span>
                            )}
                            {assignment.cliente_info.telefonos &&
                              assignment.cliente_info.telefonos.length > 0 && (
                                <span>
                                  <span className="text-muted-foreground">Tel:</span>{" "}
                                  <span className="text-foreground/80">
                                    {assignment.cliente_info.telefonos[0]}
                                  </span>
                                </span>
                              )}
                          </div>
                        )}
                  </div>
                );
              })}
            </div>
            </CollapsibleContent>
          </Collapsible>

        ))}
      </div>

      {/* Map dialogs */}
      <Dialog open={showMapAll} onOpenChange={setShowMapAll}>
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-sans">Todas las asignaciones de hoy</DialogTitle>
          </DialogHeader>
          <AssignorTodayAssignmentsMap assignments={assignments} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!showMapVendedor} onOpenChange={(open) => !open && setShowMapVendedor(null)}>
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-sans">Asignaciones de {showMapVendedor}</DialogTitle>
          </DialogHeader>
          <AssignorTodayAssignmentsMap
            assignments={assignments}
            vendedorFilter={showMapVendedor || undefined}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TodayAssignments;
