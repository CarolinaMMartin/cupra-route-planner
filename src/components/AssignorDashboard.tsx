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
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";

type FlowStep = 'recommendations' | 'preselection' | 'assignment';

const AssignorDashboard = () => {
  const [flowStep, setFlowStep] = useState<FlowStep>('recommendations');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [recommendations, setRecommendations] = useState<Sucursal[]>([]);
  const [selectedSucursales, setSelectedSucursales] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCiudad, setSelectedCiudad] = useState<string>('all');
  const [selectedProvincia, setSelectedProvincia] = useState<string>('all');
  const [selectedVendedor, setSelectedVendedor] = useState<string>('all');
  const [selectedVendedoresIds, setSelectedVendedoresIds] = useState<string[]>([]);
  const [selectedPlacesComuna, setSelectedPlacesComuna] = useState<string>('all');
  const [selectedPlacesBarrio, setSelectedPlacesBarrio] = useState<string>('all');
  const [selectedPlacesProvincia, setSelectedPlacesProvincia] = useState<string>('all');
  const [placesData, setPlacesData] = useState<Array<{ comuna: string | null, barrio_principal: string | null, provincia_principal: string | null }>>([]);
  const [vendedorBarrios, setVendedorBarrios] = useState<Array<{ vendedorId: string; barrios: string[] }>>([]);
  const { toast } = useToast();

  // Cargar datos de places al montar el componente
  useEffect(() => {
    const loadPlacesData = async () => {
      const { data, error } = await supabase
        .from('places')
        .select('comuna, barrio_principal, provincia_principal');

      if (error) {
        console.error('Error loading places:', error);
        return;
      }

      setPlacesData(data || []);
    };

    loadPlacesData();
  }, []);

  const handleRequestRecommendations = async (
    filters: any, 
    selectedVendedoresData: { ids: string[], nombres: string[] }, 
    placesFilters: any,
    vendedorBarrios: Array<{ vendedorId: string; barrios: string[] }>
  ) => {
    setIsLoading(true);
    setSelectedVendedoresIds(selectedVendedoresData.ids);
    setVendedorBarrios(vendedorBarrios);
    
    try {
      // Llamar al webhook de n8n
      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL;
      const payload = {
        cantidad_vendedores: filters.cantidad_vendedores,
        nombres_vendedores: selectedVendedoresData.nombres,
        provincia: placesFilters.provincia,
        comuna: placesFilters.comuna,
        barrio: placesFilters.barrio
      };
      
      console.log('Enviando al webhook:', payload);
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Error al llamar al webhook');
      }

      // Esperar un momento para que n8n procese y guarde en la tabla
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Obtener las recomendaciones de la tabla recomendaciones_ia
      const { data, error } = await supabase
        .from('recomendaciones_ia')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Mapear los datos al formato Sucursal con TODOS los campos de clientes
      const mappedRecommendations: Sucursal[] = (data || []).map((rec: any) => ({
        id: rec.id,
        nombre: rec.razon_social,
        direccion: rec.ciudades?.[0] || 'Sin dirección',
        zona: rec.provincias?.[0] || 'Sin zona',
        tipo_cliente: rec.score_comercial || 'Estándar',
        score: rec.priority_score || 0,
        dias_sin_visita: rec.days_since_last_purchase || 0,
        latitud: 0,
        longitud: 0,
        justificacion: rec.justificacion,
        cuit_dni: rec.cuit_dni,
        vendedores: rec.vendedores || [],
        client_id: rec.client_id,
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
      }));

      setRecommendations(mappedRecommendations);
      setFlowStep('preselection');
      setSelectedSucursales([]);
      toast({
        title: "Recomendaciones generadas",
        description: `Se encontraron ${mappedRecommendations.length} recomendaciones para ${selectedVendedoresIds.length} vendedores`,
      });
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al solicitar recomendaciones",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSucursal = (id: string) => {
    setSelectedSucursales(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleAllSucursales = () => {
    if (selectedSucursales.length === recommendations.length) {
      setSelectedSucursales([]);
    } else {
      setSelectedSucursales(recommendations.map(r => r.id));
    }
  };

  const handleContinueToAssignment = () => {
    setFlowStep('assignment');
  };

  const handleBackToPreselection = () => {
    setFlowStep('preselection');
  };

  const handleBackToRecommendations = () => {
    setFlowStep('recommendations');
    setRecommendations([]);
    setSelectedSucursales([]);
    setSelectedCiudad('all');
    setSelectedProvincia('all');
    setSelectedVendedor('all');
    setSelectedVendedoresIds([]);
  };

  const handleAssignmentComplete = () => {
    handleBackToRecommendations();
  };

  const handleClearFilters = () => {
    setSelectedCiudad('all');
    setSelectedProvincia('all');
    setSelectedVendedor('all');
    setSelectedPlacesComuna('all');
    setSelectedPlacesBarrio('all');
    setSelectedPlacesProvincia('all');
  };

  // Obtener opciones únicas para los filtros
  const { ciudades, provincias, vendedores } = useMemo(() => {
    const ciudadesSet = new Set<string>();
    const provinciasSet = new Set<string>();
    const vendedoresSet = new Set<string>();

    recommendations.forEach((rec: any) => {
      if (rec.direccion && rec.direccion !== 'Sin dirección') {
        ciudadesSet.add(rec.direccion);
      }
      if (rec.zona && rec.zona !== 'Sin zona') {
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
      if (selectedCiudad !== 'all' && rec.direccion !== selectedCiudad) {
        return false;
      }
      if (selectedProvincia !== 'all' && rec.zona !== selectedProvincia) {
        return false;
      }
      if (selectedVendedor !== 'all') {
        if (!rec.vendedores || !Array.isArray(rec.vendedores)) {
          return false;
        }
        if (!rec.vendedores.includes(selectedVendedor)) {
          return false;
        }
      }
      
      // Filtros de Places
      if (selectedPlacesProvincia !== 'all') {
        if (!rec.zona || rec.zona !== selectedPlacesProvincia) {
          return false;
        }
      }
      
      // Nota: Los filtros de comuna y barrio no se pueden aplicar directamente
      // porque las recomendaciones no tienen esos campos
      // Se mantienen para consistencia de UI pero no afectan el filtrado por ahora
      
      return true;
    });
  }, [recommendations, selectedCiudad, selectedProvincia, selectedVendedor, selectedPlacesProvincia]);

  const selectedRecommendations = filteredRecommendations.filter(r => 
    selectedSucursales.includes(r.id)
  );

  return (
    <div className="space-y-6">
      {flowStep === 'recommendations' && (
        <>
          <Card className="shadow-medium">
            <CardHeader>
              <CardTitle className="font-serif tracking-wide">
                Panel de Asignación
              </CardTitle>
              <CardDescription>
                Filtra sucursales y solicita recomendaciones inteligentes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FilterPanel 
                onRequestRecommendations={handleRequestRecommendations} 
                isLoading={isLoading}
                placesData={placesData}
              />
            </CardContent>
          </Card>
          
          <TodayAssignments />
        </>
      )}

      {flowStep === 'preselection' && recommendations.length > 0 && (
        <Card className="shadow-medium">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Paso 1: Preselección de Recomendaciones</CardTitle>
                <CardDescription>Selecciona los clientes que deseas asignar</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBackToRecommendations}
                >
                  Nueva búsqueda
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  <List className="w-4 h-4 mr-2" />
                  Lista
                </Button>
                <Button
                  variant={viewMode === 'map' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('map')}
                >
                  <MapPin className="w-4 h-4 mr-2" />
                  Mapa
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {viewMode === 'list' ? (
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
      )}

      {flowStep === 'assignment' && (
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
              vendedorBarrios={vendedorBarrios}
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