import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, Wand2, X } from "lucide-react";
import { Sucursal } from "@/types/sales";

interface Vendedor {
  id: string;
  nombre: string;
}

interface VendedorBarrios {
  [vendedorId: string]: string[];
}

interface AutoAssignByZoneDialogProps {
  vendedores: Vendedor[];
  recommendations: Sucursal[];
  onApplyAssignment: (vendedorBarrios: VendedorBarrios) => void;
}

const AutoAssignByZoneDialog = ({
  vendedores,
  recommendations,
  onApplyAssignment,
}: AutoAssignByZoneDialogProps) => {
  const [open, setOpen] = useState(false);
  const [vendedorBarrios, setVendedorBarrios] = useState<VendedorBarrios>({});
  const [availableBarrios, setAvailableBarrios] = useState<string[]>([]);

  useEffect(() => {
    // Obtener todos los barrios únicos de las recomendaciones
    const barriosSet = new Set<string>();
    recommendations.forEach((rec) => {
      // Primero intentar con barrio_principal
      if (rec.barrio_principal && typeof rec.barrio_principal === 'string' && rec.barrio_principal.trim()) {
        barriosSet.add(rec.barrio_principal.trim());
      }
      // También incluir todos_barrios si existe
      if (rec.todos_barrios && Array.isArray(rec.todos_barrios) && rec.todos_barrios.length > 0) {
        rec.todos_barrios.forEach((b) => {
          if (b && typeof b === 'string' && b.trim()) {
            barriosSet.add(b.trim());
          }
        });
      }
    });
    setAvailableBarrios(Array.from(barriosSet).sort());
  }, [recommendations]);

  const handleToggleBarrio = (vendedorId: string, barrio: string) => {
    setVendedorBarrios((prev) => {
      const currentBarrios = prev[vendedorId] || [];
      const isSelected = currentBarrios.includes(barrio);

      return {
        ...prev,
        [vendedorId]: isSelected
          ? currentBarrios.filter((b) => b !== barrio)
          : [...currentBarrios, barrio],
      };
    });
  };

  const handleRemoveVendedorBarrio = (vendedorId: string, barrio: string) => {
    setVendedorBarrios((prev) => ({
      ...prev,
      [vendedorId]: (prev[vendedorId] || []).filter((b) => b !== barrio),
    }));
  };

  const handleApply = () => {
    onApplyAssignment(vendedorBarrios);
    setOpen(false);
  };

  const handleClear = () => {
    setVendedorBarrios({});
  };

  const getClientCountByBarrio = (barrio: string) => {
    return recommendations.filter((rec) => {
      if (rec.barrio_principal === barrio) return true;
      if (rec.todos_barrios && Array.isArray(rec.todos_barrios)) {
        return rec.todos_barrios.includes(barrio);
      }
      return false;
    }).length;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Wand2 className="w-4 h-4" />
          Asignación automática por zona
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Asignación automática por zona</DialogTitle>
          <DialogDescription>
            Asigna barrios a cada vendedor. Los clientes se asignarán automáticamente según su ubicación.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 max-h-[60vh]">
          <div className="space-y-4 pb-4">
            {vendedores.map((vendedor) => (
              <Card key={vendedor.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{vendedor.nombre}</CardTitle>
                    <Badge variant="secondary">
                      {vendedorBarrios[vendedor.id]?.length || 0} barrios
                    </Badge>
                  </div>
                  {vendedorBarrios[vendedor.id] && vendedorBarrios[vendedor.id].length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {vendedorBarrios[vendedor.id].map((barrio) => (
                        <Badge
                          key={barrio}
                          variant="default"
                          className="gap-1 cursor-pointer hover:bg-destructive"
                          onClick={() => handleRemoveVendedorBarrio(vendedor.id, barrio)}
                        >
                          <MapPin className="w-3 h-3" />
                          {barrio}
                          <X className="w-3 h-3" />
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {availableBarrios.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay barrios disponibles en las recomendaciones actuales
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                      {availableBarrios.map((barrio) => {
                        const isSelected = vendedorBarrios[vendedor.id]?.includes(barrio);
                        const clientCount = getClientCountByBarrio(barrio);
                        
                        return (
                          <div
                            key={barrio}
                            className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent cursor-pointer"
                            onClick={() => handleToggleBarrio(vendedor.id, barrio)}
                          >
                            <Checkbox
                              id={`${vendedor.id}-${barrio}`}
                              checked={isSelected}
                              onCheckedChange={() => handleToggleBarrio(vendedor.id, barrio)}
                            />
                            <label
                              htmlFor={`${vendedor.id}-${barrio}`}
                              className="flex-1 text-sm cursor-pointer flex items-center justify-between"
                            >
                              <span>{barrio}</span>
                              <Badge variant="outline" className="ml-2">
                                {clientCount}
                              </Badge>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-between gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleClear}>
            Limpiar todo
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleApply}>
              Aplicar asignación
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutoAssignByZoneDialog;
