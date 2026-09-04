import { SALES_PROFILE_OR_FILTER } from "@/lib/roles";
import { useEffect, useState, useMemo } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
import { useNavigate } from "react-router-dom";
import AppNav from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Users,
  CheckCircle2,
  Clock,
  TrendingUp,
  Filter,
  RefreshCw,
  XCircle,
  MapPin,
  X,
  MessageSquare,
  ChevronDown,
  Activity } from
"lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toTitleCase } from "@/lib/format";
import ActividadesResumen from "@/components/assignor/ActividadesResumen";

interface VendedorStats {
  vendedor_id: string;
  nombre: string;
  email: string;
  total: number;
  pendientes: number;
  visitadas: number;
  noVisitadas: number;
  tasa: number;
}

interface AsignacionDetalle {
  id: string;
  estado: string;
  created_at: string;
  visited_at: string | null;
  es_prospecto: boolean;
  origen_asignacion: string;
  vendedor_id: string;
  vendedor_nombre: string;
  cliente_nombre: string;
  direccion: string;
  // Campos de feedback
  tipo_cierre: 'Visitado' | 'Online' | 'No visitado' | null;
  tipo_interaccion: string | null;
  motivo_no_visita: string | null;
  feedback_texto: string | null;
  actualizar_etiqueta_wa: string | null;
  feedback_fecha: string | null;
}

interface Filters {
  asignadoDesde: string;
  asignadoHasta: string;
  visitadoDesde: string;
  visitadoHasta: string;
  vendedorId: string;
  estado: string;
}

interface FeedbackData {
  client_id: string | null;
  prospecto_place_id: string | null;
  vendedor_id: string;
  visita_realizada: boolean;
  tipo_interaccion: string | null;
  motivo_no_visita: string | null;
  feedback: string;
  actualizar_etiqueta_wa: string | null;
  created_at: string;
}


const cierreClass = (tipo: string | null) =>
cn(
  tipo === "Visitado" && "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  tipo === "Online" && "bg-primary/15 text-primary border-primary/30",
  tipo === "No visitado" && "bg-amber-500/15 text-amber-600 border-amber-500/30"
);

const AsignacionRow = ({
  a,
  formatDate,
  formatDateTime




}: {a: AsignacionDetalle;formatDate: (d: string | null) => string;formatDateTime: (d: string | null) => string;}) => {
  const [open, setOpen] = useState(false);
  const tieneDetalle = !!(a.feedback_texto || a.motivo_no_visita || a.tipo_interaccion || a.actualizar_etiqueta_wa);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors border border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={a.es_prospecto ? "outline" : "secondary"} className="text-[10px] px-1.5">
                {a.es_prospecto ? "Prospecto" : "Cliente"}
              </Badge>
              <span className="font-medium text-sm truncate">{toTitleCase(a.cliente_nombre)}</span>
            </div>
            {a.direccion &&
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />{a.direccion}
              </p>
            }
            <p className="text-xs text-muted-foreground mt-1">
              Asignado {formatDate(a.created_at)}
              {a.visited_at ? ` · Cerrado ${formatDate(a.visited_at)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {a.tipo_cierre ?
            <Badge variant="outline" className={cierreClass(a.tipo_cierre)}>{a.tipo_cierre}</Badge> :
            <Badge variant="outline" className="text-muted-foreground">{a.estado}</Badge>
            }
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 mx-1 mb-1 rounded-b-lg bg-card/60 border border-t-0 border-border/40 space-y-2 text-sm">
          {!tieneDetalle &&
          <p className="text-muted-foreground text-xs">El vendedor todavía no cargó información de esta visita.</p>
          }
          {a.tipo_interaccion &&
          <p><span className="text-xs uppercase text-muted-foreground mr-2">Interacción</span>{a.tipo_interaccion}</p>
          }
          {a.motivo_no_visita &&
          <p><span className="text-xs uppercase text-muted-foreground mr-2">Motivo</span><span className="text-amber-600">{a.motivo_no_visita}</span></p>
          }
          {a.feedback_texto &&
          <div>
              <p className="text-xs uppercase text-muted-foreground flex items-center gap-1 mb-1">
                <MessageSquare className="h-3 w-3" />Comentario del vendedor
              </p>
              <p className="whitespace-pre-wrap bg-muted/40 p-2.5 rounded-md">{a.feedback_texto}</p>
            </div>
          }
          {a.actualizar_etiqueta_wa &&
          <p><span className="text-xs uppercase text-muted-foreground mr-2">Etiqueta</span>{a.actualizar_etiqueta_wa}</p>
          }
          {a.feedback_fecha &&
          <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
              Registrado: {formatDateTime(a.feedback_fecha)}
            </p>
          }
        </div>
      </CollapsibleContent>
    </Collapsible>);

};

const VendedorCard = ({
  stat,
  asignaciones,
  formatDate,
  formatDateTime






}: {stat: VendedorStats;asignaciones: AsignacionDetalle[];formatDate: (d: string | null) => string;formatDateTime: (d: string | null) => string;}) => {
  const [open, setOpen] = useState(false);

  return (
    <Card className="matte-card overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full text-left p-4 hover:bg-accent/40 transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">{stat.nombre}</p>
              <p className="text-xs text-muted-foreground">{stat.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground">{stat.total} asignadas</span>
              <span className="text-amber-500">{stat.pendientes} pendientes</span>
              <span className="text-emerald-500">{stat.visitadas} visitadas</span>
              <span className="text-rose-500">{stat.noVisitadas} no visitadas</span>
              <Badge variant={stat.tasa >= 70 ? "default" : stat.tasa >= 40 ? "secondary" : "destructive"}>
                {stat.tasa.toFixed(0)}%
              </Badge>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2">
            {asignaciones.length === 0 ?
            <p className="text-sm text-muted-foreground">Sin asignaciones en el período filtrado.</p> :
            asignaciones.map((a) =>
            <AsignacionRow key={a.id} a={a} formatDate={formatDate} formatDateTime={formatDateTime} />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>);

};

const SupervisionVendedores = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [vendedores, setVendedores] = useState<{id: string;nombre: string;}[]>([]);
  const [vendedorStats, setVendedorStats] = useState<VendedorStats[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionDetalle[]>([]);
  const [openFilters, setOpenFilters] = useState(false);
  const [openActividades, setOpenActividades] = useState(false);
  const [openResumen, setOpenResumen] = useState(true);

  const [filters, setFilters] = useState<Filters>({
    asignadoDesde: "",
    asignadoHasta: "",
    visitadoDesde: "",
    visitadoHasta: "",
    vendedorId: "all",
    estado: "all"
  });

  // Verificar acceso - solo asignadores
  useEffect(() => {
    const checkAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: profile } = await supabase.
      from("profiles").
      select("rol").
      eq("user_id", user.id).
      single();

      if (!isAssignorLike(profile?.rol)) {
        toast({
          variant: "destructive",
          title: "Acceso denegado",
          description: "Solo los asignadores pueden acceder a esta página"
        });
        navigate("/");
      }
    };
    checkAccess();
  }, [navigate, toast]);

  // Cargar lista de vendedores
  useEffect(() => {
    const fetchVendedores = async () => {
      const { data } = await supabase.
      from("profiles").
      select("user_id, nombre").
      or(SALES_PROFILE_OR_FILTER).
      eq("activo", true);

      if (data) {
        setVendedores(data.map((v) => ({ id: v.user_id, nombre: toTitleCase(v.nombre) })));
      }
    };
    fetchVendedores();
  }, []);

  // Lógica inteligente de filtros
  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => {
      const newFilters = { ...prev, [key]: value };

      // Si se selecciona fecha de visita, auto-ajustar estado a "Visitado"
      if ((key === "visitadoDesde" || key === "visitadoHasta") && value) {
        newFilters.estado = "Visitado";
      }

      // Si se selecciona estado "Por visitar", limpiar filtros de fecha visita
      if (key === "estado" && value === "Por visitar") {
        newFilters.visitadoDesde = "";
        newFilters.visitadoHasta = "";
      }

      return newFilters;
    });
  };

  const clearFilters = () => {
    setFilters({
      asignadoDesde: "",
      asignadoHasta: "",
      visitadoDesde: "",
      visitadoHasta: "",
      vendedorId: "all",
      estado: "all"
    });
  };

  // Helper para crear key de feedback
  const getFeedbackKey = (a: {client_id?: string | null;prospecto_place_id?: string | null;vendedor_id: string;}) => {
    return a.client_id ?
    `client:${a.client_id}:${a.vendedor_id}` :
    `prospecto:${a.prospecto_place_id}:${a.vendedor_id}`;
  };

  // Fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      // Query base para asignaciones
      let query = supabase.
      from("asignaciones_vendedores_clientes").
      select(`
          id,
          estado,
          created_at,
          visited_at,
          es_prospecto,
          origen_asignacion,
          vendedor_id,
          client_id,
          prospecto_place_id
        `);

      // Aplicar filtros de fecha de asignación
      if (filters.asignadoDesde) {
        query = query.gte("created_at", filters.asignadoDesde);
      }
      if (filters.asignadoHasta) {
        query = query.lte("created_at", filters.asignadoHasta + "T23:59:59");
      }

      // Aplicar filtros de fecha de visita
      if (filters.visitadoDesde) {
        query = query.gte("visited_at", filters.visitadoDesde);
      }
      if (filters.visitadoHasta) {
        query = query.lte("visited_at", filters.visitadoHasta + "T23:59:59");
      }

      // Aplicar filtro de vendedor
      if (filters.vendedorId !== "all") {
        query = query.eq("vendedor_id", filters.vendedorId);
      }

      // Aplicar filtro de estado
      if (filters.estado !== "all") {
        query = query.eq("estado", filters.estado as "Asignado" | "Por visitar" | "Visitado");
      }

      const { data: asignacionesData, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      // Obtener datos de vendedores, clientes y prospectos
      const vendedorIds = [...new Set(asignacionesData?.map((a) => a.vendedor_id) || [])];
      const clientIds = [...new Set(asignacionesData?.filter((a) => a.client_id).map((a) => a.client_id) || [])];
      const prospectoPlaceIds = [...new Set(asignacionesData?.filter((a) => a.prospecto_place_id).map((a) => a.prospecto_place_id) || [])];

      // Query para feedbacks de asignaciones visitadas
      const asignacionesVisitadas = asignacionesData || [];

      const [vendedoresRes, clientesRes, prospectosRes] = await Promise.all([
      supabase.from("profiles").select("user_id, nombre, email").in("user_id", vendedorIds),
      clientIds.length > 0 ?
      supabase.from("clientes").select("client_id, razon_social, direccion_principal").in("client_id", clientIds) :
      Promise.resolve({ data: [] as {client_id: string;razon_social: string | null;direccion_principal: string | null;}[] }),
      prospectoPlaceIds.length > 0 ?
      supabase.from("prospectos").select("place_id, nombre, direccion").in("place_id", prospectoPlaceIds) :
      Promise.resolve({ data: [] as {place_id: string;nombre: string;direccion: string;}[] })]
      );

      // Obtener feedbacks para las asignaciones visitadas
      let feedbacksMap = new Map<string, FeedbackData>();

      if (asignacionesVisitadas.length > 0) {
        const feedbackClientIds = asignacionesVisitadas.filter((a) => a.client_id).map((a) => a.client_id!);
        const feedbackProspectoIds = asignacionesVisitadas.filter((a) => a.prospecto_place_id).map((a) => a.prospecto_place_id!);

        // Construir query de feedbacks
        let feedbackQuery = supabase.
        from('cliente_feedbacks').
        select('client_id, prospecto_place_id, vendedor_id, visita_realizada, tipo_interaccion, motivo_no_visita, feedback, actualizar_etiqueta_wa, created_at').
        order('created_at', { ascending: false });

        // Filtrar por client_ids o prospecto_place_ids
        if (feedbackClientIds.length > 0 && feedbackProspectoIds.length > 0) {
          feedbackQuery = feedbackQuery.or(`client_id.in.(${feedbackClientIds.join(',')}),prospecto_place_id.in.(${feedbackProspectoIds.join(',')})`);
        } else if (feedbackClientIds.length > 0) {
          feedbackQuery = feedbackQuery.in('client_id', feedbackClientIds);
        } else if (feedbackProspectoIds.length > 0) {
          feedbackQuery = feedbackQuery.in('prospecto_place_id', feedbackProspectoIds);
        }

        const { data: feedbacksData } = await feedbackQuery;

        // Mapear feedbacks - usar el más reciente por client/prospecto + vendedor
        (feedbacksData || []).forEach((f) => {
          const key = f.client_id ?
          `client:${f.client_id}:${f.vendedor_id}` :
          `prospecto:${f.prospecto_place_id}:${f.vendedor_id}`;
          if (!feedbacksMap.has(key)) {
            feedbacksMap.set(key, f);
          }
        });
      }

      const vendedoresMap = new Map(vendedoresRes.data?.map((v) => [v.user_id, v] as const) || []);
      const clientesMap = new Map((clientesRes.data || []).map((c) => [c.client_id, c] as const));
      const prospectosMap = new Map((prospectosRes.data || []).map((p) => [p.place_id, p] as const));

      // Calcular estadísticas por vendedor usando tipo de cierre
      const statsMap = new Map<string, VendedorStats>();

      asignacionesData?.forEach((a) => {
        const vendedor = vendedoresMap.get(a.vendedor_id);
        if (!vendedor) return;

        if (!statsMap.has(a.vendedor_id)) {
          statsMap.set(a.vendedor_id, {
            vendedor_id: a.vendedor_id,
            nombre: toTitleCase(vendedor.nombre),
            email: vendedor.email,
            total: 0,
            pendientes: 0,
            visitadas: 0,
            noVisitadas: 0,
            tasa: 0
          });
        }

        const stats = statsMap.get(a.vendedor_id)!;
        stats.total++;

        if (a.estado === "Visitado") {
          // Buscar feedback para determinar tipo de cierre real
          const feedbackKey = getFeedbackKey(a);
          const feedback = feedbacksMap.get(feedbackKey);

          if (feedback) {
            if (feedback.visita_realizada) {
              // Visitado o Online = cuenta como visitada
              stats.visitadas++;
            } else {
              // No visitado = cerrado pero sin visita efectiva
              stats.noVisitadas++;
            }
          } else {
            // Sin feedback pero estado Visitado (edge case) - contar como visitada
            stats.visitadas++;
          }
        } else {
          stats.pendientes++;
        }
      });

      // Calcular tasas
      statsMap.forEach((stats) => {
        stats.tasa = stats.total > 0 ? stats.visitadas / stats.total * 100 : 0;
      });

      setVendedorStats(Array.from(statsMap.values()).sort((a, b) => b.total - a.total));

      // Mapear asignaciones con detalles y feedback
      const detalleAsignaciones: AsignacionDetalle[] = (asignacionesData || []).map((a) => {
        const vendedor = vendedoresMap.get(a.vendedor_id);
        let clienteNombre = "";
        let direccion = "";

        if (a.es_prospecto && a.prospecto_place_id) {
          const prospecto = prospectosMap.get(a.prospecto_place_id);
          clienteNombre = prospecto?.nombre || "Prospecto desconocido";
          direccion = prospecto?.direccion || "";
        } else if (a.client_id) {
          const cliente = clientesMap.get(a.client_id);
          clienteNombre = cliente?.razon_social || "Cliente desconocido";
          direccion = cliente?.direccion_principal || "";
        }

        // Determinar tipo de cierre basado en feedback
        const feedbackKey = getFeedbackKey(a);
        const feedback = feedbacksMap.get(feedbackKey);
        let tipoCierre: 'Visitado' | 'Online' | 'No visitado' | null = null;

        if (feedback) {
          if (!feedback.visita_realizada) {
            tipoCierre = 'No visitado';
          } else if (feedback.tipo_interaccion?.startsWith('[Online]')) {
            tipoCierre = 'Online';
          } else {
            tipoCierre = 'Visitado';
          }
        }

        return {
          id: a.id,
          estado: a.estado,
          vendedor_id: a.vendedor_id,
          created_at: a.created_at,
          visited_at: a.visited_at,
          es_prospecto: a.es_prospecto,
          origen_asignacion: a.origen_asignacion,
          vendedor_nombre: toTitleCase(vendedor?.nombre) || "Desconocido",
          cliente_nombre: clienteNombre,
          direccion,
          tipo_cierre: tipoCierre,
          tipo_interaccion: feedback?.tipo_interaccion?.replace('[Online] ', '') || null,
          motivo_no_visita: feedback?.motivo_no_visita || null,
          feedback_texto: feedback?.feedback || null,
          actualizar_etiqueta_wa: feedback?.actualizar_etiqueta_wa || null,
          feedback_fecha: feedback?.created_at || null
        };
      });

      setAsignaciones(detalleAsignaciones.slice(0, 500));
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar los datos"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters]);

  // KPIs globales
  const kpis = useMemo(() => {
    const total = vendedorStats.reduce((sum, v) => sum + v.total, 0);
    const pendientes = vendedorStats.reduce((sum, v) => sum + v.pendientes, 0);
    const visitadas = vendedorStats.reduce((sum, v) => sum + v.visitadas, 0);
    const noVisitadas = vendedorStats.reduce((sum, v) => sum + v.noVisitadas, 0);
    const tasa = total > 0 ? visitadas / total * 100 : 0;
    return { total, pendientes, visitadas, noVisitadas, tasa };
  }, [vendedorStats]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Determinar si los filtros de fecha de visita deben estar deshabilitados
  const visitaFiltersDisabled = filters.estado === "Por visitar";

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>

              <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">
                Supervisión de Vendedores
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Monitoreo de asignaciones y cumplimiento de visitas
              </p>
            </div>
          </div>
          <img src={cupraLogo} alt="Cupra Logo" className="h-10 md:h-12" />
        </div>

        {/* Filtro activo de vendedor, con salida clara */}
        {filters.vendedorId !== "all" &&
        <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-2 py-1.5 pl-3 pr-2 text-sm">
              Viendo: {vendedores.find((v) => v.id === filters.vendedorId)?.nombre || "Vendedor"}
              <button
              type="button"
              aria-label="Ver todos los vendedores"
              onClick={() => handleFilterChange("vendedorId", "all")}
              className="rounded-full p-0.5 hover:bg-background/60 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => handleFilterChange("vendedorId", "all")}>
              Ver todos los vendedores
            </Button>
          </div>
        }

        {/* 1. Indicadores (KPIs) - Siempre visibles */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="matte-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Asignadas</p>
                  <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
                </div>
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="matte-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Pendientes</p>
                  <p className="text-2xl font-bold text-amber-500">{kpis.pendientes}</p>
                </div>
                <Clock className="h-6 w-6 text-amber-500" />
              </div>
            </CardContent>
          </Card>
          <Card className="matte-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Visitadas</p>
                  <p className="text-2xl font-bold text-emerald-500">{kpis.visitadas}</p>
                </div>
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
            </CardContent>
          </Card>
          <Card className="matte-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">No Visitadas</p>
                  <p className="text-2xl font-bold text-rose-500">{kpis.noVisitadas}</p>
                </div>
                <XCircle className="h-6 w-6 text-rose-500" />
              </div>
            </CardContent>
          </Card>
          <Card className="matte-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Tasa Cumplimiento</p>
                  <p className="text-2xl font-bold text-foreground">{kpis.tasa.toFixed(1)}%</p>
                </div>
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 2. Filtros */}
        <Collapsible open={openFilters} onOpenChange={setOpenFilters} className="w-full">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-4 bg-card hover:bg-accent/50 transition-colors rounded-lg border border-border/50">
            <div className="flex items-center gap-2 font-sans text-lg text-foreground">
              <Filter className="h-5 w-5 text-primary" />
              <span>Filtros de Búsqueda</span>
            </div>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform duration-200", openFilters && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <Card className="matte-card border-t-0 rounded-t-none">
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fecha Asignación (Desde)</label>
                    <Input type="date" value={filters.asignadoDesde} onChange={(e) => handleFilterChange("asignadoDesde", e.target.value)} className="bg-card" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fecha Asignación (Hasta)</label>
                    <Input type="date" value={filters.asignadoHasta} onChange={(e) => handleFilterChange("asignadoHasta", e.target.value)} className="bg-card" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fecha Visita (Desde)</label>
                    <Input type="date" value={filters.visitadoDesde} onChange={(e) => handleFilterChange("visitadoDesde", e.target.value)} className="bg-card" disabled={visitaFiltersDisabled} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fecha Visita (Hasta)</label>
                    <Input type="date" value={filters.visitadoHasta} onChange={(e) => handleFilterChange("visitadoHasta", e.target.value)} className="bg-card" disabled={visitaFiltersDisabled} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendedor</label>
                    <Select value={filters.vendedorId} onValueChange={(value) => handleFilterChange("vendedorId", value)}>
                      <SelectTrigger className="bg-card"><SelectValue placeholder="Todos los vendedores" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los vendedores</SelectItem>
                        {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{toTitleCase(v.nombre)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Estado</label>
                    <Select value={filters.estado} onValueChange={(value) => handleFilterChange("estado", value)}>
                      <SelectTrigger className="bg-card"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="Asignado">Asignado</SelectItem>
                        <SelectItem value="Por visitar">Por visitar</SelectItem>
                        <SelectItem value="Visitado">Visitado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="outline" onClick={clearFilters} className="flex-1">Limpiar filtros</Button>
                    <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
                      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* 3. Activaciones por Vendedor */}
        <Collapsible open={openActividades} onOpenChange={setOpenActividades} className="w-full">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-4 bg-card hover:bg-accent/50 transition-colors rounded-lg border border-border/50">
            <div className="flex items-center gap-2 font-sans text-lg text-foreground">
              <Activity className="h-5 w-5 text-primary" />
              <span>Activaciones por Vendedor</span>
            </div>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform duration-200", openActividades && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <ActividadesResumen vendedorIdFilter={filters.vendedorId} />
          </CollapsibleContent>
        </Collapsible>

        {/* 4. Trabajo por Vendedor (resumen + detalle unificados) */}
        <Collapsible open={openResumen} onOpenChange={setOpenResumen} className="w-full">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-4 bg-card hover:bg-accent/50 transition-colors rounded-lg border border-border/50">
            <div className="flex items-center gap-2 font-sans text-lg text-foreground">
              <Users className="h-5 w-5 text-primary" />
              <span>Trabajo por Vendedor</span>
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({vendedorStats.length} vendedores · {asignaciones.length} asignaciones)
              </span>
            </div>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform duration-200", openResumen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="space-y-2">
              {vendedorStats.length === 0 &&
              <Card className="matte-card">
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    No hay datos para los filtros seleccionados
                  </CardContent>
                </Card>
              }
              {vendedorStats.map((stat) =>
              <VendedorCard
                key={stat.vendedor_id}
                stat={stat}
                asignaciones={asignaciones.filter((a) => a.vendedor_id === stat.vendedor_id)}
                formatDate={formatDate}
                formatDateTime={formatDateTime} />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      </div>
    </div>);

};

export default SupervisionVendedores;
