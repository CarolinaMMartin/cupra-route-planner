import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, MapPin, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FilterPanel from "./assignor/FilterPanel";
import ResultsList from "./assignor/ResultsList";
import ResultsMap from "./assignor/ResultsMap";
import { Sucursal } from "@/types/sales";

const AssignorDashboard = () => {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [recommendations, setRecommendations] = useState<Sucursal[]>([]);
  const [selectedSucursales, setSelectedSucursales] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRequestRecommendations = async (filters: any) => {
    setIsLoading(true);
    try {
      // TODO: Conectar con endpoint n8n /recomendaciones
      const mockRecommendations: Sucursal[] = [
        {
          id: '1',
          nombre: 'Vinoteca El Parral',
          direccion: 'Av. Corrientes 1234, CABA',
          zona: 'Capital Federal',
          tipo_cliente: 'Premium',
          score: 85,
          dias_sin_visita: 45,
          latitud: -34.603722,
          longitud: -58.381592,
          justificacion: 'Cliente premium sin visita en 45 días, alta probabilidad de pedido',
        },
        {
          id: '2',
          nombre: 'Bodegón San Telmo',
          direccion: 'Defensa 890, CABA',
          zona: 'Capital Federal',
          tipo_cliente: 'Estándar',
          score: 72,
          dias_sin_visita: 30,
          latitud: -34.621850,
          longitud: -58.373450,
          justificacion: 'Zona estratégica, rotación media de productos',
        },
      ];

      setRecommendations(mockRecommendations);
      toast({
        title: "Recomendaciones generadas",
        description: `Se encontraron ${mockRecommendations.length} sucursales`,
      });
    } catch (error) {
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

  return (
    <div className="space-y-6">
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-accent" />
            Panel de Asignación
          </CardTitle>
          <CardDescription>
            Filtra sucursales y solicita recomendaciones inteligentes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FilterPanel onRequestRecommendations={handleRequestRecommendations} isLoading={isLoading} />
        </CardContent>
      </Card>

      {recommendations.length > 0 && (
        <Card className="shadow-medium">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Resultados ({recommendations.length})</CardTitle>
              <div className="flex gap-2">
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
          <CardContent>
            {viewMode === 'list' ? (
              <ResultsList
                sucursales={recommendations}
                selectedIds={selectedSucursales}
                onToggle={toggleSucursal}
              />
            ) : (
              <ResultsMap
                sucursales={recommendations}
                selectedIds={selectedSucursales}
                onToggle={toggleSucursal}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AssignorDashboard;