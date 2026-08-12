import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, List, Plus, Calendar, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FilterPanel from "./assignor/FilterPanel";
import ResultsMap from "./assignor/ResultsMap";
import PreselectionStep from "./assignor/PreselectionStep";
import TableAssignment from "@/components/assignor/TableAssignment";
import TodayAssignments from "./assignor/TodayAssignments";
import AIInsightsCard from "./assignor/AIInsightsCard";
import AssignmentsSelector from "./assignor/AssignmentsSelector";
import EditAssignmentsTable from "./assignor/EditAssignmentsTable";
import RecommendationProgress from "./assignor/RecommendationProgress";
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";
import { useRecommendationsStore } from "@/hooks/useRecommendationsStore";

type FlowStep = "recommendations" | "preselection" | "assignment" | "edit-select" | "edit-kanban";

const AssignorDashboard = () => {
  const {
    flowStep, setFlowStep,
    recommendations, setRecommendations,
    selectedSucursales, setSelectedSucursales,
    toggleSucursal: toggleSucursalStore,
    toggleAllSucursales: toggleAllSucursalesStore,
    isLoading, setIsLoading,
    aiInsights, setAiInsights,
    vendedoresData, setVendedoresData,
    instruccionesAdicionales, setInstruccionesAdicionales,
    resetToInitial,
  } = useRecommendationsStore();

  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [selectedCiudad, setSelectedCiudad] = useState<string>("all");
  const [selectedProvincia, setSelectedProvincia] = useState<string>("all");
  const [selectedVendedor, setSelectedVendedor] = useState<string>("all");
  const [selectedVendedoresIds, setSelectedVendedoresIds] = useState<string[]>([]);
  const [selectedPlacesComuna, setSelectedPlacesComuna] = useState<string[]>([]);
  const [selectedPlacesBarrio, setSelectedPlacesBarrio] = useState<string[]>([]);
  const [selectedPlacesProvincia, setSelectedPlacesProvincia] = useState<string>("all");
  const [placesData, setPlacesData] = useState<
    Array<{ comuna: string | null; barrio_principal: string | null; provincia_principal: string | null }>
  >([]);
  const [activeTab, setActiveTab] = useState<string>("nueva");
  const { toast } = useToast();

  const getPlaceIdFromUrl = (url: string | null | undefined) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const q = parsed.searchParams.get("q");
      if (q && q.startsWith("place_id:")) return q.replace("place_id:", "");
      const match = url.match(/place_id:([^&]+)/);
      return match ? match[1] : null;
    } catch (err) {
      console.error("URL inválida:", err);
      return null;
    }
  };

  useEffect(() => {
    const loadPlacesData = async () => {
      // Zonas reales: se arman con los lugares de clientes + prospectos
      const [clientRes, prospectRes] = await Promise.all([
        supabase.from("client_places").select("comuna, barrio_principal, provincia_principal").limit(20000),
        supabase.from("prospectos").select("comuna, barrio, provincia").limit(20000),
      ]);

      if (clientRes.error) console.error("Error loading client_places:", clientRes.error);
      if (prospectRes.error) console.error("Error loading prospectos zones:", prospectRes.error);

      const combined = [
        ...(clientRes.data || []).map((p) => ({
          comuna: p.comuna,
          barrio_principal: p.barrio_principal,
          provincia_principal: p.provincia_principal,
        })),
        ...(prospectRes.data || []).map((p) => ({
          comuna: p.comuna,
          barrio_principal: p.barrio,
          provincia_principal: p.provincia,
        })),
      ];

      // Deduplicar combinaciones
      const seen = new Set<string>();
      const unique = combined.filter((p) => {
        const key = `${p.provincia_principal || ""}|${p.comuna || ""}|${p.barrio_principal || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setPlacesData(unique);
    };
    loadPlacesData();
  }, []);


  const [selectedExistingAssignments, setSelectedExistingAssignments] = useState<any[]>([]);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isLoading) {
      setGenerationProgress(0);
      return;
    }

    const startedAt = Date.now();
    setGenerationProgress(4);

    const progressInterval = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const estimatedProgress = 4 + 90 * (1 - Math.exp(-elapsedSeconds / 24));
      setGenerationProgress(Math.min(94, estimatedProgress));
    }, 500);

    return () => window.clearInterval(progressInterval);
  }, [isLoading]);

  const handleCancelRecommendations = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    toast({ title: "Cancelado", description: "Generación de recomendaciones detenida." });
  };

  const handleRequestRecommendations = async (
    filters: any,
    selectedVendedoresData: { ids: string[]; nombres: string[] },
    placesFilters: any,
  ) => {
    setIsLoading(true);
    setSelectedVendedoresIds(selectedVendedoresData.ids);
    setVendedoresData(
      selectedVendedoresData.ids.map((id, idx) => ({
        id,
        nombre: selectedVendedoresData.nombres[idx] || `Vendedor ${id.substring(0, 8)}`,
      })),
    );

    try {


      const payload = {
        vendedores: selectedVendedoresData.ids,
        provincia: placesFilters.provincia !== "all" ? placesFilters.provincia : undefined,
        comuna: placesFilters.comuna,
        barrio: placesFilters.barrio,
        area_id: filters.area_id,
        max_recomendaciones: 8,
        instrucciones_adicionales: instruccionesAdicionales || null,
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || supabaseKey;

      const response = await fetch(`${supabaseUrl}/functions/v1/generate-recommendations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const data = await response.json();
      abortControllerRef.current = null;

      if (!data.recomendaciones || data.recomendaciones.length === 0) {
        toast({ variant: "destructive", title: "Sin recomendaciones", description: data.resumen?.descripcion || "No se encontraron recomendaciones para los filtros seleccionados.", duration: 5000 });
        setIsLoading(false);
        return;
      }

      // Build local vendedor ID→name lookup for fallback
      const vendedorNombrePorId = new Map(
        selectedVendedoresData.ids.map((id, idx) => [id, selectedVendedoresData.nombres[idx] || id]),
      );

      const mappedRecommendations: Sucursal[] = (data.recomendaciones || []).map((rec: any) => {
        // Priority: API name > local lookup by ID > historical vendor name
        const vendedorNombre = rec.vendedor_recomendado_nombre
          || (rec.vendedor_recomendado_id ? vendedorNombrePorId.get(rec.vendedor_recomendado_id) : undefined)
          || rec.vendedor_principal
          || undefined;

        return ({
          id: rec.request_id + "-" + (rec.client_id || rec.prospecto_place_id),
          nombre: rec.razon_social,
          direccion: rec.ciudades?.[0] || "Sin dirección",
          zona: rec.provincias?.[0] || "Sin zona",
          tipo_cliente: rec.score_comercial || "Estándar",
          score: rec.priority_score || 0,
          dias_sin_visita: rec.days_since_last_purchase || 0,
          latitud: rec.lat || null, longitud: rec.long || null,
          justificacion: rec.ai_reasoning, cuit_dni: rec.cuit_dni,
          vendedores: rec.vendedores || [], client_id: rec.client_id,
          es_prospecto: rec.es_prospecto || false,
          prospecto_place_id: rec.prospecto_place_id,
          tipo_negocio: rec.factores_ia?.tipo_negocio, rating: rec.factores_ia?.rating,
          website: rec.factores_ia?.website, fantasia: rec.razon_social,
          primera_compra: rec.first_purchase_at, ultima_compra: rec.last_purchase_at,
          dias_desde_ultima_compra: rec.days_since_last_purchase,
          cantidad_ordenes: rec.orders_count, monto_total_historico: rec.monto_total_vendido,
          ticket_promedio: rec.avg_ticket, categoria_recencia: rec.score_recencia,
          categoria_volumen: rec.score_volumen, score_recencia: rec.score_recencia_num,
          score_volumen: rec.score_volumen_num, score_comercial: rec.priority_score,
          participacion_mercado: rec.participacion,
          ciudad_principa: rec.ciudades?.[0], provincia_principal: rec.provincias?.[0],
          productos_comprados: rec.etiquetas || [], todas_ciudades: rec.ciudades || [],
          todos_vendedores: rec.vendedores || [], etiquetas: rec.etiquetas || [],
          telefonos: rec.telefonos || [], barrio_principal: rec.barrio_principal,
          direccion_principal: rec.direccion_principal,
          google_maps_link: rec.google_maps_link,
          place_id: getPlaceIdFromUrl(rec.google_maps_link),
          ai_reasoning: rec.ai_reasoning, score_geografico: rec.score_geografico,
          factores_ia: rec.factores_ia,
          vendedor_recomendado_id: rec.vendedor_recomendado_id,
          vendedor_actual: vendedorNombre || rec.vendedor_actual,
          estado_cliente: rec.estado_comercial || (rec.es_prospecto ? 'POTENCIAL' : undefined),
        });
      });

      setGenerationProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 350));

      setRecommendations(mappedRecommendations);
      setAiInsights(data.resumen);
      setFlowStep("preselection");
      setSelectedSucursales([]);
      toast({ title: "Recomendaciones generadas", description: data.resumen?.descripcion || `${mappedRecommendations.length} recomendaciones listas` });
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      let errorMessage = "Error al solicitar recomendaciones";
      if (error.message?.includes("429")) errorMessage = "Límite de consultas alcanzado. Reintenta en unos minutos.";
      else if (error.message?.includes("402")) errorMessage = "Créditos agotados.";
      toast({ variant: "destructive", title: "Error", description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueToAssignment = () => setFlowStep("assignment");
  const handleBackToPreselection = () => setFlowStep("preselection");
  const handleBackToRecommendations = () => { setShowExitDialog(false); resetToInitial(); setSelectedCiudad("all"); setSelectedProvincia("all"); setSelectedVendedor("all"); setSelectedVendedoresIds([]); };
  // Guardar y salir: conserva las recomendaciones y la selección (persistidas) para retomarlas luego.
  const handleSaveAndExit = () => {
    setShowExitDialog(false);
    setFlowStep("recommendations");
    toast({ title: "Búsqueda guardada", description: "Podés retomarla desde 'Nueva Asignación'." });
  };
  const handleAssignmentComplete = () => handleBackToRecommendations();

  const handleEditAssignments = () => setFlowStep("edit-select");
  const handleContinueToEditKanban = (assignments: any[]) => { setSelectedExistingAssignments(assignments); setFlowStep("edit-kanban"); };
  const handleBackFromEditKanban = () => setFlowStep("edit-select");
  const handleEditComplete = () => { setFlowStep("recommendations"); setSelectedExistingAssignments([]); toast({ title: "Modificaciones guardadas", description: "Las asignaciones se actualizaron correctamente" }); };

  const filteredRecommendations = useMemo(() => {
    return recommendations.filter((rec: any) => {
      if (selectedCiudad !== "all" && rec.direccion !== selectedCiudad) return false;
      if (selectedProvincia !== "all" && rec.zona !== selectedProvincia) return false;
      if (selectedVendedor !== "all") {
        if (!rec.vendedores || !Array.isArray(rec.vendedores)) return false;
        if (!rec.vendedores.includes(selectedVendedor)) return false;
      }
      if (selectedPlacesProvincia !== "all") {
        if (!rec.zona || rec.zona !== selectedPlacesProvincia) return false;
      }
      if (selectedPlacesBarrio.length > 0) {
        if (!rec.barrio_principal || !selectedPlacesBarrio.includes(rec.barrio_principal)) return false;
      }
      return true;
    });
  }, [recommendations, selectedCiudad, selectedProvincia, selectedVendedor, selectedPlacesProvincia, selectedPlacesBarrio]);

  const selectedRecommendations = filteredRecommendations.filter((r) => selectedSucursales.includes(r.id));

  return (
    <div className="space-y-10">
      {isLoading && (
        <RecommendationProgress progress={generationProgress} onCancel={handleCancelRecommendations} />
      )}

      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir del flujo?</AlertDialogTitle>
            <AlertDialogDescription>Se perderán las recomendaciones y selecciones actuales.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBackToRecommendations}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {flowStep === "recommendations" && (
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-sans text-foreground tracking-tight">Panel de Asignación</h1>
            <p className="text-sm text-muted-foreground mt-2">Recomendaciones inteligentes y gestión de asignaciones</p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full max-w-md">
              <TabsTrigger value="nueva" className="flex-1 gap-2">
                <Plus className="w-4 h-4" />
                Nueva Asignación
              </TabsTrigger>
              <TabsTrigger value="hoy" className="flex-1 gap-2">
                <Calendar className="w-4 h-4" />
                Asignaciones de Hoy
              </TabsTrigger>
            </TabsList>

            <TabsContent value="nueva">
              <Card>
                <CardContent className="p-8">
                  <FilterPanel
                    onRequestRecommendations={handleRequestRecommendations}
                    isLoading={isLoading}
                    onCancel={handleCancelRecommendations}
                    placesData={placesData}
                    instruccionesAdicionales={instruccionesAdicionales}
                    onInstruccionesChange={setInstruccionesAdicionales}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hoy">
              <Card>
                <CardContent className="p-8">
                  <TodayAssignments onEditAssignments={handleEditAssignments} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {flowStep === "edit-select" && (
        <Card>
          <CardHeader>
            <CardTitle className="font-sans text-2xl">Modificar Asignaciones</CardTitle>
            <CardDescription>Selecciona las asignaciones que deseas modificar</CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentsSelector onContinue={handleContinueToEditKanban} onBack={handleBackToRecommendations} />
          </CardContent>
        </Card>
      )}

      {flowStep === "edit-kanban" && (
        <EditAssignmentsTable selectedAssignments={selectedExistingAssignments} onBack={handleBackFromEditKanban} onComplete={handleEditComplete} />
      )}

      {flowStep === "preselection" && recommendations.length > 0 && (
        <div className="space-y-8">
          {aiInsights && vendedoresData.length > 0 && (
            <AIInsightsCard resumen={aiInsights} vendedores={vendedoresData} />
          )}

          <Card>
            <CardHeader className="border-b border-border/60 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="font-sans text-2xl tracking-tight">Preselección</CardTitle>
                  <CardDescription>Selecciona los clientes que deseas asignar</CardDescription>
                </div>
                <div className="flex items-center rounded-md border border-border p-0.5">
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2 px-3"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="w-4 h-4" />
                    Lista
                  </Button>
                  <Button
                    variant={viewMode === "map" ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2 px-3"
                    onClick={() => setViewMode("map")}
                  >
                    <MapPin className="w-4 h-4" />
                    Mapa
                  </Button>
                </div>
              </div>
            </CardHeader>


            <CardContent className="pt-6">
              {viewMode === "list" ? (
                <PreselectionStep recommendations={filteredRecommendations} selectedIds={selectedSucursales} onToggle={toggleSucursalStore} onToggleAll={toggleAllSucursalesStore} onContinue={handleContinueToAssignment} />
              ) : (
                <ResultsMap sucursales={filteredRecommendations} selectedIds={selectedSucursales} onToggle={toggleSucursalStore} onToggleAll={toggleAllSucursalesStore} onContinue={handleContinueToAssignment} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {flowStep === "assignment" && (
        <TableAssignment
          selectedRecommendations={selectedRecommendations}
          selectedVendedoresIds={selectedVendedoresIds}
          onBack={handleBackToPreselection}
          onComplete={handleAssignmentComplete}
        />
      )}
    </div>
  );
};

export default AssignorDashboard;
