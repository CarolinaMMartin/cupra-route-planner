import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, MapPin, X, Info, ChevronDown, LayoutGrid, Search } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [mode, setMode] = useState<'area' | 'custom'>('area');
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
  const [isVendedoresOpen, setIsVendedoresOpen] = useState(false);
  const { toast } = useToast();

  const provincias = useMemo(() => {
    const set = new Set<string>();
    placesData.forEach(place => {
      if (place.provincia_principal) set.add(place.provincia_principal);
    });
    return Array.from(set).sort();
  }, [placesData]);

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

  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedComuna([]);
    setSelectedBarrio([]);
  };

  const handleAreaChange = async (areaId: string) => {
    setSelectedArea(areaId);
    if (areaId === 'none') return;

    const area = areas.find(a => a.id === areaId);
    if (!area) return;

    toast({
      title: "✅ Área seleccionada",
      description: `"${area.nombre}" con ${area.vendedores.length} vendedores y ${area.barrios.length} barrios.`
    });
  };

  const handleClearFilters = () => {
    setSelectedProvincia('all');
    setSelectedComuna([]);
    setSelectedBarrio([]);
    setSelectedArea('none');
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
      const { data: areasData, error: areasError } = await supabase
        .from('areas')
        .select('id, nombre');

      if (areasError) throw areasError;

      const areasWithRelations = await Promise.all(
        (areasData || []).map(async (area) => {
          const { data: vendedoresData } = await supabase
            .from('areas_vendedores')
            .select('vendedor_id')
            .eq('area_id', area.id);

          const { data: placesData } = await supabase
            .from('areas_places')
            .select('place_id')
            .eq('area_id', area.id);

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
      toast({ variant: "destructive", title: "Error", description: "Error al cargar áreas" });
    } finally {
      setIsLoadingAreas(false);
    }
  };

  const fetchVendedores = async () => {
    setIsLoadingVendedores(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, nombre, email')
        .eq('rol', 'vendedor')
        .eq('activo', true);
      if (error) throw error;
      const mappedVendedores = (data || []).map(v => ({
        id: v.id,
        nombre: v.nombre,
        email: v.email
      }));
      setVendedores(mappedVendedores);
      setSelectedVendedores(mappedVendedores.map(v => v.id));
    } catch (error) {
      console.error('Error fetching vendedores:', error);
      toast({ variant: "destructive", title: "Error", description: "Error al cargar vendedores" });
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

  const handleSubmitArea = () => {
    const area = areas.find(a => a.id === selectedArea);
    if (!area) return;

    const nombresVendedores = vendedores
      .filter(v => area.vendedores.includes(v.id))
      .map(v => v.nombre);

    onRequestRecommendations({
      area_id: selectedArea,
      cantidad_vendedores: area.vendedores.length
    }, {
      ids: area.vendedores,
      nombres: nombresVendedores
    }, {
      comuna: null,
      barrio: area.barrios.length > 0 ? area.barrios : null,
      provincia: null
    });
  };

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVendedores.length === 0) {
      toast({ variant: "destructive", title: "Error", description: "Debes seleccionar al menos un vendedor" });
      return;
    }

    const nombresVendedores = vendedores
      .filter(v => selectedVendedores.includes(v.id))
      .map(v => v.nombre);

    onRequestRecommendations({
      cantidad_vendedores: selectedVendedores.length
    }, {
      ids: selectedVendedores,
      nombres: nombresVendedores
    }, {
      comuna: selectedComuna.length > 0 ? selectedComuna : null,
      barrio: selectedBarrio.length > 0 ? selectedBarrio : null,
      provincia: selectedProvincia !== 'all' ? selectedProvincia : null
    });
  };

  const selectedAreaData = areas.find(a => a.id === selectedArea);

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode('area')}
          className={`p-4 rounded-lg border-2 text-left transition-all ${
            mode === 'area'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/30'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">Por Área</span>
          </div>
          <p className="text-xs text-muted-foreground">Usá un área predefinida con vendedores y zonas ya configuradas</p>
        </button>

        <button
          type="button"
          onClick={() => setMode('custom')}
          className={`p-4 rounded-lg border-2 text-left transition-all ${
            mode === 'custom'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/30'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">Personalizado</span>
          </div>
          <p className="text-xs text-muted-foreground">Elegí vendedores y zonas manualmente</p>
        </button>
      </div>

      {/* Mode: Area */}
      {mode === 'area' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="area-filter">Seleccionar Área</Label>
            <Select value={selectedArea} onValueChange={handleAreaChange} disabled={isLoadingAreas}>
              <SelectTrigger id="area-filter" className="bg-background">
                <SelectValue placeholder="Elegí un área..." />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="none">Sin área seleccionada</SelectItem>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedAreaData && (
            <Card className="p-4 bg-muted/30 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Vendedores:</span>
                {vendedores
                  .filter(v => selectedAreaData.vendedores.includes(v.id))
                  .map(v => (
                    <Badge key={v.id} variant="secondary" className="text-xs">{v.nombre.split(' ')[0]}</Badge>
                  ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Barrios:</span>
                {selectedAreaData.barrios.length > 0 ? (
                  selectedAreaData.barrios.slice(0, 5).map(b => (
                    <Badge key={b} variant="outline" className="text-xs">{b}</Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Todos</span>
                )}
                {selectedAreaData.barrios.length > 5 && (
                  <Badge variant="outline" className="text-xs">+{selectedAreaData.barrios.length - 5} más</Badge>
                )}
              </div>
            </Card>
          )}

          {/* AI Instructions for area mode */}
          <AIInstructionsCollapsible
            isOpen={isAIInstructionsOpen}
            onOpenChange={setIsAIInstructionsOpen}
            value={instruccionesAdicionales}
            onChange={onInstruccionesChange}
          />

          <Button
            type="button"
            onClick={handleSubmitArea}
            disabled={isLoading || selectedArea === 'none'}
            className="w-full"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isLoading ? "IA analizando..." : "Generar Recomendaciones con IA"}
          </Button>
        </div>
      )}

      {/* Mode: Custom */}
      {mode === 'custom' && (
        <form onSubmit={handleSubmitCustom} className="space-y-4">
          {/* Vendedores collapsible */}
          <Collapsible open={isVendedoresOpen} onOpenChange={setIsVendedoresOpen}>
            <Card className="p-0 overflow-hidden">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">Vendedores</span>
                    <Badge variant="secondary" className="text-xs">
                      {selectedVendedores.length} de {vendedores.length}
                    </Badge>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isVendedoresOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3 border-t">
                  <div className="flex justify-end pt-3">
                    <Button type="button" variant="outline" size="sm" onClick={toggleAllVendedores} disabled={isLoadingVendedores}>
                      {selectedVendedores.length === vendedores.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                    </Button>
                  </div>
                  {isLoadingVendedores ? (
                    <p className="text-sm text-muted-foreground">Cargando vendedores...</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {vendedores.map(vendedor => (
                        <label key={vendedor.id} className="flex items-center gap-2 p-2 rounded-md border bg-background cursor-pointer hover:bg-accent/5 transition-colors">
                          <Checkbox checked={selectedVendedores.includes(vendedor.id)} onCheckedChange={() => toggleVendedor(vendedor.id)} />
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{vendedor.nombre}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Geographic filters */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Filtros Geográficos</span>
              </div>
              {hasActiveFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={handleClearFilters} className="h-7 px-2 text-xs">
                  <X className="w-3 h-3 mr-1" />
                  Limpiar
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="provincia-filter" className="text-xs">Provincia</Label>
                <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                  <SelectTrigger id="provincia-filter" className="bg-background h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">Todas las provincias</SelectItem>
                    {provincias.map((provincia) => (
                      <SelectItem key={provincia} value={provincia}>{provincia}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Comuna / Distrito</Label>
                <MultiSelect
                  options={comunas}
                  selected={selectedComuna}
                  onChange={setSelectedComuna}
                  placeholder="Todas"
                  className="w-full"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Barrio</Label>
                <MultiSelect
                  options={barrios}
                  selected={selectedBarrio}
                  onChange={setSelectedBarrio}
                  placeholder="Todos"
                  className="w-full"
                />
              </div>
            </div>
          </Card>

          {/* AI Instructions for custom mode */}
          <AIInstructionsCollapsible
            isOpen={isAIInstructionsOpen}
            onOpenChange={setIsAIInstructionsOpen}
            value={instruccionesAdicionales}
            onChange={onInstruccionesChange}
          />

          <Button type="submit" className="w-full" disabled={isLoading || selectedVendedores.length === 0}>
            <Sparkles className="w-4 h-4 mr-2" />
            {isLoading ? "IA analizando..." : "Generar Recomendaciones con IA"}
          </Button>
        </form>
      )}
    </div>
  );
};

/* Extracted collapsible AI instructions component */
function AIInstructionsCollapsible({
  isOpen,
  onOpenChange,
  value,
  onChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="w-4 h-4" />
          <span>Instrucciones adicionales para la IA</span>
          <span className="text-xs">(Opcional)</span>
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="p-4 mt-2 space-y-3">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Ejemplos:</strong> "Priorizar clientes que compran Malbec", "Solo restaurantes ON_TRADE", "Clientes VIP"
            </AlertDescription>
          </Alert>
          <Textarea
            placeholder="Ej: Priorizar clientes que compran Malbec Gran Reserva..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-[80px] resize-none bg-background text-sm"
          />
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default FilterPanel;
