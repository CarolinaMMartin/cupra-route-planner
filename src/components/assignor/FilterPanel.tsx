import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, MapPin, X, ChevronRight, LayoutGrid, Search } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface Vendedor { id: string; nombre: string; email: string; }
interface Area { id: string; nombre: string; vendedores: string[]; barrios: string[]; }

interface FilterPanelProps {
  onRequestRecommendations: (filters: any, selectedVendedoresData: { ids: string[], nombres: string[] }, placesFilters: any) => void;
  isLoading: boolean;
  placesData: Array<{ comuna: string | null, barrio_principal: string | null, provincia_principal: string | null }>;
  instruccionesAdicionales: string;
  onInstruccionesChange: (value: string) => void;
}

const FilterPanel = ({
  onRequestRecommendations, isLoading, placesData,
  instruccionesAdicionales, onInstruccionesChange
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
    placesData.forEach(place => { if (place.provincia_principal) set.add(place.provincia_principal); });
    return Array.from(set).sort();
  }, [placesData]);

  const comunas = useMemo(() => {
    const filtered = placesData.filter(place => selectedProvincia === 'all' || place.provincia_principal === selectedProvincia);
    const set = new Set<string>();
    filtered.forEach(place => { if (place.comuna) set.add(place.comuna); });
    return Array.from(set).sort().map(c => ({ label: c, value: c }));
  }, [placesData, selectedProvincia]);

  const barrios = useMemo(() => {
    const filtered = placesData.filter(place =>
      (selectedProvincia === 'all' || place.provincia_principal === selectedProvincia) &&
      (selectedComuna.length === 0 || selectedComuna.includes(place.comuna || ''))
    );
    const set = new Set<string>();
    filtered.forEach(place => { if (place.barrio_principal) set.add(place.barrio_principal); });
    return Array.from(set).sort().map(b => ({ label: b, value: b }));
  }, [placesData, selectedProvincia, selectedComuna]);

  const handleProvinciaChange = (value: string) => { setSelectedProvincia(value); setSelectedComuna([]); setSelectedBarrio([]); };
  const handleAreaChange = async (areaId: string) => { setSelectedArea(areaId); };
  const handleClearFilters = () => { setSelectedProvincia('all'); setSelectedComuna([]); setSelectedBarrio([]); setSelectedArea('none'); };
  const hasActiveFilters = selectedProvincia !== 'all' || selectedComuna.length > 0 || selectedBarrio.length > 0;

  useEffect(() => { fetchVendedores(); fetchAreas(); }, []);

  const fetchAreas = async () => {
    setIsLoadingAreas(true);
    try {
      const { data: areasData, error: areasError } = await supabase.from('areas').select('id, nombre');
      if (areasError) throw areasError;
      const areasWithRelations = await Promise.all(
        (areasData || []).map(async (area) => {
          const { data: vendedoresData } = await supabase.from('areas_vendedores').select('vendedor_id').eq('area_id', area.id);
          const { data: placesData } = await supabase.from('areas_places').select('place_id').eq('area_id', area.id);
          const placeIds = (placesData || []).map(p => p.place_id);
          const barrios: string[] = [];
          if (placeIds.length > 0) {
            const { data: barriosData } = await supabase.from('places').select('barrio_principal').in('id', placeIds);
            (barriosData || []).forEach(p => { if (p.barrio_principal) barrios.push(p.barrio_principal); });
          }
          return { id: area.id, nombre: area.nombre, vendedores: (vendedoresData || []).map(v => v.vendedor_id), barrios };
        })
      );
      setAreas(areasWithRelations);
    } catch (error) { console.error('Error fetching areas:', error); }
    finally { setIsLoadingAreas(false); }
  };

  const fetchVendedores = async () => {
    setIsLoadingVendedores(true);
    try {
      const { data, error } = await supabase.from('profiles').select('id, user_id, nombre, email').eq('rol', 'vendedor').eq('activo', true);
      if (error) throw error;
      const mapped = (data || []).map(v => ({ id: v.id, nombre: v.nombre, email: v.email }));
      setVendedores(mapped);
      setSelectedVendedores(mapped.map(v => v.id));
    } catch (error) { console.error('Error fetching vendedores:', error); }
    finally { setIsLoadingVendedores(false); }
  };

  const toggleVendedor = (vendedorId: string) => {
    setSelectedVendedores(prev => prev.includes(vendedorId) ? prev.filter(id => id !== vendedorId) : [...prev, vendedorId]);
  };
  const toggleAllVendedores = () => {
    setSelectedVendedores(selectedVendedores.length === vendedores.length ? [] : vendedores.map(v => v.id));
  };

  const handleSubmitArea = () => {
    const area = areas.find(a => a.id === selectedArea);
    if (!area) return;
    const nombres = vendedores.filter(v => area.vendedores.includes(v.id)).map(v => v.nombre);
    onRequestRecommendations({ area_id: selectedArea, cantidad_vendedores: area.vendedores.length }, { ids: area.vendedores, nombres }, { comuna: null, barrio: area.barrios.length > 0 ? area.barrios : null, provincia: null });
  };

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVendedores.length === 0) { toast({ variant: "destructive", title: "Error", description: "Seleccioná al menos un vendedor" }); return; }
    const nombres = vendedores.filter(v => selectedVendedores.includes(v.id)).map(v => v.nombre);
    onRequestRecommendations({ cantidad_vendedores: selectedVendedores.length }, { ids: selectedVendedores, nombres }, { comuna: selectedComuna.length > 0 ? selectedComuna : null, barrio: selectedBarrio.length > 0 ? selectedBarrio : null, provincia: selectedProvincia !== 'all' ? selectedProvincia : null });
  };

  const selectedAreaData = areas.find(a => a.id === selectedArea);

  return (
    <div className="space-y-8">
      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setMode('area')}
          className={`group p-6 rounded-xl text-left transition-all duration-200 ${
            mode === 'area'
              ? 'bg-primary/8 border border-primary/20'
              : 'bg-secondary/30 border border-transparent hover:bg-secondary/50'
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <LayoutGrid className={`w-4 h-4 ${mode === 'area' ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="font-medium text-sm">Por Área</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">Área predefinida con vendedores y zonas</p>
        </button>

        <button
          type="button"
          onClick={() => setMode('custom')}
          className={`group p-6 rounded-xl text-left transition-all duration-200 ${
            mode === 'custom'
              ? 'bg-primary/8 border border-primary/20'
              : 'bg-secondary/30 border border-transparent hover:bg-secondary/50'
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <Search className={`w-4 h-4 ${mode === 'custom' ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="font-medium text-sm">Personalizado</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">Selección manual de vendedores y zonas</p>
        </button>
      </div>

      {/* Mode: Area */}
      {mode === 'area' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="area-filter" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Área</Label>
            <Select value={selectedArea} onValueChange={handleAreaChange} disabled={isLoadingAreas}>
              <SelectTrigger id="area-filter" className="bg-secondary/30 border-border/30 h-11">
                <SelectValue placeholder="Seleccionar área..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin área seleccionada</SelectItem>
                {areas.map((area) => <SelectItem key={area.id} value={area.id}>{area.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selectedAreaData && (
            <div className="rounded-xl bg-secondary/20 p-5 space-y-3">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs font-medium text-muted-foreground mr-1">Vendedores</span>
                {vendedores.filter(v => selectedAreaData.vendedores.includes(v.id)).map(v => (
                  <Badge key={v.id} variant="secondary" className="text-xs font-normal">{v.nombre.split(' ')[0]}</Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs font-medium text-muted-foreground mr-1">Barrios</span>
                {selectedAreaData.barrios.length > 0 ? (
                  selectedAreaData.barrios.slice(0, 5).map(b => <Badge key={b} variant="outline" className="text-xs font-normal">{b}</Badge>)
                ) : (<span className="text-xs text-muted-foreground">Todos</span>)}
                {selectedAreaData.barrios.length > 5 && <span className="text-xs text-muted-foreground">+{selectedAreaData.barrios.length - 5}</span>}
              </div>
            </div>
          )}

          <AIInstructionsCollapsible isOpen={isAIInstructionsOpen} onOpenChange={setIsAIInstructionsOpen} value={instruccionesAdicionales} onChange={onInstruccionesChange} />

          <Button type="button" onClick={handleSubmitArea} disabled={isLoading || selectedArea === 'none'} size="lg" className="w-full">
            <Sparkles className="w-4 h-4" />
            {isLoading ? "Analizando..." : "Generar Recomendaciones"}
          </Button>
        </div>
      )}

      {/* Mode: Custom */}
      {mode === 'custom' && (
        <form onSubmit={handleSubmitCustom} className="space-y-6">
          <Collapsible open={isVendedoresOpen} onOpenChange={setIsVendedoresOpen}>
            <CollapsibleTrigger asChild>
              <button type="button" className="w-full flex items-center justify-between py-3.5 px-5 rounded-xl bg-secondary/20 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium">Vendedores</span>
                  <span className="text-xs text-muted-foreground">{selectedVendedores.length} de {vendedores.length} seleccionados</span>
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isVendedoresOpen ? 'rotate-90' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-4 space-y-3">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllVendedores} disabled={isLoadingVendedores} className="text-xs">
                    {selectedVendedores.length === vendedores.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </Button>
                </div>
                {isLoadingVendedores ? (
                  <p className="text-sm text-muted-foreground">Cargando...</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {vendedores.map(vendedor => (
                      <label key={vendedor.id} className={`flex items-center gap-2.5 p-3 rounded-lg cursor-pointer transition-all duration-150 ${
                        selectedVendedores.includes(vendedor.id)
                          ? 'bg-primary/8 border border-primary/15'
                          : 'bg-secondary/20 border border-transparent hover:bg-secondary/30'
                      }`}>
                        <Checkbox checked={selectedVendedores.includes(vendedor.id)} onCheckedChange={() => toggleVendedor(vendedor.id)} />
                        <span className="text-sm">{vendedor.nombre}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Geographic filters */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filtros Geográficos</span>
              </div>
              {hasActiveFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={handleClearFilters} className="h-7 px-2 text-xs text-muted-foreground">
                  <X className="w-3 h-3 mr-1" />Limpiar
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Provincia</Label>
                <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                  <SelectTrigger className="bg-secondary/20 border-border/20 h-10"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las provincias</SelectItem>
                    {provincias.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Comuna / Distrito</Label>
                <MultiSelect options={comunas} selected={selectedComuna} onChange={setSelectedComuna} placeholder="Todas" className="w-full" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Barrio</Label>
                <MultiSelect options={barrios} selected={selectedBarrio} onChange={setSelectedBarrio} placeholder="Todos" className="w-full" />
              </div>
            </div>
          </div>

          <AIInstructionsCollapsible isOpen={isAIInstructionsOpen} onOpenChange={setIsAIInstructionsOpen} value={instruccionesAdicionales} onChange={onInstruccionesChange} />

          <Button type="submit" disabled={isLoading || selectedVendedores.length === 0} size="lg" className="w-full">
            <Sparkles className="w-4 h-4" />
            {isLoading ? "Analizando..." : "Generar Recomendaciones"}
          </Button>
        </form>
      )}
    </div>
  );
};

function AIInstructionsCollapsible({ isOpen, onOpenChange, value, onChange }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; value: string; onChange: (value: string) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full flex items-center justify-between py-3.5 px-5 rounded-xl bg-secondary/20 hover:bg-secondary/30 transition-colors">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-primary/70" />
            <span className="text-sm font-medium">Instrucciones para la IA</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-3">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Ej: Priorizar clientes con más de 90 días sin compra..."
            className="min-h-[80px] bg-secondary/20 border-border/20 text-sm resize-none"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default FilterPanel;
