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
  useDraggable
} from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Calendar, ArrowLeft, Save } from "lucide-react";
import { Sucursal } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

interface KanbanAssignmentProps {
  selectedRecommendations: Sucursal[];
  onBack: () => void;
}

const KanbanAssignment = ({ selectedRecommendations, onBack }: KanbanAssignmentProps) => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({
    unassigned: selectedRecommendations.map(r => r.id),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    fetchVendedores();
  }, []);

  const fetchVendedores = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, nombre, email')
        .eq('rol', 'vendedor')
        .eq('activo', true);

      if (error) throw error;

      const mappedVendedores = (data || []).map(v => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email,
      }));

      setVendedores(mappedVendedores);
      
      // Inicializar columnas de vendedores vacías
      const vendedorColumns = mappedVendedores.reduce((acc, v) => {
        acc[v.id] = [];
        return acc;
      }, {} as Record<string, string[]>);
      
      setAssignments(prev => ({
        ...prev,
        ...vendedorColumns,
      }));
    } catch (error) {
      console.error('Error fetching vendedores:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar vendedores activos",
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
      setAssignments(prev => ({
        ...prev,
        [fromColumn]: prev[fromColumn].filter(id => id !== activeId),
        [overId]: [...(prev[overId] || []), activeId],
      }));
    }

    setActiveId(null);
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Mapear recomendaciones a cliente_id usando cuit_dni
      const cuitDniMap = new Map<string, string>();
      selectedRecommendations.forEach(rec => {
        if (rec.cuit_dni) {
          cuitDniMap.set(rec.id, rec.cuit_dni);
        }
      });

      // Buscar los cliente_id correspondientes en la tabla clientes
      const cuitDnis = Array.from(cuitDniMap.values());
      const { data: clientes, error: clientesError } = await supabase
        .from('clientes')
        .select('id, cuit_dni')
        .in('cuit_dni', cuitDnis);

      if (clientesError) throw clientesError;

      // Crear mapa de cuit_dni a cliente_id
      const clienteIdMap = new Map<string, string>();
      (clientes || []).forEach(cliente => {
        clienteIdMap.set(cliente.cuit_dni, cliente.id);
      });

      // Mapear recomendacion_id a cliente_id
      const recomendacionToClienteMap = new Map<string, string>();
      selectedRecommendations.forEach(rec => {
        if (rec.cuit_dni) {
          const clienteId = clienteIdMap.get(rec.cuit_dni);
          if (clienteId) {
            recomendacionToClienteMap.set(rec.id, clienteId);
          }
        }
      });

      // Obtener todos los cliente_ids válidos para eliminar asignaciones anteriores
      const validClienteIds = Array.from(recomendacionToClienteMap.values());
      
      if (validClienteIds.length > 0) {
        await supabase
          .from('asignaciones_vendedores_clientes')
          .delete()
          .in('cliente_id', validClienteIds);
      }

      // Crear nuevas asignaciones
      const newAssignments = [];
      for (const [vendedorId, recomendacionIds] of Object.entries(assignments)) {
        if (vendedorId !== 'unassigned') {
          for (const recomendacionId of recomendacionIds) {
            const clienteId = recomendacionToClienteMap.get(recomendacionId);
            if (clienteId) {
              newAssignments.push({
                vendedor_id: vendedorId,
                cliente_id: clienteId,
              });
            }
          }
        }
      }

      if (newAssignments.length > 0) {
        const { error } = await supabase
          .from('asignaciones_vendedores_clientes')
          .insert(newAssignments);

        if (error) throw error;
      }

      toast({
        title: "Asignaciones guardadas",
        description: `Se asignaron ${newAssignments.length} clientes exitosamente`,
      });
      
      onBack();
    } catch (error) {
      console.error('Error saving assignments:', error);
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
    return selectedRecommendations.find(r => r.id === id);
  };

  const DraggableCard = ({ id }: { id: string }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: id,
    });

    const style = transform ? {
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    const recomendacion = getRecommendation(id);
    if (!recomendacion) return null;

    return (
      <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
        <Card className={`p-3 cursor-move transition-all ${isDragging ? 'opacity-50' : 'hover-lift'}`}>
          <div className="space-y-2">
            <div>
              <h4 className="font-semibold text-sm">{recomendacion.nombre}</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {recomendacion.direccion}
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 text-accent" />
                {recomendacion.score}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-accent" />
                {recomendacion.dias_sin_visita}d
              </span>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const ClientCard = ({ id }: { id: string }) => {
    const recomendacion = getRecommendation(id);
    if (!recomendacion) return null;

    return (
      <Card className="p-3">
        <div className="space-y-2">
          <div>
            <h4 className="font-semibold text-sm">{recomendacion.nombre}</h4>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {recomendacion.direccion}
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 text-accent" />
              {recomendacion.score}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-accent" />
              {recomendacion.dias_sin_visita}d
            </span>
          </div>
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
            isOver ? 'bg-accent/10' : ''
          }`}
        >
          {items.map(itemId => (
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
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Volver a la preselección
        </Button>
        
        <Button onClick={handleSave} disabled={isLoading} size="lg" className="gap-2">
          <Save className="w-4 h-4" />
          Guardar asignaciones
        </Button>
      </div>

      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          <DroppableColumn 
            id="unassigned" 
            title="Sin asignar" 
            count={assignments.unassigned?.length || 0} 
          />
          
          {vendedores.map(vendedor => (
            <DroppableColumn
              key={vendedor.id}
              id={vendedor.id}
              title={vendedor.nombre}
              count={assignments[vendedor.id]?.length || 0}
            />
          ))}
        </div>

        <DragOverlay>
          {activeId ? <ClientCard id={activeId} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default KanbanAssignment;
