import { useState, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

interface Cliente {
  client_id: string;
  razon_social: string;
  cuit_dni: string;
  barrio_principal?: string;
  provincia_principal?: string;
  vendedor_principal?: string;
  categoria_volumen?: string;
  score_comercial?: number;
  dias_desde_ultima_compra?: number;
}

interface Assignment {
  id: string;
  vendedor_id: string;
  client_id: string;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente: Cliente;
}

interface EditAssignmentsKanbanProps {
  selectedAssignments: Assignment[];
  onBack: () => void;
  onComplete?: () => void;
}

const EditAssignmentsKanban = ({
  selectedAssignments,
  onBack,
  onComplete,
}: EditAssignmentsKanbanProps) => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [clientesMap, setClientesMap] = useState<Map<string, Cliente>>(new Map());
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  useEffect(() => {
    fetchVendedores();
  }, []);

  const fetchVendedores = async () => {
    try {
      // Obtener TODOS los vendedores activos
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, nombre, email")
        .eq("rol", "vendedor")
        .eq("activo", true);

      if (error) throw error;

      const mappedVendedores = (data || []).map((v) => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email,
      }));

      setVendedores(mappedVendedores);

      // Crear mapa de clientes
      const clientMap = new Map<string, Cliente>();
      selectedAssignments.forEach(assignment => {
        clientMap.set(assignment.client_id, assignment.cliente);
      });
      setClientesMap(clientMap);

      // Inicializar asignaciones: colocar cada cliente en la columna de su vendedor actual
      const newAssignments: Record<string, string[]> = {};

      // Inicializar todas las columnas de vendedores
      mappedVendedores.forEach((v) => {
        newAssignments[v.id] = [];
      });

      // Distribuir clientes en sus columnas actuales
      selectedAssignments.forEach((assignment) => {
        if (newAssignments[assignment.vendedor_id]) {
          newAssignments[assignment.vendedor_id].push(assignment.client_id);
        }
      });

      setAssignments(newAssignments);
    } catch (error) {
      console.error("Error fetching vendedores:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar vendedores",
      });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // Encontrar de qué columna viene
    let fromColumn: string | null = null;
    for (const [columnId, items] of Object.entries(assignments)) {
      if (items.includes(activeId)) {
        fromColumn = columnId;
        break;
      }
    }

    if (fromColumn && fromColumn !== overId) {
      setAssignments((prev) => ({
        ...prev,
        [fromColumn]: prev[fromColumn].filter((id) => id !== activeId),
        [overId]: [...(prev[overId] || []), activeId],
      }));
    }

    setActiveId(null);
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Recolectar todas las asignaciones actuales para estos clientes
      const allClientIds = Array.from(clientesMap.keys());

      // Primero, eliminar todas las asignaciones existentes de estos clientes
      const { error: deleteError } = await supabase
        .from("asignaciones_vendedores_clientes")
        .delete()
        .in("client_id", allClientIds);

      if (deleteError) throw deleteError;

      // Crear nuevas asignaciones
      const newAssignments = [];
      const assignedPairs = new Set<string>();

      for (const [vendedorId, clientIds] of Object.entries(assignments)) {
        for (const clientId of clientIds) {
          const pairKey = `${vendedorId}-${clientId}`;
          if (!assignedPairs.has(pairKey)) {
            assignedPairs.add(pairKey);
            newAssignments.push({
              vendedor_id: vendedorId,
              client_id: clientId,
              es_prospecto: false,
            });
          }
        }
      }

      if (newAssignments.length > 0) {
        const { error } = await supabase
          .from("asignaciones_vendedores_clientes")
          .insert(newAssignments);

        if (error) throw error;
      }

      toast({
        title: "Asignaciones actualizadas",
        description: `Se modificaron ${newAssignments.length} asignaciones exitosamente`,
      });

      if (onComplete) {
        onComplete();
      } else {
        onBack();
      }
    } catch (error) {
      console.error("Error saving assignments:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al guardar las asignaciones",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const DraggableCard = ({ clientId }: { clientId: string }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: clientId,
    });

    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        }
      : undefined;

    const cliente = clientesMap.get(clientId);
    if (!cliente) return null;

    return (
      <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
        <div className={`cursor-move transition-all ${isDragging ? "opacity-50" : ""}`}>
          <Card className="p-3">
            <div className="space-y-2">
              <div>
                <p className="font-semibold text-sm">{cliente.razon_social}</p>
                <p className="text-xs text-muted-foreground">CUIT: {cliente.cuit_dni}</p>
              </div>
              {cliente.barrio_principal && (
                <p className="text-xs text-muted-foreground">📍 {cliente.barrio_principal}</p>
              )}
              {cliente.categoria_volumen && (
                <Badge variant="secondary" className="text-xs">
                  {cliente.categoria_volumen}
                </Badge>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const ClientCard = ({ clientId }: { clientId: string }) => {
    const cliente = clientesMap.get(clientId);
    if (!cliente) return null;

    return (
      <Card className="p-3">
        <div className="space-y-2">
          <div>
            <p className="font-semibold text-sm">{cliente.razon_social}</p>
            <p className="text-xs text-muted-foreground">CUIT: {cliente.cuit_dni}</p>
          </div>
          {cliente.barrio_principal && (
            <p className="text-xs text-muted-foreground">📍 {cliente.barrio_principal}</p>
          )}
          {cliente.categoria_volumen && (
            <Badge variant="secondary" className="text-xs">
              {cliente.categoria_volumen}
            </Badge>
          )}
        </div>
      </Card>
    );
  };

  const DroppableColumn = ({ id, title, count }: { id: string; title: string; count: number }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: id,
    });

    const items = assignments[id] || [];

    return (
      <Card className="flex-1 min-w-[280px]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{title}</span>
            <Badge variant="secondary">{count}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent
          ref={setNodeRef}
          className={`space-y-2 min-h-[400px] max-h-[600px] overflow-y-auto transition-colors ${
            isOver ? "bg-accent/10" : ""
          }`}
        >
          {items.map((clientId) => (
            <DraggableCard key={clientId} clientId={clientId} />
          ))}
          {items.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Arrastra clientes aquí
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Volver a la selección
        </Button>

        <Button onClick={handleSave} disabled={isLoading} size="lg" className="gap-2">
          <Save className="w-4 h-4" />
          Guardar cambios
        </Button>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {vendedores.map((vendedor) => (
            <DroppableColumn
              key={vendedor.id}
              id={vendedor.id}
              title={vendedor.nombre}
              count={assignments[vendedor.id]?.length || 0}
            />
          ))}
        </div>

        <DragOverlay>{activeId ? <ClientCard clientId={activeId} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
};

export default EditAssignmentsKanban;
