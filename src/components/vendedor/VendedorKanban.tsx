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
import { MapPin, Phone, Building } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ClienteAsignado {
  id: string;
  cliente_id: string;
  estado: 'Asignado' | 'Por visitar' | 'Visitado';
  razon_social: string;
  cuit_dni: string;
}

const VendedorKanban = () => {
  const [assignments, setAssignments] = useState<Record<string, ClienteAsignado[]>>({
    'Asignado': [],
    'Por visitar': [],
    'Visitado': [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    fetchAsignaciones();
  }, []);

  const fetchAsignaciones = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Obtener asignaciones del vendedor con información del cliente
      const { data: asignaciones, error } = await supabase
        .from('asignaciones_vendedores_clientes')
        .select(`
          id,
          cliente_id,
          estado,
          clientes (
            razon_social,
            cuit_dni
          )
        `)
        .eq('vendedor_id', user.id);

      if (error) throw error;

      // Agrupar por estado
      const grouped: Record<string, ClienteAsignado[]> = {
        'Asignado': [],
        'Por visitar': [],
        'Visitado': [],
      };

      (asignaciones || []).forEach((asig: any) => {
        const cliente: ClienteAsignado = {
          id: asig.id,
          cliente_id: asig.cliente_id,
          estado: asig.estado,
          razon_social: asig.clientes?.razon_social || 'Sin nombre',
          cuit_dni: asig.clientes?.cuit_dni || '',
        };
        grouped[asig.estado].push(cliente);
      });

      setAssignments(grouped);
    } catch (error) {
      console.error('Error fetching asignaciones:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar las asignaciones",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setActiveId(null);
      return;
    }

    const activeId = active.id as string;
    const newEstado = over.id as 'Asignado' | 'Por visitar' | 'Visitado';

    // Encontrar de qué columna viene
    let fromColumn: string | null = null;
    let movedCliente: ClienteAsignado | null = null;

    for (const [columnId, clientes] of Object.entries(assignments)) {
      const found = clientes.find(c => c.id === activeId);
      if (found) {
        fromColumn = columnId;
        movedCliente = found;
        break;
      }
    }

    if (fromColumn && movedCliente && fromColumn !== newEstado) {
      // Actualizar UI optimistamente
      setAssignments(prev => ({
        ...prev,
        [fromColumn]: prev[fromColumn].filter(c => c.id !== activeId),
        [newEstado]: [...prev[newEstado], { ...movedCliente!, estado: newEstado }],
      }));

      // Actualizar en la base de datos
      try {
        const { error } = await supabase
          .from('asignaciones_vendedores_clientes')
          .update({ estado: newEstado })
          .eq('id', activeId);

        if (error) throw error;

        toast({
          title: "Estado actualizado",
          description: `Cliente movido a "${newEstado}"`,
        });
      } catch (error) {
        console.error('Error updating estado:', error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Error al actualizar el estado",
        });
        // Revertir cambio en caso de error
        fetchAsignaciones();
      }
    }

    setActiveId(null);
  };

  const DraggableCard = ({ cliente }: { cliente: ClienteAsignado }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: cliente.id,
    });

    const style = transform ? {
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    return (
      <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
        <Card className={`p-3 cursor-move transition-all ${isDragging ? 'opacity-50' : 'hover-lift'}`}>
          <div className="space-y-2">
            <div>
              <h4 className="font-semibold text-sm">{cliente.razon_social}</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building className="w-3 h-3" />
                {cliente.cuit_dni}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const ClientCard = ({ cliente }: { cliente: ClienteAsignado }) => {
    return (
      <Card className="p-3">
        <div className="space-y-2">
          <div>
            <h4 className="font-semibold text-sm">{cliente.razon_social}</h4>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Building className="w-3 h-3" />
              {cliente.cuit_dni}
            </p>
          </div>
        </div>
      </Card>
    );
  };

  const DroppableColumn = ({ 
    id, 
    title, 
    clientes 
  }: { 
    id: string; 
    title: string; 
    clientes: ClienteAsignado[];
  }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: id,
    });

    return (
      <Card className="flex-1 min-w-[280px]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{title}</span>
            <Badge variant="secondary">{clientes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent 
          ref={setNodeRef}
          className={`space-y-2 min-h-[400px] max-h-[600px] overflow-y-auto transition-colors ${
            isOver ? 'bg-accent/10' : ''
          }`}
        >
          {clientes.map(cliente => (
            <DraggableCard key={cliente.id} cliente={cliente} />
          ))}
          {clientes.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Sin clientes
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando asignaciones...</p>
      </div>
    );
  }

  const activeCliente = activeId 
    ? Object.values(assignments).flat().find(c => c.id === activeId)
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Mis Clientes Asignados</h2>
        <p className="text-muted-foreground">Arrastra los clientes entre columnas para actualizar su estado</p>
      </div>

      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          <DroppableColumn 
            id="Asignado" 
            title="Asignado" 
            clientes={assignments['Asignado']} 
          />
          <DroppableColumn 
            id="Por visitar" 
            title="Por visitar" 
            clientes={assignments['Por visitar']} 
          />
          <DroppableColumn 
            id="Visitado" 
            title="Visitado" 
            clientes={assignments['Visitado']} 
          />
        </div>

        <DragOverlay>
          {activeCliente ? <ClientCard cliente={activeCliente} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default VendedorKanban;
