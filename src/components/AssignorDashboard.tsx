import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FilterPanel from "./assignor/FilterPanel";
import ResultsList from "./assignor/ResultsList";
import ResultsMap from "./assignor/ResultsMap";
import PreselectionStep from "./assignor/PreselectionStep";
import KanbanAssignment from "./assignor/KanbanAssignment";
import RecommendationFilters from "./assignor/RecommendationFilters";
import TodayAssignments from "./assignor/TodayAssignments";
import AIInsightsCard from "./assignor/AIInsightsCard";
import AdditionalInstructionsCard from "./assignor/AdditionalInstructionsCard";
import AssignmentsSelector from "./assignor/AssignmentsSelector";
import EditAssignmentsKanban from "./assignor/EditAssignmentsKanban";
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";

type FlowStep = "recommendations" | "preselection" | "assignment" | "edit-select" | "edit-kanban";

const AssignorDashboard = () => {
  const [flowStep, setFlowStep] = useState<FlowStep>("recommendations");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [recommendations, setRecommendations] = useState<Sucursal[]>([]);
  const [selectedSucursales, setSelectedSucursales] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
  const { toast } = useToast();

  // Cargar datos de places al montar el componente
  useEffect(() => {
    const loadPlacesData = async () => {
      const { data, error } = await supabase.from("places").select("comuna, barrio_principal, provincia_principal");

      if (error) {
        console.error("Error loading places:", error);
        return;
      }

      setPlacesData(data || []);
    };

    loadPlacesData();
  }, []);

  const [aiInsights, setAiInsights] = useState<any>(null);
  const [vendedoresData, setVendedoresData] = useState<Array<{ id: string; nombre: string }>>([]);
  const [selectedExistingAssignments, setSelectedExistingAssignments] = useState<any[]>([]);
  const [instruccionesAdicionales, setInstruccionesAdicionales] = useState<string>("");

  const handleRequestRecommendations = async (
    filters: any,
    selectedVendedoresData: { ids: string[]; nombres: string[] },
    placesFilters: any,
  ) => {
    setIsLoading(true);
    setSelectedVendedoresIds(selectedVendedoresData.ids);

    // Guardar datos de vendedores para el insights card
    setVendedoresData(
      selectedVendedoresData.ids.map((id, idx) => ({
        id,
        nombre: selectedVendedoresData.nombres[idx] || `Vendedor ${id.substring(0, 8)}`,
      })),
    );

    try {
      toast({
        title: "🤖 Analizando con IA...",
        description: "Estamos generando recomendaciones inteligentes. Esto puede tomar unos segundos.",
      });

      const payload = {
        vendedores: selectedVendedoresData.ids,
        provincia: placesFilters.provincia !== "all" ? placesFilters.provincia : undefined,
        comuna: placesFilters.comuna,
        barrio: placesFilters.barrio,
        area_id: filters.area_id,
        max_recomendaciones: 8,
        instrucciones_adicionales: instruccionesAdicionales || null,
      };

      console.log("Payload enviado a Supabase:", JSON.stringify(payload, null, 2));

      // Llamar al edge function de Lovable AI
      const { data, error } = await supabase.functions.invoke("generate-recommendations", {
        body: payload,
      });

      // const { data, error } = await supabase.functions.invoke('generate-recommendations', {
      //   body: {
      //     vendedores: selectedVendedoresData.ids,
      //     provincia: placesFilters.provincia !== 'all' ? placesFilters.provincia : undefined,
      //     comuna: placesFilters.comuna,
      //     barrio: placesFilters.barrio,
      //     area_id: filters.area_id,
      //     max_recomendaciones: 8,
      //     instrucciones_adicionales: instruccionesAdicionales || null
      //   }
      // });

      if (error) {
        console.error("Error from edge function:", error);
        throw error;
      }

      console.log("✅✅ Respuesta del edge function:", data);

      // Verificar si no hay recomendaciones
      if (!data.recomendaciones || data.recomendaciones.length === 0) {
        toast({
          variant: "destructive",
          title: "❌ Sin recomendaciones",
          description:
            data.resumen?.descripcion ||
            "No se encontraron recomendaciones para los filtros seleccionados. Intenta con otros criterios.",
          duration: 5000,
        });
        setIsLoading(false);
        return;
      }

      // Mapear los datos al formato Sucursal
      const mappedRecommendations: Sucursal[] = (data.recomendaciones || []).map((rec: any) => ({
        id: rec.request_id + "-" + (rec.client_id || rec.prospecto_place_id), // ID único combinado
        nombre: rec.razon_social,
        direccion: rec.ciudades?.[0] || "Sin dirección",
        zona: rec.provincias?.[0] || "Sin zona",
        tipo_cliente: rec.score_comercial || "Estándar",
        score: rec.priority_score || 0,
        dias_sin_visita: rec.days_since_last_purchase || 0,
        latitud: 0,
        longitud: 0,
        justificacion: rec.ai_reasoning,
        cuit_dni: rec.cuit_dni,
        vendedores: rec.vendedores || [],
        client_id: rec.client_id,

        // Campos específicos de prospectos
        es_prospecto: rec.es_prospecto || false,
        prospecto_place_id: rec.prospecto_place_id,
        tipo_negocio: rec.factores_ia?.tipo_negocio,
        rating: rec.factores_ia?.rating,
        website: rec.factores_ia?.website,

        // Campos completos de clientes
        fantasia: rec.razon_social,
        primera_compra: rec.first_purchase_at,
        ultima_compra: rec.last_purchase_at,
        dias_desde_ultima_compra: rec.days_since_last_purchase,
        cantidad_ordenes: rec.orders_count,
        monto_total_historico: rec.monto_total_vendido,
        ticket_promedio: rec.avg_ticket,
        categoria_recencia: rec.score_recencia,
        categoria_volumen: rec.score_volumen,
        score_recencia: rec.score_recencia_num,
        score_volumen: rec.score_volumen_num,
        score_comercial: rec.priority_score,
        participacion_mercado: rec.participacion,
        ciudad_principa: rec.ciudades?.[0],
        provincia_principal: rec.provincias?.[0],
        productos_comprados: rec.etiquetas || [],
        todas_ciudades: rec.ciudades || [],
        todos_vendedores: rec.vendedores || [],
        etiquetas: rec.etiquetas || [],
        telefonos: rec.telefonos || [],
        barrio_principal: rec.barrio_principal,
        direccion_principal: rec.direccion_principal,
        google_maps_link: rec.google_maps_link,

        // Campos de IA
        ai_reasoning: rec.ai_reasoning,
        score_geografico: rec.score_geografico,
        factores_ia: rec.factores_ia,
      }));

      setRecommendations(mappedRecommendations);
      setAiInsights(data.resumen);
      setFlowStep("preselection");
      setSelectedSucursales([]);

      toast({
        title: "✨ Recomendaciones generadas por IA",
        description: data.resumen?.descripcion || `Se generaron ${mappedRecommendations.length} recomendaciones`,
      });
    } catch (error: any) {
      console.error("Error:", error);

      let errorMessage = "Error al solicitar recomendaciones";

      if (error.message?.includes("429")) {
        errorMessage = "Límite de consultas IA alcanzado. Reintenta en unos minutos.";
      } else if (error.message?.includes("402")) {
        errorMessage = "Créditos de IA agotados. Agrega créditos en Settings → Usage.";
      }

      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSucursal = (id: string) => {
    setSelectedSucursales((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const toggleAllSucursales = () => {
    if (selectedSucursales.length === recommendations.length) {
      setSelectedSucursales([]);
    } else {
      setSelectedSucursales(recommendations.map((r) => r.id));
    }
  };

  const handleContinueToAssignment = () => {
    setFlowStep("assignment");
  };

  const handleBackToPreselection = () => {
    setFlowStep("preselection");
  };

  const handleBackToRecommendations = () => {
    setFlowStep("recommendations");
    setRecommendations([]);
    setSelectedSucursales([]);
    setSelectedCiudad("all");
    setSelectedProvincia("all");
    setSelectedVendedor("all");
    setSelectedVendedoresIds([]);
  };

  const handleAssignmentComplete = () => {
    handleBackToRecommendations();
  };

  const handleEditAssignments = () => {
    setFlowStep("edit-select");
  };

  const handleContinueToEditKanban = (assignments: any[]) => {
    setSelectedExistingAssignments(assignments);
    setFlowStep("edit-kanban");
  };

  const handleBackFromEditKanban = () => {
    setFlowStep("edit-select");
  };

  const handleEditComplete = () => {
    setFlowStep("recommendations");
    setSelectedExistingAssignments([]);
    toast({
      title: "Modificaciones guardadas",
      description: "Las asignaciones se han actualizado correctamente",
    });
  };

  const handleClearFilters = () => {
    setSelectedCiudad("all");
    setSelectedProvincia("all");
    setSelectedVendedor("all");
    setSelectedPlacesComuna([]);
    setSelectedPlacesBarrio([]);
    setSelectedPlacesProvincia("all");
  };

  // Obtener opciones únicas para los filtros
  const { ciudades, provincias, vendedores } = useMemo(() => {
    const ciudadesSet = new Set<string>();
    const provinciasSet = new Set<string>();
    const vendedoresSet = new Set<string>();

    recommendations.forEach((rec: any) => {
      if (rec.direccion && rec.direccion !== "Sin dirección") {
        ciudadesSet.add(rec.direccion);
      }
      if (rec.zona && rec.zona !== "Sin zona") {
        provinciasSet.add(rec.zona);
      }
      if (rec.vendedores && Array.isArray(rec.vendedores)) {
        rec.vendedores.forEach((v: string) => {
          if (v) vendedoresSet.add(v);
        });
      }
    });

    return {
      ciudades: Array.from(ciudadesSet).sort(),
      provincias: Array.from(provinciasSet).sort(),
      vendedores: Array.from(vendedoresSet).sort(),
    };
  }, [recommendations]);

  // Aplicar filtros a las recomendaciones
  const filteredRecommendations = useMemo(() => {
    return recommendations.filter((rec: any) => {
      // Filtros de recomendaciones originales
      if (selectedCiudad !== "all" && rec.direccion !== selectedCiudad) {
        return false;
      }
      if (selectedProvincia !== "all" && rec.zona !== selectedProvincia) {
        return false;
      }
      if (selectedVendedor !== "all") {
        if (!rec.vendedores || !Array.isArray(rec.vendedores)) {
          return false;
        }
        if (!rec.vendedores.includes(selectedVendedor)) {
          return false;
        }
      }

      // Filtros de Places
      if (selectedPlacesProvincia !== "all") {
        if (!rec.zona || rec.zona !== selectedPlacesProvincia) {
          return false;
        }
      }

      if (selectedPlacesComuna.length > 0) {
        // El campo comuna no está directamente en recomendaciones
        // Este filtro será más efectivo cuando se integre con places
        return true;
      }

      if (selectedPlacesBarrio.length > 0) {
        if (!rec.barrio_principal || !selectedPlacesBarrio.includes(rec.barrio_principal)) {
          return false;
        }
      }

      return true;
    });
  }, [recommendations, selectedCiudad, selectedProvincia, selectedVendedor, selectedPlacesProvincia]);

  const selectedRecommendations = filteredRecommendations.filter((r) => selectedSucursales.includes(r.id));

  return (
    <div className="space-y-6">
      {flowStep === "recommendations" && (
        <>
          <Card className="shadow-medium">
            <CardHeader>
              <CardTitle className="font-serif tracking-wide">Panel de Asignación</CardTitle>
              <CardDescription>
                Selecciona un área o aplica filtros para solicitar recomendaciones inteligentes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FilterPanel
                onRequestRecommendations={handleRequestRecommendations}
                isLoading={isLoading}
                placesData={placesData}
                instruccionesAdicionales={instruccionesAdicionales}
                onInstruccionesChange={setInstruccionesAdicionales}
              />
            </CardContent>
          </Card>

          <TodayAssignments onEditAssignments={handleEditAssignments} />
        </>
      )}

      {flowStep === "edit-select" && (
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle>Modificar Asignaciones Existentes</CardTitle>
            <CardDescription>Selecciona las asignaciones que deseas modificar</CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentsSelector onContinue={handleContinueToEditKanban} onBack={handleBackToRecommendations} />
          </CardContent>
        </Card>
      )}

      {flowStep === "edit-kanban" && (
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle>Reasignar Clientes</CardTitle>
            <CardDescription>Arrastra los clientes entre vendedores para modificar asignaciones</CardDescription>
          </CardHeader>
          <CardContent>
            <EditAssignmentsKanban
              selectedAssignments={selectedExistingAssignments}
              onBack={handleBackFromEditKanban}
              onComplete={handleEditComplete}
            />
          </CardContent>
        </Card>
      )}

      {flowStep === "preselection" && recommendations.length > 0 && (
        <>
          {aiInsights && vendedoresData.length > 0 && (
            <AIInsightsCard resumen={aiInsights} vendedores={vendedoresData} />
          )}

          <Card className="shadow-medium">
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Paso 1: Preselección de Recomendaciones</CardTitle>
                  <CardDescription>Selecciona los clientes que deseas asignar</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={handleBackToRecommendations} className="mr-auto">
                    ← Volver al Panel Principal
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="w-4 h-4 mr-2" />
                    Lista
                  </Button>
                  <Button
                    variant={viewMode === "map" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("map")}
                  >
                    <MapPin className="w-4 h-4 mr-2" />
                    Mapa
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {viewMode === "list" ? (
                <PreselectionStep
                  recommendations={filteredRecommendations}
                  selectedIds={selectedSucursales}
                  onToggle={toggleSucursal}
                  onToggleAll={toggleAllSucursales}
                  onContinue={handleContinueToAssignment}
                />
              ) : (
                <ResultsMap
                  sucursales={filteredRecommendations}
                  selectedIds={selectedSucursales}
                  onToggle={toggleSucursal}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {flowStep === "assignment" && (
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle>Paso 2: Asignación Visual</CardTitle>
            <CardDescription>
              Arrastra los clientes desde "Sin asignar" hacia el vendedor correspondiente
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KanbanAssignment
              selectedRecommendations={selectedRecommendations}
              selectedVendedoresIds={selectedVendedoresIds}
              onBack={handleBackToPreselection}
              onComplete={handleAssignmentComplete}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AssignorDashboard;
