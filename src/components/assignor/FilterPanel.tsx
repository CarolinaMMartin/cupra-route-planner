import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";

interface FilterPanelProps {
  onRequestRecommendations: (filters: any) => void;
  isLoading: boolean;
}

const FilterPanel = ({ onRequestRecommendations, isLoading }: FilterPanelProps) => {
  const [filters, setFilters] = useState({
    zona: '',
    diasSinVisita: '',
    scoreMinimo: '',
    tipoCliente: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRequestRecommendations(filters);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label htmlFor="zona">Zona</Label>
          <Select value={filters.zona} onValueChange={(v) => setFilters({...filters, zona: v})}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar zona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="capital">Capital Federal</SelectItem>
              <SelectItem value="norte">Zona Norte</SelectItem>
              <SelectItem value="sur">Zona Sur</SelectItem>
              <SelectItem value="oeste">Zona Oeste</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="diasSinVisita">Días sin visita (mínimo)</Label>
          <Input
            id="diasSinVisita"
            type="number"
            placeholder="30"
            value={filters.diasSinVisita}
            onChange={(e) => setFilters({...filters, diasSinVisita: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="scoreMinimo">Score mínimo</Label>
          <Input
            id="scoreMinimo"
            type="number"
            placeholder="70"
            value={filters.scoreMinimo}
            onChange={(e) => setFilters({...filters, scoreMinimo: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tipoCliente">Tipo de cliente</Label>
          <Select value={filters.tipoCliente} onValueChange={(v) => setFilters({...filters, tipoCliente: v})}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="premium">Premium</SelectItem>
              <SelectItem value="estandar">Estándar</SelectItem>
              <SelectItem value="basico">Básico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        type="submit"
        className="wine-button w-full md:w-auto"
        disabled={isLoading}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        {isLoading ? "Generando..." : "Solicitar Recomendaciones IA"}
      </Button>
    </form>
  );
};

export default FilterPanel;