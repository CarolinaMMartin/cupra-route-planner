import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Users, MapPin, X } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

interface Area {
  id: string;
  nombre: string;
  vendedores: string[];
  barrios: string[];
}

interface FilterPanelProps {
  onRequestRecommendations: (filters: any, selectedVendedoresData: { ids: string[], nombres: string[] }, placesFilters: any, instruccionesAdicionales?: string) => void;
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
  const [selectedComuna, setSelectedComuna] = useState<string[]>([]);
  const [selectedBarrio, setSelectedBarrio] = useState<string[]>([]);
  const [selectedProvincia, setSelectedProvincia] = useState<string>('all');
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedArea, setSelectedArea] = useState<string>('none');
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [instruccionesAdicionales, setInstruccionesAdicionales] = useState<string>('');
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
    return Array.from(set).sort().map(c => ({ label: c, value: c }));
  }, [placesData, selectedProvincia]);

  // Obtener barrios filtrados por provincia y comuna, ordenados alfabéticamente
  const barrios = useMemo(() => {
    const filtered = placesData.filter(place => 
      (selectedProvincia === 'all' || place.provincia_principal === selectedProvincia) &&
      (selectedComuna.length === 0 || selectedComuna.includes(place.comuna || ''))
    );
    const set = new Set<string>();
    filtered.forEach(place => {
      if (place.barrio_principal) set.add(place.barrio_principal);
    });
    return Array.from(set).sort().map(b => ({ label: b, value: b }));
  }, [placesData, selectedProvincia, selectedComuna]);

  // Resetear filtros dependientes cuando cambia la provincia
  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedComuna([]);
    setSelectedBarrio([]);
  };

  const handleAreaChange = async (areaId: string) => {
    setSelectedArea(areaId);
    
    if (areaId === 'none') {
      // Limpiar selecciones
      setSelectedVendedores(vendedores.map(v => v.id));
      setSelectedBarrio([]);
      return;
    }

    const area = areas.find(a => a.id === areaId);
    if (!area) return;

    // Llenar automáticamente los filtros con el contenido del área
    setSelectedVendedores(area.vendedores);
    setSelectedBarrio(area.barrios);
    
    toast({
      title: "⏳ Generando recomendaciones...",
      description: `Área "${area.nombre}" cargada. La IA está analizando ${area.barrios.length} barrios...`
    });

    // Obtener nombres de los vendedores seleccionados
    const nombresVendedores = vendedores
      .filter(v => area.vendedores.includes(v.id))
      .map(v => v.nombre);

    // Generar automáticamente recomendaciones para el área
    setTimeout(() => {
      onRequestRecommendations({
        area_id: areaId,
        cantidad_vendedores: area.vendedores.length
      }, {
        ids: area.vendedores,
        nombres: nombresVendedores
      }, {
        comuna: selectedComuna.length > 0 ? selectedComuna : null,
        barrio: area.barrios.length > 0 ? area.barrios : null,
        provincia: selectedProvincia !== 'all' ? selectedProvincia : null
      }, instruccionesAdicionales);
    }, 100);
  };

  const handleClearFilters = () => {
    setSelectedProvincia('all');
    setSelectedComuna([]);
    setSelectedBarrio([]);
    setSelectedArea('none');
    setInstruccionesAdicionales('');
  };

  const hasActiveFilters = 
    selectedProvincia !== 'all' ||
    selectedComuna.length > 0 ||
    selectedBarrio.length > 0;
  useEffect(() => {
    fetchVendedores();
    fetchAreas();
  }, []);

  const fetchAreas = async () => {
    setIsLoadingAreas(true);
    try {
      // Obtener áreas con sus relaciones
      const { data: areasData, error: areasError } = await supabase
        .from('areas')
        .select('id, nombre');

      if (areasError) throw areasError;

      // Para cada área, obtener sus vendedores y barrios
      const areasWithRelations = await Promise.all(
        (areasData || []).map(async (area) => {
          // Obtener vendedores del área
          const { data: vendedoresData } = await supabase
            .from('areas_vendedores')
            .select('vendedor_id')
            .eq('area_id', area.id);

          // Obtener places (barrios) del área
          const { data: placesData } = await supabase
            .from('areas_places')
            .select('place_id')
            .eq('area_id', area.id);

          // Obtener los barrios de los places
          const placeIds = (placesData || []).map(p => p.place_id);
          const barrios: string[] = [];
          
          if (placeIds.length > 0) {
            const { data: barriosData } = await supabase
              .from('places')
              .select('barrio_principal')
              .in('id', placeIds);
            
            (barriosData || []).forEach(p => {
              if (p.barrio_principal) barrios.push(p.barrio_principal);
            });
          }

          return {
            id: area.id,
            nombre: area.nombre,
            vendedores: (vendedoresData || []).map(v => v.vendedor_id),
            barrios: barrios
          };
        })
      );

      setAreas(areasWithRelations);
    } catch (error) {
      console.error('Error fetching areas:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar áreas"
      });
    } finally {
      setIsLoadingAreas(false);
    }
  };

  const fetchVendedores = async () => {
    setIsLoadingVendedores(true);
    try {
      const {
        data,
        error
      } = await supabase.from('profiles').select('id, user_id, nombre, email').eq('rol', 'vendedor').eq('activo', true);
      if (error) throw error;
      const mappedVendedores = (data || []).map(v => ({
        id: v.id, // Usar el profile.id en lugar de user_id
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
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
      comuna: selectedComuna.length > 0 ? selectedComuna : null,
      barrio: selectedBarrio.length > 0 ? selectedBarrio : null,
      provincia: selectedProvincia !== 'all' ? selectedProvincia : null
    }, instruccionesAdicionales);
  };
  return <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="p-4 bg-accent/10 border-accent">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-accent" />
            <h3 className="font-semibold">Filtro Rápido por Área</h3>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="area-filter">Seleccionar Área</Label>
            <Select value={selectedArea} onValueChange={handleAreaChange} disabled={isLoadingAreas}>
              <SelectTrigger id="area-filter" className="bg-background">
                <SelectValue placeholder="Selecciona un área" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="none">Sin área seleccionada</SelectItem>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.nombre} ({area.vendedores.length} vendedores, {area.barrios.length} barrios)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ✨ Al seleccionar un área, se generarán automáticamente recomendaciones de IA que podrás modificar
            </p>
          </div>
        </div>
      </Card>

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-accent" />
              <h3 className="font-semibold">Filtros de Ubicación</h3>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-8 px-2"
              >
                <X className="w-4 h-4 mr-1" />
                Limpiar filtros
              </Button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provincia-filter">Provincia</Label>
              <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                <SelectTrigger id="provincia-filter" className="bg-background">
                  <SelectValue placeholder="Todas las provincias" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todas las provincias</SelectItem>
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
              <MultiSelect
                options={comunas}
                selected={selectedComuna}
                onChange={setSelectedComuna}
                placeholder="Todas las comunas"
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="barrio-filter">Barrio</Label>
              <MultiSelect
                options={barrios}
                selected={selectedBarrio}
                onChange={setSelectedBarrio}
                placeholder="Todos los barrios"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-muted/50">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <h3 className="font-semibold">Instrucciones Adicionales para la IA</h3>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="instrucciones-adicionales">
              Instrucciones libres (opcional)
            </Label>
            <Textarea
              id="instrucciones-adicionales"
              placeholder="Ej: Priorizar clientes del canal ON_TRADE, enfocarse en restaurantes de alta gama, evitar clientes con problemas de pago recientes..."
              value={instruccionesAdicionales}
              onChange={(e) => setInstruccionesAdicionales(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              La IA considerará estas instrucciones adicionales al generar las recomendaciones
            </p>
          </div>
        </div>
      </Card>

      <Button type="submit" className="wine-button w-full md:w-auto" disabled={isLoading || selectedVendedores.length === 0}>
        <Sparkles className="w-4 h-4 mr-2" />
        {isLoading ? "Generar 8 Recomendaciones por Vendedor" : "Solicitar Recomendaciones IA"}
      </Button>
    </form>;
};
export default FilterPanel;