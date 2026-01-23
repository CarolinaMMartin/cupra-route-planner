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
import { Sparkles, Users, MapPin, X, Info, ChevronDown } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  onRequestRecommendations: (filters: any, selectedVendedoresData: { ids: string[], nombres: string[] }, placesFilters: any) => void;
  isLoading: boolean;
  placesData: Array<{ comuna: string | null, barrio_principal: string | null, provincia_principal: string | null }>;
  instruccionesAdicionales: string;
  onInstruccionesChange: (value: string) => void;
}
const FilterPanel = ({
  onRequestRecommendations,
  isLoading,
  placesData,
  instruccionesAdicionales,
  onInstruccionesChange
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
  const [isAIInstructionsOpen, setIsAIInstructionsOpen] = useState(false);
  const [pendingAreaGeneration, setPendingAreaGeneration] = useState(false);
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
      setPendingAreaGeneration(false);
      return;
    }

    const area = areas.find(a => a.id === areaId);
    if (!area) return;

    // Llenar automáticamente los filtros con el contenido del área
    setSelectedVendedores(area.vendedores);
    setSelectedBarrio(area.barrios);
    setPendingAreaGeneration(true);
    
    toast({
      title: "✅ Área seleccionada",
      description: `"${area.nombre}" cargada con ${area.vendedores.length} vendedores y ${area.barrios.length} barrios. Presiona "Generar Recomendaciones" para continuar.`
    });
  };

  const handleGenerateFromArea = () => {
    const area = areas.find(a => a.id === selectedArea);
    if (!area) return;

    toast({
      title: "⏳ Generando recomendaciones...",
      description: `La IA está analizando el área "${area.nombre}"...`
    });

    // Obtener nombres de los vendedores seleccionados
    const nombresVendedores = vendedores
      .filter(v => area.vendedores.includes(v.id))
      .map(v => v.nombre);

    // Generar recomendaciones para el área
    setTimeout(() => {
      onRequestRecommendations({
        area_id: selectedArea,
        cantidad_vendedores: area.vendedores.length
      }, {
        ids: area.vendedores,
        nombres: nombresVendedores
      }, {
        comuna: selectedComuna.length > 0 ? selectedComuna : null,
        barrio: area.barrios.length > 0 ? area.barrios : null,
        provincia: selectedProvincia !== 'all' ? selectedProvincia : null
      });
      setPendingAreaGeneration(false);
    }, 100);
  };

  const handleClearFilters = () => {
    setSelectedProvincia('all');
    setSelectedComuna([]);
    setSelectedBarrio([]);
    setSelectedArea('none');
    setPendingAreaGeneration(false);
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
    });
  };
  return <form onSubmit={handleSubmit} className="space-y-6">
      {/* SECCIÓN 1: FILTRO RÁPIDO POR ÁREA */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/20 text-accent font-bold text-sm">
            1
          </div>
          <h2 className="text-lg font-bold">Filtro Rápido por Área</h2>
        </div>
        
        <Card className="p-4 bg-accent/5 border-accent/30">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="area-filter" className="text-base">Seleccionar Área</Label>
              <Select value={selectedArea} onValueChange={handleAreaChange} disabled={isLoadingAreas}>
                <SelectTrigger id="area-filter" className="bg-background">
                  <SelectValue placeholder="Sin área seleccionada" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="none">Sin área seleccionada</SelectItem>
                  {areas.map((area) => {
                    const nombresVendedores = vendedores
                      .filter(v => area.vendedores.includes(v.id))
                      .map(v => v.nombre.split(' ')[0]);
                    
                    const vendedoresDisplay = nombresVendedores.length > 3
                      ? `${nombresVendedores.slice(0, 3).join(', ')}...`
                      : nombresVendedores.join(', ');
                    
                    const barriosDisplay = area.barrios.length > 3
                      ? `${area.barrios.slice(0, 3).join(', ')}...`
                      : area.barrios.join(', ');

                    return (
                      <SelectItem key={area.id} value={area.id}>
                        {area.nombre} • {vendedoresDisplay || 'Sin vendedores'} | {barriosDisplay || 'Sin barrios'}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                ✨ Selecciona un área predefinida para cargar vendedores y barrios automáticamente
              </p>
            </div>
            
            {pendingAreaGeneration && selectedArea !== 'none' && (
              <Button
                type="button"
                onClick={handleGenerateFromArea}
                disabled={isLoading}
                className="w-full"
                variant="default"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generar Recomendaciones con IA
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* SECCIÓN 2: FILTROS */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/20 text-accent font-bold text-sm">
            2
          </div>
          <h2 className="text-lg font-bold">Filtros de Selección</h2>
        </div>

        {/* Vendedores */}
        <Card className="p-4 bg-muted/50">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-accent" />
                <div>
                  <h3 className="font-semibold">Vendedores</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedVendedores.length} de {vendedores.length} seleccionados
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={toggleAllVendedores} disabled={isLoadingVendedores}>
                {selectedVendedores.length === vendedores.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </Button>
            </div>

            {isLoadingVendedores ? (
              <div className="text-sm text-muted-foreground">Cargando vendedores...</div>
            ) : vendedores.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay vendedores activos disponibles</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {vendedores.map(vendedor => (
                  <label key={vendedor.id} className="flex items-start gap-3 p-3 rounded-lg border bg-background cursor-pointer hover:bg-accent/5 transition-colors">
                    <Checkbox checked={selectedVendedores.includes(vendedor.id)} onCheckedChange={() => toggleVendedor(vendedor.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{vendedor.nombre}</p>
                      <p className="text-xs text-muted-foreground truncate">{vendedor.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Filtros Geográficos */}
        <Card className="p-4 bg-muted/50">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-accent" />
                <div>
                  <h3 className="font-semibold">Filtros Geográficos</h3>
                  <p className="text-xs text-muted-foreground">Define las zonas donde la IA buscará clientes</p>
                </div>
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
                  Limpiar
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
      </div>

      {/* SECCIÓN 3: INSTRUCCIONES ADICIONALES PARA IA (OPCIONAL) */}
      <div className="space-y-3">
        <Collapsible open={isAIInstructionsOpen} onOpenChange={setIsAIInstructionsOpen}>
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/20 text-accent font-bold text-sm">
              3
            </div>
            <h2 className="text-lg font-bold flex-1">Instrucciones Adicionales para la IA</h2>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <span className="text-xs text-muted-foreground">Opcional</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isAIInstructionsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
          
          <CollapsibleContent>
            <Card className="p-4 bg-gradient-to-br from-accent/5 to-primary/5 border-accent/20">
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Ejemplos de criterios:</strong>
                    <ul className="mt-2 space-y-1 list-disc list-inside">
                      <li>Priorizar clientes que compran productos específicos (ej: "clientes que compran Malbec")</li>
                      <li>Enfocarse en ciertos canales (ej: "solo restaurantes ON_TRADE")</li>
                      <li>Considerar etiquetas específicas (ej: "clientes VIP o Premium")</li>
                      <li>Evitar clientes con ciertos criterios (ej: "evitar clientes con pagos pendientes")</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="additional-instructions">
                    Instrucciones libres para la IA
                  </Label>
                  <Textarea
                    id="additional-instructions"
                    placeholder="Ej: Priorizar clientes que compran Malbec Gran Reserva, enfocarse en restaurantes de alta gama del canal ON_TRADE..."
                    value={instruccionesAdicionales}
                    onChange={(e) => onInstruccionesChange(e.target.value)}
                    className="min-h-[120px] resize-none bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    La IA buscará en la base de datos (productos, etiquetas, canales) para cumplir con tus instrucciones
                  </p>
                </div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="flex flex-col gap-2">
        <Button type="submit" className="wine-button w-full md:w-auto" disabled={isLoading || selectedVendedores.length === 0}>
          <Sparkles className="w-4 h-4 mr-2" />
          {isLoading ? "IA analizando base de datos..." : "Generar 8 Recomendaciones con IA"}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          La IA analizará la base de datos usando los filtros y vendedores seleccionados
        </p>
      </div>
    </form>;
};
export default FilterPanel;