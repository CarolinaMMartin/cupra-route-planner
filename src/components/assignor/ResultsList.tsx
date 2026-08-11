import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star, Calendar, Lightbulb } from "lucide-react";
import { Sucursal } from "@/types/sales";

interface ResultsListProps {
  sucursales: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

const ResultsList = ({ sucursales, selectedIds, onToggle }: ResultsListProps) => {
  return (
    <div className="space-y-3">
      {sucursales.map((sucursal) => (
        <Card
          key={sucursal.id}
          className="p-4 hover-lift cursor-pointer"
          onClick={() => onToggle(sucursal.id)}
        >
          <div className="flex items-start gap-4">
            <Checkbox
              checked={selectedIds.includes(sucursal.id)}
              onCheckedChange={() => onToggle(sucursal.id)}
              className="mt-1"
            />
            
            <div className="flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-sans font-semibold text-lg">{sucursal.nombre}</h3>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {sucursal.direccion}
                  </p>
                </div>
                <Badge variant={sucursal.tipo_cliente === 'Premium' ? 'default' : 'secondary'}>
                  {sucursal.tipo_cliente}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-accent" />
                  Score: {sucursal.score}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-accent" />
                  {sucursal.dias_sin_visita} días sin visita
                </span>
              </div>

              {sucursal.justificacion && (
                <div className="bg-muted/50 p-3 rounded-md flex gap-2">
                  <Lightbulb className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">{sucursal.justificacion}</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default ResultsList;
