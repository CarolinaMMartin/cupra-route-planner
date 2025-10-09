import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star, Calendar, Lightbulb, ArrowRight } from "lucide-react";
import { Sucursal } from "@/types/sales";

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
          <Card
            key={recomendacion.id}
            className="p-4 hover-lift cursor-pointer transition-all"
            onClick={() => onToggle(recomendacion.id)}
          >
            <div className="flex items-start gap-4">
              <Checkbox
                checked={selectedIds.includes(recomendacion.id)}
                onCheckedChange={() => onToggle(recomendacion.id)}
                className="mt-1"
              />
              
              <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-serif font-semibold text-lg">{recomendacion.nombre}</h3>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {recomendacion.direccion}
                    </p>
                  </div>
                  <Badge variant={recomendacion.tipo_cliente === 'Premium' ? 'default' : 'secondary'}>
                    {recomendacion.tipo_cliente}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-accent" />
                    Score: {recomendacion.score}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-accent" />
                    {recomendacion.dias_sin_visita} días sin visita
                  </span>
                </div>

                {recomendacion.justificacion && (
                  <div className="bg-muted/50 p-3 rounded-md flex gap-2">
                    <Lightbulb className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">{recomendacion.justificacion}</p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default PreselectionStep;
