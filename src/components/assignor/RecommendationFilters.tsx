import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface RecommendationFiltersProps {
  vendedores: string[];
  selectedVendedor: string;
  onVendedorChange: (value: string) => void;
  onClearFilters: () => void;
}

const RecommendationFilters = ({
  vendedores,
  selectedVendedor,
  onVendedorChange,
  onClearFilters,
}: RecommendationFiltersProps) => {
  const hasActiveFilters = selectedVendedor !== 'all';

  if (vendedores.length <= 1) return null;

  return (
    <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 flex-1">
        <Label htmlFor="vendedor-filter" className="text-sm whitespace-nowrap">Filtrar por vendedor:</Label>
        <Select value={selectedVendedor} onValueChange={onVendedorChange}>
          <SelectTrigger id="vendedor-filter" className="bg-background w-[200px]">
            <SelectValue placeholder="Todos" />
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
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-8 px-2">
          <X className="w-4 h-4 mr-1" />
          Limpiar
        </Button>
      )}
    </div>
  );
};

export default RecommendationFilters;
