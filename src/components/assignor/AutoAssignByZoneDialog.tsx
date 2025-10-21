import { useState, useEffect, useMemo } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, Wand2, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { Sucursal } from "@/types/sales";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

const AutoAssignByZoneDialog = ({ vendedores, recommendations, onApplyAssignment }: AutoAssignByZoneDialogProps) => {
  const [open, setOpen] = useState(false);
  const [vendedorBarrios, setVendedorBarrios] = useState<VendedorBarrios>({});
  const [availableBarrios, setAvailableBarrios] = useState<string[]>([]);

  // Fallback de barrios cuando no se detectan desde las recomendaciones
  const DEFAULT_BARRIOS = [
    "Belgrano",
    "Palermo",
    "Recoleta",
    "Retiro",
    "Puerto Madero",
  ];

  useEffect(() => {
    const barriosSet = new Set<string>();
    recommendations.forEach((rec) => {
      if (rec.barrio_principal && typeof rec.barrio_principal === "string" && rec.barrio_principal.trim()) {
        barriosSet.add(rec.barrio_principal.trim());
      }
      if (rec.todos_barrios && Array.isArray(rec.todos_barrios) && rec.todos_barrios.length > 0) {
        rec.todos_barrios.forEach((b) => {
          if (b && typeof b === "string" && b.trim()) {
            barriosSet.add(b.trim());
          }
        });
      }
    });
    const barrios = Array.from(barriosSet).sort();
    setAvailableBarrios(barrios.length > 0 ? barrios : DEFAULT_BARRIOS);
  }, [recommendations]);

  const unassignedZones = useMemo(() => {
    const assignedBarrios = new Set<string>();
    Object.values(vendedorBarrios).forEach((barrios) => {
      barrios.forEach((barrio) => assignedBarrios.add(barrio));
    });
    return availableBarrios.filter((barrio) => !assignedBarrios.has(barrio));
  }, [availableBarrios, vendedorBarrios]);

  const totalZones = availableBarrios.length;
  const assignedZones = totalZones - unassignedZones.length;

  const handleAddBarrio = (vendedorId: string, barrio: string) => {
    setVendedorBarrios((prev) => {
      const currentBarrios = prev[vendedorId] || [];
      if (currentBarrios.includes(barrio)) {
        return prev;
      }
      return {
        ...prev,
        [vendedorId]: [...currentBarrios, barrio],
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

  const getAvailableBarriosForVendedor = (vendedorId: string) => {
    const currentBarrios = vendedorBarrios[vendedorId] || [];
    return availableBarrios.filter((barrio) => !currentBarrios.includes(barrio));
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
          <DialogTitle className="text-xl font-semibold">Asignación automática por zona</DialogTitle>
          <DialogDescription className="text-sm">
            Asigna barrios a cada vendedor. Los clientes se asignarán automáticamente según su ubicación.
          </DialogDescription>
        </DialogHeader>

        {/* Estado de asignación */}
        <Alert className={unassignedZones.length === 0 ? "border-green-500/50 bg-green-500/10" : "border-amber-500/50 bg-amber-500/10"}>
          <div className="flex items-center gap-2">
            {unassignedZones.length === 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-700 dark:text-green-300 font-medium">
                  Todas las zonas están asignadas ({assignedZones}/{totalZones})
                </AlertDescription>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-700 dark:text-amber-300 font-medium">
                  Hay {unassignedZones.length} zona{unassignedZones.length !== 1 ? 's' : ''} sin asignar ({assignedZones}/{totalZones} asignadas)
                </AlertDescription>
              </>
            )}
          </div>
        </Alert>

        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-3 pb-4">
            {vendedores.map((vendedor) => {
              const availableOptions = getAvailableBarriosForVendedor(vendedor.id);
              
              return (
                <Card key={vendedor.id} className="border-border/50">
                  <CardHeader className="pb-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold">{vendedor.nombre}</CardTitle>
                      <Badge variant="secondary" className="font-medium">
                        {vendedorBarrios[vendedor.id]?.length || 0} {vendedorBarrios[vendedor.id]?.length === 1 ? 'zona' : 'zonas'}
                      </Badge>
                    </div>

                    {/* Select para agregar zonas */}
                    {availableOptions.length > 0 && (
                      <Select onValueChange={(value) => handleAddBarrio(vendedor.id, value)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="+ Agregar zona" />
                        </SelectTrigger>
                        <SelectContent>
                          <ScrollArea className="h-[200px]">
                            {availableOptions.map((barrio) => {
                              const clientCount = getClientCountByBarrio(barrio);
                              return (
                                <SelectItem key={barrio} value={barrio}>
                                  <div className="flex items-center justify-between w-full gap-4">
                                    <span className="flex items-center gap-2">
                                      <MapPin className="w-3 h-3" />
                                      {barrio}
                                    </span>
                                    <Badge variant="outline" className="ml-auto text-xs">
                                      {clientCount}
                                    </Badge>
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </ScrollArea>
                        </SelectContent>
                      </Select>
                    )}

                    {/* Zonas asignadas */}
                    {vendedorBarrios[vendedor.id] && vendedorBarrios[vendedor.id].length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {vendedorBarrios[vendedor.id].map((barrio) => {
                          const clientCount = getClientCountByBarrio(barrio);
                          return (
                            <Badge
                              key={barrio}
                              variant="default"
                              className="gap-1.5 cursor-pointer hover:bg-destructive transition-colors pr-1"
                              onClick={() => handleRemoveVendedorBarrio(vendedor.id, barrio)}
                            >
                              <MapPin className="w-3 h-3" />
                              <span>{barrio}</span>
                              <span className="text-xs opacity-70">({clientCount})</span>
                              <X className="w-3.5 h-3.5 ml-1 hover:scale-110 transition-transform" />
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </CardHeader>
                </Card>
              );
            })}
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
            <Button onClick={handleApply}>Aplicar asignación</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutoAssignByZoneDialog;
