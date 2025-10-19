import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { Sucursal } from "@/types/sales";
import ClientDetailCard from "./ClientDetailCard";

interface PreselectionStepProps {
  recommendations: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onContinue: () => void;
}

const PreselectionStep = ({ 
  recommendations, 
  selectedIds, 
  onToggle, 
  onToggleAll,
  onContinue 
}: PreselectionStepProps) => {
  const allSelected = recommendations.length > 0 && selectedIds.length === recommendations.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onToggleAll}
            className="h-5 w-5"
          />
          <span className="font-medium">
            {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
          </span>
          <Badge variant="secondary">
            {selectedIds.length} de {recommendations.length} seleccionados
          </Badge>
        </div>
        
        <Button 
          onClick={onContinue} 
          disabled={selectedIds.length === 0}
          size="lg"
          className="gap-2"
        >
          Continuar a la Asignación
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {recommendations.map((recomendacion) => (
          <ClientDetailCard
            key={recomendacion.id}
            cliente={recomendacion}
            isSelected={selectedIds.includes(recomendacion.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
};

export default PreselectionStep;
