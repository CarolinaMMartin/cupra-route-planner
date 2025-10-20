import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Users, MapPin, Trash2 } from "lucide-react";
interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}
interface VendedorBarrio {
  vendedorId: string;
  barrios: string[];
}

interface FilterPanelProps {
  onRequestRecommendations: (filters: any, selectedVendedoresData: { ids: string[], nombres: string[] }, placesFilters: any, vendedorBarrios: VendedorBarrio[]) => void;
  isLoading: boolean;
  placesData: Array<{ comuna: string | null, barrio_principal: string | null, provincia_principal: string | null }>;
}
const FilterPanel = ({
  onRequestRecommendations,
  isLoading,
  placesData
}: FilterPanelProps) => {
  const [cantidadVendedores, setCantidadVendedores] = useState('');
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selectedVendedores, setSelectedVendedores] = useState<string[]>([]);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(true);
  const [selectedComuna, setSelectedComuna] = useState<string>('all');
  const [selectedBarrio, setSelectedBarrio] = useState<string>('all');
  const [selectedProvincia, setSelectedProvincia] = useState<string>('CABA');
  const [vendedorBarrios, setVendedorBarrios] = useState<VendedorBarrio[]>([]);
  const {
    toast
  } = useToast();

  // Obtener provincias únicas ordenadas alfabéticamente
  const provincias = useMemo(() => {
    const set = new Set<string>();
    placesData.forEach(place => {
      if (place.provincia_principal) set.add(place.provincia_principal);
    });
    return Array.from(set).sort();
  }, [placesData]);

  // Obtener comunas filtradas por provincia y ordenadas alfabéticamente
  const comunas = useMemo(() => {
    const filtered = placesData.filter(place => 
      selectedProvincia === 'all' || place.provincia_principal === selectedProvincia
    );
    const set = new Set<string>();
    filtered.forEach(place => {
      if (place.comuna) set.add(place.comuna);
    });
    return Array.from(set).sort();
  }, [placesData, selectedProvincia]);

  // Obtener barrios filtrados por provincia y comuna, ordenados alfabéticamente
  const barrios = useMemo(() => {
    const filtered = placesData.filter(place => 
      (selectedProvincia === 'all' || place.provincia_principal === selectedProvincia) &&
      (selectedComuna === 'all' || place.comuna === selectedComuna)
    );
    const set = new Set<string>();
    filtered.forEach(place => {
      if (place.barrio_principal) set.add(place.barrio_principal);
    });
    return Array.from(set).sort();
  }, [placesData, selectedProvincia, selectedComuna]);

  // Resetear filtros dependientes cuando cambia la provincia
  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedComuna('all');
    setSelectedBarrio('all');
  };

  // Resetear barrio cuando cambia la comuna
  const handleComunaChange = (value: string) => {
    setSelectedComuna(value);
    setSelectedBarrio('all');
  };
  useEffect(() => {
    fetchVendedores();
  }, []);
  const fetchVendedores = async () => {
    setIsLoadingVendedores(true);
    try {
      const {
        data,
        error
      } = await supabase.from('profiles').select('user_id, nombre, email').eq('rol', 'vendedor').eq('activo', true);
      if (error) throw error;
      const mappedVendedores = (data || []).map(v => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email
      }));
      setVendedores(mappedVendedores);
      // Por defecto, seleccionar todos los vendedores
      setSelectedVendedores(mappedVendedores.map(v => v.id));
    } catch (error) {
      console.error('Error fetching vendedores:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar vendedores"
      });
    } finally {
      setIsLoadingVendedores(false);
    }
  };
  const toggleVendedor = (vendedorId: string) => {
    setSelectedVendedores(prev => prev.includes(vendedorId) ? prev.filter(id => id !== vendedorId) : [...prev, vendedorId]);
  };
  const toggleAllVendedores = () => {
    if (selectedVendedores.length === vendedores.length) {
      setSelectedVendedores([]);
    } else {
      setSelectedVendedores(vendedores.map(v => v.id));
    }
  };
  const addVendedorBarrio = () => {
    setVendedorBarrios([...vendedorBarrios, { vendedorId: '', barrios: [] }]);
  };

  const removeVendedorBarrio = (index: number) => {
    setVendedorBarrios(vendedorBarrios.filter((_, i) => i !== index));
  };

  const updateVendedorBarrioVendedor = (index: number, vendedorId: string) => {
    const updated = [...vendedorBarrios];
    updated[index].vendedorId = vendedorId;
    setVendedorBarrios(updated);
  };

  const updateVendedorBarrioBarrios = (index: number, barrio: string) => {
    const updated = [...vendedorBarrios];
    if (updated[index].barrios.includes(barrio)) {
      updated[index].barrios = updated[index].barrios.filter(b => b !== barrio);
    } else {
      updated[index].barrios.push(barrio);
    }
    setVendedorBarrios(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedProvincia === 'all') {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar una provincia"
      });
      return;
    }

    if (selectedVendedores.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar al menos un vendedor"
      });
      return;
    }
    
    // Obtener nombres de los vendedores seleccionados
    const nombresVendedores = vendedores
      .filter(v => selectedVendedores.includes(v.id))
      .map(v => v.nombre);
    
    onRequestRecommendations({
      cantidad_vendedores: parseInt(cantidadVendedores) || selectedVendedores.length
    }, {
      ids: selectedVendedores,
      nombres: nombresVendedores
    }, {
      comuna: selectedComuna !== 'all' ? selectedComuna : null,
      barrio: selectedBarrio !== 'all' ? selectedBarrio : null,
      provincia: selectedProvincia !== 'all' ? selectedProvincia : null
    }, vendedorBarrios);
  };
  return <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="p-4 bg-muted/50">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-accent" />
              <h3 className="font-semibold">
                Vendedores Disponibles ({selectedVendedores.length} de {vendedores.length})
              </h3>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={toggleAllVendedores} disabled={isLoadingVendedores}>
              {selectedVendedores.length === vendedores.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </Button>
          </div>

          {isLoadingVendedores ? <div className="text-sm text-muted-foreground">Cargando vendedores...</div> : vendedores.length === 0 ? <div className="text-sm text-muted-foreground">No hay vendedores activos disponibles</div> : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {vendedores.map(vendedor => <label key={vendedor.id} className="flex items-start gap-3 p-3 rounded-lg border bg-background cursor-pointer hover:bg-accent/5 transition-colors">
                  <Checkbox checked={selectedVendedores.includes(vendedor.id)} onCheckedChange={() => toggleVendedor(vendedor.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{vendedor.nombre}</p>
                    <p className="text-xs text-muted-foreground truncate">{vendedor.email}</p>
                  </div>
                </label>)}
            </div>}
        </div>
      </Card>

      <Card className="p-4 bg-muted/50">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-accent" />
            <h3 className="font-semibold">Filtros de Ubicación</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provincia-filter">Provincia <span className="text-destructive">*</span></Label>
              <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                <SelectTrigger id="provincia-filter" className="bg-background">
                  <SelectValue placeholder="Selecciona una provincia" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {provincias.map((provincia) => (
                    <SelectItem key={provincia} value={provincia}>
                      {provincia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comuna-filter">Comuna / Distrito</Label>
              <Select value={selectedComuna} onValueChange={handleComunaChange}>
                <SelectTrigger id="comuna-filter" className="bg-background">
                  <SelectValue placeholder="Todas las comunas" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todas las comunas</SelectItem>
                  {comunas.map((comuna) => (
                    <SelectItem key={comuna} value={comuna}>
                      {comuna}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="barrio-filter">Barrio</Label>
              <Select value={selectedBarrio} onValueChange={setSelectedBarrio}>
                <SelectTrigger id="barrio-filter" className="bg-background">
                  <SelectValue placeholder="Todos los barrios" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todos los barrios</SelectItem>
                  {barrios.map((barrio) => (
                    <SelectItem key={barrio} value={barrio}>
                      {barrio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {selectedProvincia !== 'all' && barrios.length > 0 && (
        <Card className="p-4 bg-muted/50">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-accent" />
                <h3 className="font-semibold">Asignación de Vendedor por Barrio</h3>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addVendedorBarrio}>
                Agregar asignación
              </Button>
            </div>

            {vendedorBarrios.map((vb, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3 bg-background">
                <div className="flex items-center justify-between">
                  <Label>Asignación #{index + 1}</Label>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => removeVendedorBarrio(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="space-y-2">
                  <Label>Vendedor</Label>
                  <Select 
                    value={vb.vendedorId} 
                    onValueChange={(value) => updateVendedorBarrioVendedor(index, value)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Selecciona un vendedor" />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {vendedores
                        .filter(v => selectedVendedores.includes(v.id))
                        .map((vendedor) => (
                          <SelectItem key={vendedor.id} value={vendedor.id}>
                            {vendedor.nombre}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Barrios asignados</Label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded">
                    {barrios.map((barrio) => (
                      <label key={barrio} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/5 p-1 rounded">
                        <Checkbox
                          checked={vb.barrios.includes(barrio)}
                          onCheckedChange={() => updateVendedorBarrioBarrios(index, barrio)}
                        />
                        <span>{barrio}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {vendedorBarrios.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                No hay asignaciones configuradas. Haz clic en "Agregar asignación" para comenzar.
              </div>
            )}
          </div>
        </Card>
      )}

      <Button 
        type="submit" 
        className="wine-button w-full md:w-auto" 
        disabled={isLoading || selectedVendedores.length === 0 || selectedProvincia === 'all'}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        {isLoading ? "Generando..." : "Solicitar Recomendaciones IA"}
      </Button>
    </form>;
};
export default FilterPanel;