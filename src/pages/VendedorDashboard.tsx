import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  CalendarDays, 
  CheckCircle2, 
  Clock, 
  TrendingUp,
  MapPin,
  Users,
  Target,
  ArrowLeft,
  Phone,
  MessageSquare,
  History,
  User
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import NotificacionesPanel from "@/components/vendedor/NotificacionesPanel";

interface FeedbackInfo {
  feedback: string;
  visita_realizada: boolean;
  tipo_interaccion?: string;
  created_at: string;
  vendedor_id: string;
  vendedor?: {
    nombre: string;
  };
}

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
    telefonos?: string[];
    emails?: string[];
    vendedor_principal?: string;
    categoria_volumen?: string;
    dias_desde_ultima_compra?: number;
  };
  prospecto_info?: {
    nombre: string;
    barrio?: string;
    provincia?: string;
    telefono?: string;
    direccion?: string;
  };
  feedback?: FeedbackInfo;
  todos_feedbacks?: FeedbackInfo[];
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
  const [selectedAsignacion, setSelectedAsignacion] = useState<AsignacionHistorial | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

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

      const [clientesRes, prospectosRes, feedbacksRes, allFeedbacksRaw] = await Promise.all([
        clientIds.length > 0 
          ? supabase.from("clientes").select("client_id, razon_social, barrio_principal, provincia_principal, telefonos, emails, vendedor_principal, categoria_volumen, dias_desde_ultima_compra").in("client_id", clientIds)
          : Promise.resolve({ data: [] }),
        prospectoIds.length > 0
          ? supabase.from("prospectos").select("place_id, nombre, barrio, provincia, telefono, direccion").in("place_id", prospectoIds)
          : Promise.resolve({ data: [] }),
        supabase.from("cliente_feedbacks").select("*").eq("vendedor_id", user.id),
        // Obtener TODOS los feedbacks (de todos los vendedores) para mostrar historial completo
        supabase.from("cliente_feedbacks").select("*")
      ]);

      // Obtener vendedor_ids únicos de todos los feedbacks para hacer join manual
      const vendedorIds = [...new Set(
        allFeedbacksRaw.data?.map(f => f.vendedor_id).filter(Boolean) || []
      )];

      // Query separado para profiles (ya que no hay FK definida)
      const profilesRes = vendedorIds.length > 0
        ? await supabase
            .from("profiles")
            .select("user_id, nombre")
            .in("user_id", vendedorIds)
        : { data: [] };

      // Crear mapa de profiles para merge manual
      const profilesMap = new Map<string, string>();
      profilesRes.data?.forEach(p => profilesMap.set(p.user_id, p.nombre));

      // Mapear feedbacks con info del vendedor
      const allFeedbacksData = allFeedbacksRaw.data?.map(f => ({
        ...f,
        vendedor: profilesMap.has(f.vendedor_id) 
          ? { nombre: profilesMap.get(f.vendedor_id) }
          : undefined
      })) || [];

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

      // Agrupar todos los feedbacks por cliente/prospecto
      const allFeedbacksMap = new Map<string, FeedbackInfo[]>();
      allFeedbacksData.forEach(f => {
        const key = f.client_id || f.prospecto_place_id || '';
        if (key) {
          if (!allFeedbacksMap.has(key)) {
            allFeedbacksMap.set(key, []);
          }
          allFeedbacksMap.get(key)?.push(f as FeedbackInfo);
        }
      });

      const historialCompleto: AsignacionHistorial[] = (asignaciones || []).map(asig => {
        const key = asig.client_id || asig.prospecto_place_id || '';
        return {
          id: asig.id,
          estado: asig.estado,
          created_at: asig.created_at,
          client_id: asig.client_id,
          prospecto_place_id: asig.prospecto_place_id,
          es_prospecto: asig.es_prospecto,
          cliente_info: asig.client_id ? clientesMap.get(asig.client_id) as any : undefined,
          prospecto_info: asig.prospecto_place_id ? prospectosMap.get(asig.prospecto_place_id) as any : undefined,
          feedback: feedbacksMap.get(key) as any,
          todos_feedbacks: allFeedbacksMap.get(key) || [],
        };
      });

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

  const handleCardClick = (asignacion: AsignacionHistorial) => {
    setSelectedAsignacion(asignacion);
    setShowDetailsDialog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Cargando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 md:p-6 space-y-4 md:space-y-6 overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={cupraLogo} alt="Cupra Wines" className="h-8 md:h-12 w-auto" />
          <div>
            <h1 className="text-xl md:text-3xl font-bold">Mi Dashboard</h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden md:block">Resumen de todas tus asignaciones y actividad</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificacionesPanel />
          <Button variant="outline" size="sm" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Volver a Asignaciones</span>
            <span className="sm:hidden">Volver</span>
          </Button>
        </div>
      </div>

      {/* Estadísticas principales */}
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <Card className="p-2 md:p-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Total</CardTitle>
            <Users className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-2 pt-0 md:p-6 md:pt-0">
            <div className="text-xl md:text-2xl font-bold">{estadisticas.totalAsignaciones}</div>
            <p className="text-xs text-muted-foreground hidden md:block">Históricas</p>
          </CardContent>
        </Card>

        <Card className="p-2 md:p-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Pendientes</CardTitle>
            <Target className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-2 pt-0 md:p-6 md:pt-0">
            <div className="text-xl md:text-2xl font-bold">{estadisticas.asignacionesActivas}</div>
            <p className="text-xs text-muted-foreground hidden md:block">Por atender</p>
          </CardContent>
        </Card>

        <Card className="p-2 md:p-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Visitadas</CardTitle>
            <CheckCircle2 className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-2 pt-0 md:p-6 md:pt-0">
            <div className="text-xl md:text-2xl font-bold">{estadisticas.visitasRealizadas}</div>
            <p className="text-xs text-muted-foreground hidden md:block">Completadas</p>
          </CardContent>
        </Card>

        <Card className="p-2 md:p-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Conversión</CardTitle>
            <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-2 pt-0 md:p-6 md:pt-0">
            <div className="text-xl md:text-2xl font-bold">{estadisticas.tasaConversion}%</div>
            <p className="text-xs text-muted-foreground hidden md:block">Visitas completadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs de historial */}
      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="text-base md:text-lg">Historial de Asignaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-6 pt-0 md:pt-0">
          <Tabs defaultValue="todas" className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-8 md:h-10">
              <TabsTrigger value="todas" className="text-xs md:text-sm">Todas</TabsTrigger>
              <TabsTrigger value="activas" className="text-xs md:text-sm">Pendientes</TabsTrigger>
              <TabsTrigger value="visitadas" className="text-xs md:text-sm">Visitadas</TabsTrigger>
            </TabsList>

            <TabsContent value="todas" className="mt-3 md:mt-4">
              <ScrollArea className="h-[400px] md:h-[500px] w-full pr-2 md:pr-4">
                {historial.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay asignaciones</p>
                ) : (
                  <div className="space-y-3">
                    {historial.map((asig) => (
                      <Card 
                        key={asig.id} 
                        className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleCardClick(asig)}
                      >
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
                                <p className="text-xs text-muted-foreground line-clamp-2">{asig.feedback.feedback}</p>
                              </div>
                            )}
                            
                            {asig.todos_feedbacks && asig.todos_feedbacks.length > 0 && (
                              <p className="text-xs text-accent flex items-center gap-1">
                                <History className="h-3 w-3" />
                                {asig.todos_feedbacks.length} feedback{asig.todos_feedbacks.length > 1 ? 's' : ''} total{asig.todos_feedbacks.length > 1 ? 'es' : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="activas" className="mt-3 md:mt-4">
              <ScrollArea className="h-[400px] md:h-[500px] w-full pr-2 md:pr-4">
                {historial.filter(h => h.estado === "Asignado" || h.estado === "Por visitar").length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay asignaciones activas</p>
                ) : (
                  <div className="space-y-3">
                    {historial
                      .filter(h => h.estado === "Asignado" || h.estado === "Por visitar")
                      .map((asig) => (
                        <Card 
                          key={asig.id} 
                          className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => handleCardClick(asig)}
                        >
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

            <TabsContent value="visitadas" className="mt-3 md:mt-4">
              <ScrollArea className="h-[400px] md:h-[500px] w-full pr-2 md:pr-4">
                {historial.filter(h => h.estado === "Visitado").length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No hay visitas completadas</p>
                ) : (
                  <div className="space-y-3">
                    {historial
                      .filter(h => h.estado === "Visitado")
                      .map((asig) => (
                        <Card 
                          key={asig.id} 
                          className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => handleCardClick(asig)}
                        >
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
                                  <p className="text-xs text-muted-foreground line-clamp-2">{asig.feedback.feedback}</p>
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

      {/* Dialog de Detalles */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[85vh] overflow-y-auto p-4 md:p-6">
          <DialogHeader>
            <DialogTitle>
              {selectedAsignacion?.es_prospecto 
                ? selectedAsignacion.prospecto_info?.nombre 
                : selectedAsignacion?.cliente_info?.razon_social}
            </DialogTitle>
          </DialogHeader>

          {selectedAsignacion && (
            <div className="space-y-6">
              {/* Información Básica */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Estado:</h3>
                  {getEstadoBadge(selectedAsignacion.estado)}
                </div>

                {!selectedAsignacion.es_prospecto && selectedAsignacion.cliente_info && (
                  <>
                    {selectedAsignacion.cliente_info.barrio_principal && (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Ubicación</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedAsignacion.cliente_info.barrio_principal}, {selectedAsignacion.cliente_info.provincia_principal}
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedAsignacion.cliente_info.telefonos && selectedAsignacion.cliente_info.telefonos.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Phone className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Teléfonos</p>
                          <div className="space-y-1">
                            {selectedAsignacion.cliente_info.telefonos.map((tel, idx) => (
                              <p key={idx} className="text-sm text-muted-foreground">{tel}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedAsignacion.cliente_info.vendedor_principal && (
                      <div>
                        <p className="font-medium">Vendedor Principal</p>
                        <p className="text-sm text-muted-foreground">{selectedAsignacion.cliente_info.vendedor_principal}</p>
                      </div>
                    )}

                    {selectedAsignacion.cliente_info.categoria_volumen && (
                      <div>
                        <p className="font-medium">Categoría Volumen</p>
                        <Badge variant="secondary">{selectedAsignacion.cliente_info.categoria_volumen}</Badge>
                      </div>
                    )}

                    {selectedAsignacion.cliente_info.dias_desde_ultima_compra !== undefined && (
                      <div>
                        <p className="font-medium">Última Compra</p>
                        <p className="text-sm text-muted-foreground">
                          Hace {selectedAsignacion.cliente_info.dias_desde_ultima_compra} días
                        </p>
                      </div>
                    )}
                  </>
                )}

                {selectedAsignacion.es_prospecto && selectedAsignacion.prospecto_info && (
                  <>
                    {selectedAsignacion.prospecto_info.direccion && (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Dirección</p>
                          <p className="text-sm text-muted-foreground">{selectedAsignacion.prospecto_info.direccion}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedAsignacion.prospecto_info.barrio}, {selectedAsignacion.prospecto_info.provincia}
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedAsignacion.prospecto_info.telefono && (
                      <div className="flex items-start gap-2">
                        <Phone className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Teléfono</p>
                          <p className="text-sm text-muted-foreground">{selectedAsignacion.prospecto_info.telefono}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <Separator />

              {/* Historial de Feedbacks */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  <h3 className="font-semibold">Historial de Interacciones ({selectedAsignacion.todos_feedbacks?.length || 0})</h3>
                </div>

                {selectedAsignacion.todos_feedbacks && selectedAsignacion.todos_feedbacks.length > 0 ? (
                  <div className="space-y-3">
                    {selectedAsignacion.todos_feedbacks
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map((fb, idx) => (
                        <Card key={idx} className="p-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">
                                  {fb.tipo_interaccion || "Interacción"}
                                </Badge>
                                {fb.visita_realizada && (
                                  <Badge variant="default" className="text-xs">
                                    Visita Realizada
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(fb.created_at)}
                              </p>
                            </div>

                            <p className="text-sm text-muted-foreground">{fb.feedback}</p>

                            {fb.vendedor && (
                              <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                                <User className="h-3 w-3" />
                                Por: {fb.vendedor.nombre}
                              </p>
                            )}
                          </div>
                        </Card>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay interacciones registradas aún
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendedorDashboard;
