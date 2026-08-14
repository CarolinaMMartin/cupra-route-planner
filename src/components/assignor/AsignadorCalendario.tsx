import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toTitleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CalendarIcon,
  CalendarClock,
  Plus,
  Search,
  UserCheck,
  AlertTriangle,
  MapPin,
} from "lucide-react";

interface Vendedor {
  user_id: string;
  nombre: string;
}

interface EventoAgenda {
  id: string;
  tipo: "visita" | "seguimiento";
  fecha: Date;
  titulo: string;
  vendedorNombre: string;
  detalle?: string;
  autoGestionado: boolean;
  esProspecto: boolean;
}

interface Candidato {
  id: string;
  nombre: string;
  detalle: string;
  esProspecto: boolean;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const parseDateOnly = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const AsignadorCalendario = () => {
  const [eventos, setEventos] = useState<EventoAgenda[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [vendedorId, setVendedorId] = useState<string>("");
  const [fechaAgenda, setFechaAgenda] = useState<Date | undefined>(new Date());
  const [horaAgenda, setHoraAgenda] = useState("09:00");
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Candidato[]>([]);
  const [nota, setNota] = useState("");
  const [agendando, setAgendando] = useState<string | null>(null);

  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("user_id, nombre, rol, activo")
        .eq("activo", true)
        .in("rol", ["vendedor", "asignador", "administrador"]);

      const vends = (perfiles || []).map((p: any) => ({
        user_id: p.user_id,
        nombre: toTitleCase(p.nombre || ""),
      }));
      setVendedores(vends.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      const nombrePorId = new Map(vends.map(v => [v.user_id, v.nombre]));

      const [{ data: asignaciones }, { data: recordatorios }] = await Promise.all([
        supabase
          .from("asignaciones_vendedores_clientes")
          .select(
            `id, vendedor_id, fecha_programada, es_prospecto, origen_asignacion, estado, client_id, prospecto_place_id,
             cliente:clientes!asignaciones_vendedores_clientes_client_id_fkey(razon_social)`,
          )
          .not("fecha_programada", "is", null),
        supabase
          .from("recordatorios")
          .select("id, vendedor_id, titulo, nota, fecha_recordatorio, completado, prospecto_place_id"),
      ]);

      const placeIds = [
        ...new Set(
          (asignaciones || [])
            .filter((a: any) => a.es_prospecto && a.prospecto_place_id)
            .map((a: any) => a.prospecto_place_id),
        ),
      ];
      let prospectos = new Map<string, string>();
      if (placeIds.length > 0) {
        const { data: pros } = await supabase
          .from("prospectos")
          .select("place_id, nombre")
          .in("place_id", placeIds as string[]);
        prospectos = new Map((pros || []).map((p: any) => [p.place_id, p.nombre]));
      }

      const eventosVisitas: EventoAgenda[] = (asignaciones || []).map((a: any) => ({
        id: `asig-${a.id}`,
        tipo: "visita",
        fecha: parseDateOnly(a.fecha_programada),
        titulo: toTitleCase(
          a.es_prospecto
            ? prospectos.get(a.prospecto_place_id) || "Prospecto"
            : a.cliente?.razon_social || a.client_id || "Cliente",
        ),
        vendedorNombre: nombrePorId.get(a.vendedor_id) || "Vendedor",
        detalle: a.estado,
        autoGestionado: a.origen_asignacion === "auto",
        esProspecto: !!a.es_prospecto,
      }));

      const eventosSeguimiento: EventoAgenda[] = (recordatorios || [])
        .filter((r: any) => !r.completado)
        .map((r: any) => ({
          id: `rec-${r.id}`,
          tipo: "seguimiento" as const,
          fecha: new Date(r.fecha_recordatorio),
          titulo: r.titulo,
          vendedorNombre: nombrePorId.get(r.vendedor_id) || "Vendedor",
          detalle: r.nota || undefined,
          autoGestionado: true,
          esProspecto: !!r.prospecto_place_id,
        }));

      setEventos([...eventosVisitas, ...eventosSeguimiento]);
    } catch (error) {
      console.error("Error cargando calendario:", error);
      toast({ variant: "destructive", title: "No se pudo cargar el calendario" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const buscar = async (q: string) => {
    setBusqueda(q);
    if (q.trim().length < 3) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const [{ data: clientes }, { data: pros }] = await Promise.all([
        supabase
          .from("clientes")
          .select("client_id, razon_social, barrio_principal, ciudad_principal")
          .ilike("razon_social", `%${q.trim()}%`)
          .limit(8),
        supabase
          .from("prospectos")
          .select("place_id, nombre, barrio, ciudad")
          .ilike("nombre", `%${q.trim()}%`)
          .limit(8),
      ]);
      setResultados([
        ...(clientes || []).map((c: any) => ({
          id: c.client_id,
          nombre: toTitleCase(c.razon_social || c.client_id),
          detalle: [c.barrio_principal, c.ciudad_principal].filter(Boolean).join(" · "),
          esProspecto: false,
        })),
        ...(pros || []).map((p: any) => ({
          id: p.place_id,
          nombre: toTitleCase(p.nombre),
          detalle: [p.barrio, p.ciudad].filter(Boolean).join(" · "),
          esProspecto: true,
        })),
      ]);
    } finally {
      setBuscando(false);
    }
  };

  const agendarVisita = async (candidato: Candidato) => {
    const dia = fechaAgenda ?? selectedDate;
    if (!dia) return;
    if (!vendedorId) {
      toast({ variant: "destructive", title: "Elegí un vendedor" });
      return;
    }
    setAgendando(candidato.id);
    try {
      const fecha = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(
        dia.getDate(),
      ).padStart(2, "0")}`;

      let existing = supabase
        .from("asignaciones_vendedores_clientes")
        .select("id")
        .eq("vendedor_id", vendedorId);
      existing = candidato.esProspecto
        ? existing.eq("prospecto_place_id", candidato.id)
        : existing.eq("client_id", candidato.id);
      const { data: yaAsignado } = await existing.maybeSingle();

      if (yaAsignado) {
        const { error: delError } = await supabase
          .from("asignaciones_vendedores_clientes")
          .delete()
          .eq("id", yaAsignado.id);
        if (delError) throw delError;
      }

      const { error } = await supabase.from("asignaciones_vendedores_clientes").insert({
        vendedor_id: vendedorId,
        client_id: candidato.esProspecto ? null : candidato.id,
        prospecto_place_id: candidato.esProspecto ? candidato.id : null,
        es_prospecto: candidato.esProspecto,
        estado: "Por visitar",
        origen_asignacion: "manual",
        fecha_programada: fecha,
      });
      if (error) throw error;

      const recordatorio: any = {
        vendedor_id: vendedorId,
        titulo: `Visita agendada: ${candidato.nombre}`,
        nota: nota || null,
        fecha_recordatorio: new Date(`${fecha}T${horaAgenda || "09:00"}:00-03:00`).toISOString(),
      };
      if (candidato.esProspecto) recordatorio.prospecto_place_id = candidato.id;
      else recordatorio.client_id = candidato.id;
      await supabase.from("recordatorios").insert(recordatorio);

      toast({
        title: "Visita programada",
        description: `${candidato.nombre} le aparece al vendedor el ${dia.toLocaleDateString("es-AR")}.`,
      });
      setDialogAbierto(false);
      setBusqueda("");
      setResultados([]);
      setNota("");
      fetchData();
    } catch (error) {
      console.error("Error agendando visita:", error);
      toast({ variant: "destructive", title: "No se pudo agendar la visita" });
    } finally {
      setAgendando(null);
    }
  };

  const fechasConEvento = useMemo(() => eventos.map(e => e.fecha), [eventos]);
  const fechasAuto = useMemo(
    () => eventos.filter(e => e.autoGestionado).map(e => e.fecha),
    [eventos],
  );

  const delDia = useMemo(() => {
    if (!selectedDate) return [];
    return eventos
      .filter(e => sameDay(e.fecha, selectedDate))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  }, [eventos, selectedDate]);

  const autoProximos = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return eventos
      .filter(e => e.autoGestionado && e.fecha >= hoy)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
      .slice(0, 6);
  }, [eventos]);

  const renderEvento = (e: EventoAgenda) => (
    <div
      key={e.id}
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3"
    >
      {e.tipo === "visita" ? (
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      ) : (
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{e.titulo}</p>
        <p className="text-xs text-muted-foreground">
          {e.vendedorNombre}
          {e.tipo === "seguimiento" &&
            ` · ${e.fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
          {e.detalle ? ` · ${e.detalle}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="outline" className="text-[10px]">
          {e.tipo === "visita" ? "Visita" : "Seguimiento"}
        </Badge>
        {e.autoGestionado && (
          <Badge
            variant="outline"
            className="gap-1 border-primary/40 text-[10px] text-primary"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Auto-gestionado
          </Badge>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-[auto_1fr]">
      <Card className="w-fit">
        <CardContent className="p-3">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            modifiers={{ evento: fechasConEvento, auto: fechasAuto }}
            classNames={{
              cell: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
              day: "inline-flex h-9 w-9 items-center justify-center rounded-full p-0 font-normal text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              day_selected:
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              day_today: "ring-1 ring-inset ring-primary/50 font-semibold",
              day_outside: "day-outside text-muted-foreground/50",
            }}
            modifiersClassNames={{
              evento:
                "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary aria-selected:after:bg-primary-foreground",
              auto: "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-accent aria-selected:after:bg-primary-foreground",
            }}
            className={cn("p-0 pointer-events-auto")}
          />

          <div className="mt-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Visita programada
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Agendado por el vendedor
            </span>
          </div>

        </CardContent>
      </Card>

      <div className="space-y-4">
        {autoProximos.length > 0 && (
          <Card className="border-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCheck className="h-4 w-4 text-primary" />
                Agendado por los vendedores
                <Badge variant="secondary">{autoProximos.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">{autoProximos.map(renderEvento)}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">
              {selectedDate
                ? `Agenda del ${selectedDate.toLocaleDateString("es-AR")}`
                : "Seleccioná un día"}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFechaAgenda(selectedDate ?? new Date());
                setDialogAbierto(true);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Programar visita
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {!loading && delDia.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin visitas programadas para este día.</p>
            )}
            {delDia.map(renderEvento)}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Programar visita</DialogTitle>
            <DialogDescription>
              Elegí vendedor, día y cliente. Le va a aparecer en "Por visitar" ese día.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Vendedor</Label>
              <Select value={vendedorId} onValueChange={setVendedorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir vendedor" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {vendedores.map(v => (
                    <SelectItem key={v.user_id} value={v.user_id}>
                      {v.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Día de la visita</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !fechaAgenda && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fechaAgenda
                        ? fechaAgenda.toLocaleDateString("es-AR", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "Elegir fecha"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fechaAgenda}
                      onSelect={setFechaAgenda}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Hora</Label>
                <Input
                  type="time"
                  value={horaAgenda}
                  onChange={e => setHoraAgenda(e.target.value)}
                  className="w-[7.5rem]"
                />
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={e => buscar(e.target.value)}
                placeholder="Nombre del cliente o prospecto…"
                className="pl-9"
              />
            </div>

            <Textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Nota para el vendedor (opcional)"
              rows={2}
            />

            <div className="space-y-2">
              {buscando && <p className="text-sm text-muted-foreground">Buscando…</p>}
              {!buscando && busqueda.trim().length >= 3 && resultados.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin resultados.</p>
              )}
              {resultados.map(c => (
                <button
                  key={`${c.esProspecto ? "p" : "c"}-${c.id}`}
                  onClick={() => agendarVisita(c)}
                  disabled={agendando === c.id}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 p-2.5 text-left hover:bg-muted/40 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.nombre}</p>
                    {c.detalle && (
                      <p className="truncate text-xs text-muted-foreground">{c.detalle}</p>
                    )}
                  </div>
                  {c.esProspecto && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Prospecto
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AsignadorCalendario;
