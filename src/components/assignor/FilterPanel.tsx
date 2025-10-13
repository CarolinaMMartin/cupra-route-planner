import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Users } from "lucide-react";

interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

interface FilterPanelProps {
  onRequestRecommendations: (filters: any, selectedVendedores: string[]) => void;
  isLoading: boolean;
}

const FilterPanel = ({ onRequestRecommendations, isLoading }: FilterPanelProps) => {
  const [cantidadVendedores, setCantidadVendedores] = useState('');
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selectedVendedores, setSelectedVendedores] = useState<string[]>([]);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchVendedores();
  }, []);

  const fetchVendedores = async () => {
    setIsLoadingVendedores(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, nombre, email')
        .eq('rol', 'vendedor')
        .eq('activo', true);

      if (error) throw error;

      const mappedVendedores = (data || []).map(v => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email,
      }));

      setVendedores(mappedVendedores);
      // Por defecto, seleccionar todos los vendedores
      setSelectedVendedores(mappedVendedores.map(v => v.id));
    } catch (error) {
      console.error('Error fetching vendedores:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar vendedores",
      });
    } finally {
      setIsLoadingVendedores(false);
    }
  };

  const toggleVendedor = (vendedorId: string) => {
    setSelectedVendedores(prev =>
      prev.includes(vendedorId)
        ? prev.filter(id => id !== vendedorId)
        : [...prev, vendedorId]
    );
  };

  const toggleAllVendedores = () => {
    if (selectedVendedores.length === vendedores.length) {
      setSelectedVendedores([]);
    } else {
      setSelectedVendedores(vendedores.map(v => v.id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedVendedores.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar al menos un vendedor",
      });
      return;
    }

    onRequestRecommendations(
      { cantidad_vendedores: parseInt(cantidadVendedores) || selectedVendedores.length },
      selectedVendedores
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="p-4 bg-muted/50">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-accent" />
              <h3 className="font-semibold">
                Vendedores Disponibles ({selectedVendedores.length} de {vendedores.length})
              </h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleAllVendedores}
              disabled={isLoadingVendedores}
            >
              {selectedVendedores.length === vendedores.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </Button>
          </div>

          {isLoadingVendedores ? (
            <div className="text-sm text-muted-foreground">Cargando vendedores...</div>
          ) : vendedores.length === 0 ? (
            <div className="text-sm text-muted-foreground">No hay vendedores activos disponibles</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {vendedores.map((vendedor) => (
                <div
                  key={vendedor.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-background cursor-pointer hover:bg-accent/5 transition-colors"
                  onClick={() => toggleVendedor(vendedor.id)}
                >
                  <Checkbox
                    checked={selectedVendedores.includes(vendedor.id)}
                    onCheckedChange={() => toggleVendedor(vendedor.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{vendedor.nombre}</p>
                    <p className="text-xs text-muted-foreground truncate">{vendedor.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-2 max-w-md">
        <Label htmlFor="cantidadVendedores">Cantidad de vendedores (para la IA)</Label>
        <Input
          id="cantidadVendedores"
          type="number"
          placeholder={`Ej: ${selectedVendedores.length}`}
          value={cantidadVendedores}
          onChange={(e) => setCantidadVendedores(e.target.value)}
          min="1"
        />
        <p className="text-xs text-muted-foreground">
          Dejar vacío usará la cantidad de vendedores seleccionados ({selectedVendedores.length})
        </p>
      </div>

      <Button
        type="submit"
        className="wine-button w-full md:w-auto"
        disabled={isLoading || selectedVendedores.length === 0}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        {isLoading ? "Generando..." : "Solicitar Recomendaciones IA"}
      </Button>
    </form>
  );
};

export default FilterPanel;