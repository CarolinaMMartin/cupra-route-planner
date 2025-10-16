import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

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
  onClearFilters,
}: RecommendationFiltersProps) => {
  const hasActiveFilters = selectedCiudad || selectedProvincia || selectedVendedor;

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
  );
};

export default RecommendationFilters;
