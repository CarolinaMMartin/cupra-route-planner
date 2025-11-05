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
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ClientDetailCard from "./ClientDetailCard";

interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

interface KanbanAssignmentProps {
  selectedRecommendations: Sucursal[];
  selectedVendedoresIds: string[];
  onBack: () => void;
  onComplete?: () => void;
}

const KanbanAssignment = ({
  selectedRecommendations,
  selectedVendedoresIds,
  onBack,
  onComplete,
}: KanbanAssignmentProps) => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({
    unassigned: [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
      // Obtener TODOS los vendedores activos registrados
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

      // Crear un mapa de nombres a IDs de vendedores (normalizado para comparación)
      const nombreToIdMap = new Map<string, string>();
      mappedVendedores.forEach((v) => {
        nombreToIdMap.set(v.nombre.toUpperCase().trim(), v.id);
      });

      // Inicializar asignaciones: pre-asignar clientes a sus vendedores
      const newAssignments: Record<string, string[]> = {
        unassigned: [],
      };

      // Inicializar columnas de vendedores
      mappedVendedores.forEach((v) => {
        newAssignments[v.id] = [];
      });

      // Pre-asignar cada cliente según sus vendedores
      selectedRecommendations.forEach((rec) => {
        let assigned = false;

        // Intentar asignar por vendedor_principal primero
        if (rec.vendedor_principal) {
          const vendedorId = nombreToIdMap.get(rec.vendedor_principal.toUpperCase().trim());
          if (vendedorId && newAssignments[vendedorId]) {
            newAssignments[vendedorId].push(rec.id);
            assigned = true;
          }
        }

        // Si no se asignó, intentar con el array de vendedores
        if (!assigned && rec.vendedores && Array.isArray(rec.vendedores) && rec.vendedores.length > 0) {
          for (const vendedorNombre of rec.vendedores) {
            const vendedorId = nombreToIdMap.get(vendedorNombre.toUpperCase().trim());
            if (vendedorId && newAssignments[vendedorId]) {
              newAssignments[vendedorId].push(rec.id);
              assigned = true;
              break;
            }
          }
        }

        // Si no se pudo asignar, va a "Sin asignar"
        if (!assigned) {
          newAssignments.unassigned.push(rec.id);
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

  const handleAutoAssignByZone = (vendedorBarrios: Record<string, string[]>) => {
    // Crear un nuevo objeto de asignaciones empezando desde el estado actual
    const newAssignments = { ...assignments };

    // Para cada cliente en las recomendaciones
    selectedRecommendations.forEach((rec) => {
      const clientBarrios: string[] = [];

      // Recopilar todos los barrios del cliente
      if (rec.barrio_principal) {
        clientBarrios.push(rec.barrio_principal);
      }
      if (rec.todos_barrios && Array.isArray(rec.todos_barrios)) {
        clientBarrios.push(...rec.todos_barrios);
      }

      // Buscar si algún vendedor tiene asignado alguno de los barrios del cliente
      let assignedVendedor: string | null = null;

      for (const [vendedorId, barrios] of Object.entries(vendedorBarrios)) {
        if (barrios.some((b) => clientBarrios.includes(b))) {
          assignedVendedor = vendedorId;
          break;
        }
      }

      if (assignedVendedor) {
        // Remover el cliente de todas las columnas
        Object.keys(newAssignments).forEach((columnId) => {
          newAssignments[columnId] = newAssignments[columnId].filter((id) => id !== rec.id);
        });

        // Asignar al vendedor correspondiente
        if (!newAssignments[assignedVendedor].includes(rec.id)) {
          newAssignments[assignedVendedor].push(rec.id);
        }
      }
    });

    setAssignments(newAssignments);

    toast({
      title: "Asignación automática aplicada",
      description: "Los clientes fueron asignados según sus zonas",
    });
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
      // Mapear recomendaciones a cliente_id o prospecto_place_id
      const cuitDniMap = new Map<string, string>();
      const prospectoMap = new Map<string, string>(); // recomendacion_id -> prospecto_place_id
      
      selectedRecommendations.forEach((rec) => {
        if (rec.es_prospecto && rec.prospecto_place_id) {
          prospectoMap.set(rec.id, rec.prospecto_place_id);
        } else if (rec.cuit_dni) {
          cuitDniMap.set(rec.id, rec.cuit_dni);
        }
      });

      // Buscar los client_id correspondientes para clientes normales
      const cuitDnis = Array.from(cuitDniMap.values());
      let clienteIdMap = new Map<string, string>();
      
      if (cuitDnis.length > 0) {
        const { data: clientes, error: clientesError } = await supabase
          .from("clientes")
          .select("client_id, cuit_dni")
          .in("cuit_dni", cuitDnis);

        if (clientesError) throw clientesError;

        // Crear mapa de cuit_dni a client_id
        (clientes || []).forEach((cliente) => {
          clienteIdMap.set(cliente.cuit_dni, cliente.client_id);
        });
      }

      // Mapear recomendacion_id a cliente_id
      const recomendacionToClienteMap = new Map<string, string>();
      selectedRecommendations.forEach((rec) => {
        if (!rec.es_prospecto && rec.cuit_dni) {
          const clienteId = clienteIdMap.get(rec.cuit_dni);
          if (clienteId) {
            recomendacionToClienteMap.set(rec.id, clienteId);
          }
        }
      });

      // Obtener IDs válidos para eliminar asignaciones previas
      const validClienteIds = Array.from(recomendacionToClienteMap.values());
      const validProspectoIds = Array.from(prospectoMap.values());

      // Eliminar asignaciones previas de clientes y prospectos
      if (validClienteIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("asignaciones_vendedores_clientes")
          .delete()
          .in("client_id", validClienteIds);

        if (deleteError) throw deleteError;
      }

      if (validProspectoIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("asignaciones_vendedores_clientes")
          .delete()
          .in("prospecto_place_id", validProspectoIds);

        if (deleteError) throw deleteError;
      }

      // Crear nuevas asignaciones
      const newAssignments = [];
      const assignedPairs = new Set<string>();

      for (const [vendedorId, recomendacionIds] of Object.entries(assignments)) {
        if (vendedorId !== "unassigned") {
          for (const recomendacionId of recomendacionIds) {
            const rec = selectedRecommendations.find(r => r.id === recomendacionId);
            
            if (rec?.es_prospecto && rec.prospecto_place_id) {
              // Asignación de prospecto
              const pairKey = `${vendedorId}-prospecto-${rec.prospecto_place_id}`;
              if (!assignedPairs.has(pairKey)) {
                assignedPairs.add(pairKey);
                newAssignments.push({
                  vendedor_id: vendedorId,
                  prospecto_place_id: rec.prospecto_place_id,
                  es_prospecto: true,
                  client_id: null,
                });
              }
            } else {
              // Asignación de cliente normal
              const clienteId = recomendacionToClienteMap.get(recomendacionId);
              if (clienteId) {
                const pairKey = `${vendedorId}-cliente-${clienteId}`;
                if (!assignedPairs.has(pairKey)) {
                  assignedPairs.add(pairKey);
                  newAssignments.push({
                    vendedor_id: vendedorId,
                    client_id: clienteId,
                    es_prospecto: false,
                    prospecto_place_id: null,
                  });
                }
              }
            }
          }
        }
      }

      if (newAssignments.length > 0) {
        const { error } = await supabase.from("asignaciones_vendedores_clientes").insert(newAssignments);

        if (error) throw error;
      }

      toast({
        title: "Asignaciones guardadas",
        description: `Se asignaron ${newAssignments.length} clientes y prospectos exitosamente`,
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

  const getRecommendation = (id: string) => {
    return selectedRecommendations.find((r) => r.id === id);
  };

  const DraggableCard = ({ id }: { id: string }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: id,
    });

    const recomendacion = getRecommendation(id);
    if (!recomendacion) return null;

    return (
      <div 
        ref={setNodeRef} 
        style={{
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        }}
        {...listeners} 
        {...attributes}
        className={`transition-opacity ${isDragging ? "opacity-30" : ""}`}
      >
        <div className="cursor-move">
          <ClientDetailCard
            cliente={recomendacion}
            isSelected={false}
            onToggle={() => {}}
            showCheckbox={false}
            compact={true}
          />
        </div>
      </div>
    );
  };

  const ClientCard = ({ id }: { id: string }) => {
    const recomendacion = getRecommendation(id);
    if (!recomendacion) return null;

    return (
      <ClientDetailCard
        cliente={recomendacion}
        isSelected={false}
        onToggle={() => {}}
        showCheckbox={false}
        compact={true}
      />
    );
  };

  const DroppableColumn = ({ 
    id, 
    title, 
    count, 
    isUnassigned = false 
  }: { 
    id: string; 
    title: string; 
    count: number;
    isUnassigned?: boolean;
  }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: id,
    });

    const items = assignments[id] || [];

    return (
      <Card className={isUnassigned ? "w-80 flex-shrink-0" : "w-80 flex-shrink-0"}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="truncate">{title}</span>
            <Badge variant="secondary" className="ml-2">{count} cliente{count !== 1 ? 's' : ''}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent
          ref={setNodeRef}
          className={`space-y-2 min-h-[500px] max-h-[calc(100vh-280px)] overflow-y-auto transition-colors ${
            isOver ? "bg-accent/10" : ""
          }`}
        >
          {items.map((itemId) => (
            <DraggableCard key={itemId} id={itemId} />
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Volver a la preselección
          </Button>
        </div>

        <Button onClick={handleSave} disabled={isLoading} size="lg" className="gap-2">
          <Save className="w-4 h-4" />
          Guardar asignaciones
        </Button>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-hidden h-[calc(100vh-220px)]">
          {/* Columna fija de "Sin asignar" */}
          <div className="flex-shrink-0">
            <DroppableColumn 
              id="unassigned" 
              title="Sin asignar" 
              count={assignments.unassigned?.length || 0}
              isUnassigned={true}
            />
          </div>

          {/* Contenedor con scroll horizontal para vendedores */}
          <div className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 flex-1">
            {vendedores.map((vendedor) => (
              <DroppableColumn
                key={vendedor.id}
                id={vendedor.id}
                title={vendedor.nombre}
                count={assignments[vendedor.id]?.length || 0}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeId ? (
            <div className="cursor-grabbing opacity-80">
              <ClientCard id={activeId} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default KanbanAssignment;
