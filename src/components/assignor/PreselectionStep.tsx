import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save } from "lucide-react";
import { Sucursal } from "@/types/sales";
import ClientDetailCard from "./ClientDetailCard";

interface PreselectionStepProps {
  recommendations: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onContinue: () => void;
  isSaving?: boolean;
}

const PreselectionStep = ({ 
  recommendations, 
  selectedIds, 
  onToggle, 
  onToggleAll,
  onContinue,
  isSaving = false,
}: PreselectionStepProps) => {
  const allSelected = recommendations.length > 0 && selectedIds.length === recommendations.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onToggleAll}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
          </span>
          <Badge variant="secondary" className="text-xs">
            {selectedIds.length} de {recommendations.length} seleccionados
          </Badge>
        </div>
        
        <Button 
          onClick={onContinue} 
          disabled={selectedIds.length === 0 || isSaving}
          className="gap-2"
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Guardando..." : "Confirmar asignaciones"}
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
