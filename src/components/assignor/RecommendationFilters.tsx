import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useMemo } from "react";
import { MultiSelect } from "@/components/ui/multi-select";

interface RecommendationFiltersProps {
  ciudades: string[];
  provincias: string[];
  vendedores: string[];
  selectedCiudad: string;
  selectedProvincia: string;
  selectedVendedor: string;
  onCiudadChange: (value: string) => void;
  onProvinciaChange: (value: string) => void;
  onVendedorChange: (value: string) => void;
  placesData: Array<{ comuna: string | null, barrio_principal: string | null, provincia_principal: string | null }>;
  selectedPlacesComuna: string[];
  selectedPlacesBarrio: string[];
  selectedPlacesProvincia: string;
  onPlacesComunaChange: (values: string[]) => void;
  onPlacesBarrioChange: (values: string[]) => void;
  onPlacesProvinciaChange: (value: string) => void;
  onClearFilters: () => void;
}

const RecommendationFilters = ({
  ciudades,
  provincias,
  vendedores,
  selectedCiudad,
  selectedProvincia,
  selectedVendedor,
  onCiudadChange,
  onProvinciaChange,
  onVendedorChange,
  placesData,
  selectedPlacesComuna,
  selectedPlacesBarrio,
  selectedPlacesProvincia,
  onPlacesComunaChange,
  onPlacesBarrioChange,
  onPlacesProvinciaChange,
  onClearFilters,
}: RecommendationFiltersProps) => {
  // Obtener provincias únicas de places ordenadas alfabéticamente
  const placesProvincia = useMemo(() => {
    const set = new Set<string>();
    placesData.forEach(place => {
      if (place.provincia_principal) set.add(place.provincia_principal);
    });
    return Array.from(set).sort();
  }, [placesData]);

  // Obtener comunas filtradas por provincia y ordenadas alfabéticamente
  const placesComunas = useMemo(() => {
    const filtered = placesData.filter(place => 
      selectedPlacesProvincia === 'all' || place.provincia_principal === selectedPlacesProvincia
    );
    const set = new Set<string>();
    filtered.forEach(place => {
      if (place.comuna) set.add(place.comuna);
    });
    return Array.from(set).sort().map(c => ({ label: c, value: c }));
  }, [placesData, selectedPlacesProvincia]);

  // Obtener barrios filtrados por provincia y comuna, ordenados alfabéticamente
  const placesBarrios = useMemo(() => {
    const filtered = placesData.filter(place => 
      (selectedPlacesProvincia === 'all' || place.provincia_principal === selectedPlacesProvincia) &&
      (selectedPlacesComuna.length === 0 || selectedPlacesComuna.includes(place.comuna || ''))
    );
    const set = new Set<string>();
    filtered.forEach(place => {
      if (place.barrio_principal) set.add(place.barrio_principal);
    });
    return Array.from(set).sort().map(b => ({ label: b, value: b }));
  }, [placesData, selectedPlacesProvincia, selectedPlacesComuna]);

  // Resetear filtros dependientes cuando cambia la provincia
  const handlePlacesProvinciaChange = (value: string) => {
    onPlacesProvinciaChange(value);
    onPlacesComunaChange([]);
    onPlacesBarrioChange([]);
  };

  const hasActiveFilters = 
    selectedCiudad !== 'all' || 
    selectedProvincia !== 'all' || 
    selectedVendedor !== 'all' ||
    selectedPlacesComuna.length > 0 ||
    selectedPlacesBarrio.length > 0 ||
    selectedPlacesProvincia !== 'all';

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Filtros de búsqueda</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-8 px-2"
          >
            <X className="w-4 h-4 mr-1" />
            Limpiar filtros
          </Button>
        )}
      </div>
      
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Filtros de Recomendaciones</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provincia-filter">Provincia</Label>
              <Select value={selectedProvincia} onValueChange={onProvinciaChange}>
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
              <Label htmlFor="ciudad-filter">Ciudad</Label>
              <Select value={selectedCiudad} onValueChange={onCiudadChange}>
                <SelectTrigger id="ciudad-filter" className="bg-background">
                  <SelectValue placeholder="Todas las ciudades" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {ciudades.map((ciudad) => (
                    <SelectItem key={ciudad} value={ciudad}>
                      {ciudad}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendedor-filter">Vendedor</Label>
              <Select value={selectedVendedor} onValueChange={onVendedorChange}>
                <SelectTrigger id="vendedor-filter" className="bg-background">
                  <SelectValue placeholder="Todos los vendedores" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todos los vendedores</SelectItem>
                  {vendedores.map((vendedor) => (
                    <SelectItem key={vendedor} value={vendedor}>
                      {vendedor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Filtros de Ubicaciones (Places)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="places-provincia-filter">Provincia (Places)</Label>
              <Select value={selectedPlacesProvincia} onValueChange={handlePlacesProvinciaChange}>
                <SelectTrigger id="places-provincia-filter" className="bg-background">
                  <SelectValue placeholder="Todas las provincias" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">Todas las provincias</SelectItem>
                  {placesProvincia.map((provincia) => (
                    <SelectItem key={provincia} value={provincia}>
                      {provincia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="places-comuna-filter">Comuna / Distrito (Places)</Label>
              <MultiSelect
                options={placesComunas}
                selected={selectedPlacesComuna}
                onChange={onPlacesComunaChange}
                placeholder="Todas las comunas"
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="places-barrio-filter">Barrio (Places)</Label>
              <MultiSelect
                options={placesBarrios}
                selected={selectedPlacesBarrio}
                onChange={onPlacesBarrioChange}
                placeholder="Todos los barrios"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecommendationFilters;
