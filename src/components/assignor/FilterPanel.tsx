import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Sparkles } from "lucide-react";

interface FilterPanelProps {
  onRequestRecommendations: (filters: any) => void;
  isLoading: boolean;
}

const FilterPanel = ({ onRequestRecommendations, isLoading }: FilterPanelProps) => {
  const [cantidadVendedores, setCantidadVendedores] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRequestRecommendations({ cantidad_vendedores: parseInt(cantidadVendedores) || 0 });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2 max-w-md">
        <Label htmlFor="cantidadVendedores">Cantidad de vendedores</Label>
        <Input
          id="cantidadVendedores"
          type="number"
          placeholder="Ej: 5"
          value={cantidadVendedores}
          onChange={(e) => setCantidadVendedores(e.target.value)}
          min="1"
          required
        />
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