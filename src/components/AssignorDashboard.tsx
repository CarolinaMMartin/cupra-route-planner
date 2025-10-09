import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, MapPin, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FilterPanel from "./assignor/FilterPanel";
import ResultsList from "./assignor/ResultsList";
import ResultsMap from "./assignor/ResultsMap";
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";

const AssignorDashboard = () => {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [recommendations, setRecommendations] = useState<Sucursal[]>([]);
  const [selectedSucursales, setSelectedSucursales] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRequestRecommendations = async (filters: any) => {
    setIsLoading(true);
    try {
      // Llamar al webhook de n8n
      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL;
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cantidad_vendedores: filters.cantidad_vendedores
        }),
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

      // Mapear los datos al formato Sucursal
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
      }));

      setRecommendations(mappedRecommendations);
      toast({
        title: "Recomendaciones generadas",
        description: `Se encontraron ${mappedRecommendations.length} recomendaciones`,
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