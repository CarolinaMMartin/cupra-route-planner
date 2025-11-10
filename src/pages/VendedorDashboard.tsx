import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CalendarDays, 
  CheckCircle2, 
  Clock, 
  TrendingUp,
  MapPin,
  Users,
  Target
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AsignacionHistorial {
  id: string;
  estado: string;
  created_at: string;
  client_id: string | null;
  prospecto_place_id: string | null;
  es_prospecto: boolean;
  cliente_info?: {
    razon_social: string;
    barrio_principal?: string;
    provincia_principal?: string;
  };
  prospecto_info?: {
    nombre: string;
    barrio?: string;
    provincia?: string;
  };
  feedback?: {
    feedback: string;
    visita_realizada: boolean;
    tipo_interaccion?: string;
    created_at: string;
  };
}

interface Estadisticas {
  totalAsignaciones: number;
  asignacionesActivas: number;
  visitasRealizadas: number;
  porVisitar: number;
  tasaConversion: number;
}

const VendedorDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [historial, setHistorial] = useState<AsignacionHistorial[]>([]);
  const [estadisticas, setEstadisticas] = useState<Estadisticas>({
    totalAsignaciones: 0,
    asignacionesActivas: 0,
    visitasRealizadas: 0,
    porVisitar: 0,
    tasaConversion: 0,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      // Obtener todas las asignaciones del vendedor
      const { data: asignaciones, error: asignacionesError } = await supabase
        .from("asignaciones_vendedores_clientes")
        .select("*")
        .eq("vendedor_id", user.id)
        .order("created_at", { ascending: false });

      if (asignacionesError) throw asignacionesError;

      // Obtener información de clientes y prospectos
      const clientIds = asignaciones
        ?.filter(a => a.client_id)
        .map(a => a.client_id) || [];
      
      const prospectoIds = asignaciones
        ?.filter(a => a.prospecto_place_id)
        .map(a => a.prospecto_place_id) || [];

      const [clientesRes, prospectosRes, feedbacksRes] = await Promise.all([
        clientIds.length > 0 
          ? supabase.from("clientes").select("client_id, razon_social, barrio_principal, provincia_principal").in("client_id", clientIds)
          : Promise.resolve({ data: [] }),
        prospectoIds.length > 0
          ? supabase.from("prospectos").select("place_id, nombre, barrio, provincia").in("place_id", prospectoIds)
          : Promise.resolve({ data: [] }),
        supabase.from("cliente_feedbacks").select("*").eq("vendedor_id", user.id)
      ]);

      // Mapear información
      const clientesMap = new Map<string, any>();
      clientesRes.data?.forEach(c => clientesMap.set(c.client_id, c));
      
      const prospectosMap = new Map<string, any>();
      prospectosRes.data?.forEach(p => prospectosMap.set(p.place_id, p));
      
      const feedbacksMap = new Map<string, any>();
      feedbacksRes.data?.forEach(f => {
        const key = f.client_id || f.prospecto_place_id || '';
        if (key) feedbacksMap.set(key, f);
      });

      const historialCompleto: AsignacionHistorial[] = (asignaciones || []).map(asig => ({
        id: asig.id,
        estado: asig.estado,
        created_at: asig.created_at,
        client_id: asig.client_id,
        prospecto_place_id: asig.prospecto_place_id,
        es_prospecto: asig.es_prospecto,
        cliente_info: asig.client_id ? clientesMap.get(asig.client_id) as any : undefined,
        prospecto_info: asig.prospecto_place_id ? prospectosMap.get(asig.prospecto_place_id) as any : undefined,
        feedback: feedbacksMap.get(asig.client_id || asig.prospecto_place_id || '') as any,
      }));

      setHistorial(historialCompleto);

      // Calcular estadísticas
      const activas = historialCompleto.filter(h => h.estado === "Asignado" || h.estado === "Por visitar");
      const visitadas = historialCompleto.filter(h => h.estado === "Visitado");
      const porVisitar = historialCompleto.filter(h => h.estado === "Por visitar");

      setEstadisticas({
        totalAsignaciones: historialCompleto.length,
        asignacionesActivas: activas.length,
        visitasRealizadas: visitadas.length,
        porVisitar: porVisitar.length,
        tasaConversion: historialCompleto.length > 0 
          ? Math.round((visitadas.length / historialCompleto.length) * 100)
          : 0,
      });

    } catch (error) {
      console.error("Error al cargar dashboard:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo cargar el dashboard",
      });
    } finally {
      setLoading(false);
    }
  };

  const getEstadoBadge = (estado: string) => {
    const variants = {
      "Asignado": "secondary",
      "Por visitar": "default",
      "Visitado": "outline",
    };
    return <Badge variant={variants[estado] as any}>{estado}</Badge>;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Cargando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Mi Dashboard</h1>
        <p className="text-muted-foreground">Resumen de todas tus asignaciones y actividad</p>
      </div>

      {/* Estadísticas principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Asignaciones</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{estadisticas.totalAsignaciones}</div>
            <p className="text-xs text-muted-foreground">Históricas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activas</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{estadisticas.asignacionesActivas}</div>
            <p className="text-xs text-muted-foreground">Por atender</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Visitadas</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{estadisticas.visitasRealizadas}</div>
            <p className="text-xs text-muted-foreground">Completadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de Conversión</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{estadisticas.tasaConversion}%</div>
            <p className="text-xs text-muted-foreground">Visitas completadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs de historial */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Asignaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="todas" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="todas">Todas</TabsTrigger>
              <TabsTrigger value="activas">Activas</TabsTrigger>
              <TabsTrigger value="visitadas">Visitadas</TabsTrigger>
            </TabsList>

            <TabsContent value="todas" className="mt-4">
              <ScrollArea className="h-[500px] w-full pr-4">
                {historial.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay asignaciones</p>
                ) : (
                  <div className="space-y-3">
                    {historial.map((asig) => (
                      <Card key={asig.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">
                                {asig.es_prospecto 
                                  ? asig.prospecto_info?.nombre 
                                  : asig.cliente_info?.razon_social}
                              </p>
                              {getEstadoBadge(asig.estado)}
                            </div>
                            
                            {(asig.cliente_info?.barrio_principal || asig.prospecto_info?.barrio) && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {asig.cliente_info?.barrio_principal || asig.prospecto_info?.barrio}, {asig.cliente_info?.provincia_principal || asig.prospecto_info?.provincia}
                              </p>
                            )}
                            
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              Asignado: {formatDate(asig.created_at)}
                            </p>

                            {asig.feedback && (
                              <div className="mt-2 p-2 bg-muted rounded-md">
                                <p className="text-xs font-medium mb-1">
                                  {asig.feedback.tipo_interaccion || "Feedback"}
                                </p>
                                <p className="text-xs text-muted-foreground">{asig.feedback.feedback}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatDate(asig.feedback.created_at)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="activas" className="mt-4">
              <ScrollArea className="h-[500px] w-full pr-4">
                {historial.filter(h => h.estado === "Asignado" || h.estado === "Por visitar").length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay asignaciones activas</p>
                ) : (
                  <div className="space-y-3">
                    {historial
                      .filter(h => h.estado === "Asignado" || h.estado === "Por visitar")
                      .map((asig) => (
                        <Card key={asig.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold">
                                  {asig.es_prospecto 
                                    ? asig.prospecto_info?.nombre 
                                    : asig.cliente_info?.razon_social}
                                </p>
                                {getEstadoBadge(asig.estado)}
                              </div>
                              
                              {(asig.cliente_info?.barrio_principal || asig.prospecto_info?.barrio) && (
                                <p className="text-sm text-muted-foreground flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {asig.cliente_info?.barrio_principal || asig.prospecto_info?.barrio}
                                </p>
                              )}
                              
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(asig.created_at)}
                              </p>
                            </div>
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="visitadas" className="mt-4">
              <ScrollArea className="h-[500px] w-full pr-4">
                {historial.filter(h => h.estado === "Visitado").length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay visitas completadas</p>
                ) : (
                  <div className="space-y-3">
                    {historial
                      .filter(h => h.estado === "Visitado")
                      .map((asig) => (
                        <Card key={asig.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold">
                                  {asig.es_prospecto 
                                    ? asig.prospecto_info?.nombre 
                                    : asig.cliente_info?.razon_social}
                                </p>
                                {getEstadoBadge(asig.estado)}
                              </div>
                              
                              {asig.feedback && (
                                <div className="mt-2 p-2 bg-muted rounded-md">
                                  <p className="text-xs font-medium mb-1">
                                    {asig.feedback.tipo_interaccion || "Feedback"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{asig.feedback.feedback}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default VendedorDashboard;
