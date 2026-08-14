import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Check, Trash2, Clock, Route } from "lucide-react";
import { cn } from "@/lib/utils";

interface Recordatorio {
  id: string;
  titulo: string;
  nota: string | null;
  fecha_recordatorio: string;
  completado: boolean;
  client_id: string | null;
  prospecto_place_id: string | null;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const RecordatoriosCalendario = () => {
  const [recordatorios, setRecordatorios] = useState<Recordatorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Candidato[]>([]);
  const [nota, setNota] = useState("");
  const [agendando, setAgendando] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const { toast } = useToast();

  const fetchRecordatorios = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("recordatorios")
        .select("id, titulo, nota, fecha_recordatorio, completado, client_id, prospecto_place_id")
        .eq("vendedor_id", user.id)
        .order("fecha_recordatorio", { ascending: true });
      if (error) throw error;
      setRecordatorios((data || []) as Recordatorio[]);
    } catch (error) {
      console.error("Error cargando recordatorios:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordatorios();
  }, []);

  const toggleCompletado = async (r: Recordatorio) => {
    const { error } = await supabase
      .from("recordatorios")
      .update({ completado: !r.completado })
      .eq("id", r.id);
    if (error) {
      toast({ variant: "destructive", title: "No se pudo actualizar" });
      return;
    }
    setRecordatorios(prev => prev.map(x => (x.id === r.id ? { ...x, completado: !x.completado } : x)));
  };

  const sumarARuta = async (r: Recordatorio) => {
    if (!r.client_id && !r.prospecto_place_id) {
      toast({ variant: "destructive", title: "Este recordatorio no tiene cliente asociado" });
      return;
    }
    setAdding(r.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let existing = supabase
        .from("asignaciones_vendedores_clientes")
        .select("id, estado")
        .eq("vendedor_id", user.id);
      existing = r.client_id
        ? existing.eq("client_id", r.client_id)
        : existing.eq("prospecto_place_id", r.prospecto_place_id!);

      const { data: yaAsignado, error: existingError } = await existing.maybeSingle();
      if (existingError) throw existingError;

      // Ya existe una asignación (única por vendedor+cliente): la reactivamos.
      if (yaAsignado) {
        if (yaAsignado.estado !== "Visitado") {
          toast({ title: "Ya está en tu ruta", description: "Lo vas a encontrar en el tablero Kanban." });
          return;
        }
        const { error: reactivarError } = await supabase
          .from("asignaciones_vendedores_clientes")
          .update({ estado: "Por visitar", visited_at: null })
          .eq("id", yaAsignado.id);
        if (reactivarError) throw reactivarError;
        toast({
          title: "Sumado a tu ruta de hoy",
          description: "Estaba marcado como visitado: lo reactivé para una nueva visita.",
        });
        return;
      }

      const { error } = await supabase.from("asignaciones_vendedores_clientes").insert({
        vendedor_id: user.id,
        client_id: r.client_id,
        prospecto_place_id: r.prospecto_place_id,
        es_prospecto: !!r.prospecto_place_id,
        estado: "Por visitar",
        origen_asignacion: "auto",
      });
      if (error) throw error;

      toast({
        title: "Sumado a tu ruta de hoy",
        description: "Ya podés registrar el feedback desde el tablero Kanban.",
      });
    } catch (error) {
      console.error("Error sumando a la ruta:", error);
      toast({ variant: "destructive", title: "No se pudo sumar a la ruta" });
    } finally {
      setAdding(null);
    }
  };

  const eliminar = async (id: string) => {
    const { error } = await supabase.from("recordatorios").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "No se pudo eliminar" });
      return;
    }
    setRecordatorios(prev => prev.filter(x => x.id !== id));
  };

  const buscar = async (q: string) => {
    setBusqueda(q);
    if (q.trim().length < 3) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const [{ data: clientes }, { data: prospectos }] = await Promise.all([
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
        ...(clientes || []).map(c => ({
          id: c.client_id,
          nombre: c.razon_social || c.client_id,
          detalle: [c.barrio_principal, c.ciudad_principal].filter(Boolean).join(" · "),
          esProspecto: false,
        })),
        ...(prospectos || []).map(p => ({
          id: p.place_id,
          nombre: p.nombre,
          detalle: [p.barrio, p.ciudad].filter(Boolean).join(" · "),
          esProspecto: true,
        })),
      ]);
    } finally {
      setBuscando(false);
    }
  };

  const agendarVisita = async (candidato: Candidato) => {
    if (!selectedDate) return;
    setAgendando(candidato.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const fecha = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;

      let existing = supabase
        .from("asignaciones_vendedores_clientes")
        .select("id")
        .eq("vendedor_id", user.id);
      existing = candidato.esProspecto
        ? existing.eq("prospecto_place_id", candidato.id)
        : existing.eq("client_id", candidato.id);
      const { data: yaAsignado } = await existing.maybeSingle();

      if (yaAsignado) {
        const { error } = await supabase
          .from("asignaciones_vendedores_clientes")
          .update({ estado: "Por visitar", visited_at: null, fecha_programada: fecha })
          .eq("id", yaAsignado.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("asignaciones_vendedores_clientes").insert({
          vendedor_id: user.id,
          client_id: candidato.esProspecto ? null : candidato.id,
          prospecto_place_id: candidato.esProspecto ? candidato.id : null,
          es_prospecto: candidato.esProspecto,
          estado: "Por visitar",
          origen_asignacion: "auto",
          fecha_programada: fecha,
        });
        if (error) throw error;
      }

      const recordatorio: any = {
        vendedor_id: user.id,
        titulo: `Visita agendada: ${candidato.nombre}`,
        nota: nota || null,
        fecha_recordatorio: new Date(`${fecha}T09:00:00-03:00`).toISOString(),
      };
      if (candidato.esProspecto) recordatorio.prospecto_place_id = candidato.id;
      else recordatorio.client_id = candidato.id;
      await supabase.from("recordatorios").insert(recordatorio);

      toast({
        title: "Visita agendada",
        description: `${candidato.nombre} va a aparecer en "Por visitar" el ${selectedDate.toLocaleDateString("es-AR")}.`,
      });
      setDialogAbierto(false);
      setBusqueda("");
      setResultados([]);
      setNota("");
      fetchRecordatorios();
    } catch (error) {
      console.error("Error agendando visita:", error);
      toast({ variant: "destructive", title: "No se pudo agendar la visita" });
    } finally {
      setAgendando(null);
    }
  };

  const fechasConRecordatorio = useMemo(
    () => recordatorios.filter(r => !r.completado).map(r => new Date(r.fecha_recordatorio)),
    [recordatorios],
  );

  const delDia = useMemo(() => {
    if (!selectedDate) return [];
    return recordatorios.filter(r => sameDay(new Date(r.fecha_recordatorio), selectedDate));
  }, [recordatorios, selectedDate]);

  const proximos = useMemo(() => {
    const hoy = new Date();
    return recordatorios
      .filter(r => !r.completado && new Date(r.fecha_recordatorio) >= hoy)
      .slice(0, 5);
  }, [recordatorios]);

  const vencidos = useMemo(() => {
    const hoy = new Date();
    return recordatorios.filter(r => !r.completado && new Date(r.fecha_recordatorio) < hoy);
  }, [recordatorios]);

  const renderItem = (r: Recordatorio) => (
    <div
      key={r.id}
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3"
    >
      <CalendarClock className={cn("mt-0.5 h-4 w-4 shrink-0", r.completado ? "text-muted-foreground" : "text-accent")} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium truncate", r.completado && "line-through text-muted-foreground")}>
          {r.titulo}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(r.fecha_recordatorio).toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })}
        </p>
        {r.nota && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.nota}</p>}
      </div>
      {!r.completado && (r.client_id || r.prospecto_place_id) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Sumar a mi ruta de hoy"
          disabled={adding === r.id}
          onClick={() => sumarARuta(r)}
        >
          <Route className="h-3.5 w-3.5 text-accent" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => toggleCompletado(r)}>
        <Check className={cn("h-3.5 w-3.5", r.completado ? "text-emerald-500" : "text-muted-foreground")} />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => eliminar(r.id)}>
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
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
            modifiers={{ pendiente: fechasConRecordatorio }}
            modifiersClassNames={{ pendiente: "font-bold text-accent underline underline-offset-4" }}
            className={cn("p-0 pointer-events-auto")}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {vencidos.length > 0 && (
          <Card className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-amber-500" />
                Vencidos
                <Badge variant="secondary">{vencidos.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">{vencidos.map(renderItem)}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {selectedDate
                ? `Seguimientos del ${selectedDate.toLocaleDateString("es-AR")}`
                : "Seleccioná un día"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {!loading && delDia.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin seguimientos agendados para este día.</p>
            )}
            {delDia.map(renderItem)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Próximos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {proximos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tenés seguimientos agendados.</p>
            ) : (
              proximos.map(renderItem)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RecordatoriosCalendario;
