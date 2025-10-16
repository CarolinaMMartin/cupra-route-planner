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
import { MapPin, Phone, Building, TrendingUp, TrendingDown, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface ClienteAsignado {
  id: string;
  cliente_id: string;
  estado: 'Asignado' | 'Por visitar' | 'Visitado';
  razon_social: string;
  cuit_dni: string;
}

interface ClienteInfo {
  razon_social: string;
  cuit_dni: string;
  score_comercial?: string;
  score_recencia?: string;
  score_volumen?: string;
  orders_count?: number;
  monto_total_vendido?: number;
  avg_ticket?: number;
  days_since_last_purchase?: number;
  provincias?: string[];
  ciudades?: string[];
  telefonos?: string[];
  ultimo_feedback?: string;
}

const VendedorKanban = () => {
  const [assignments, setAssignments] = useState<Record<string, ClienteAsignado[]>>({
    'Asignado': [],
    'Por visitar': [],
    'Visitado': [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<ClienteAsignado | null>(null);
  const [clienteInfo, setClienteInfo] = useState<ClienteInfo | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
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
      // Si se mueve a "Visitado", abrir dialog de feedback
      if (newEstado === 'Visitado') {
        setSelectedCliente(movedCliente);
        setShowFeedbackDialog(true);
        setActiveId(null);
        return;
      }

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

  const handleCardClick = async (cliente: ClienteAsignado) => {
    setSelectedCliente(cliente);
    setIsLoading(true);
    setShowInfoDialog(true);
    
    try {
      // Obtener información completa del cliente desde recomendaciones_ia
      const { data: recomendacion, error: recError } = await supabase
        .from('recomendaciones_ia')
        .select('*')
        .eq('cuit_dni', cliente.cuit_dni)
        .maybeSingle();

      if (recError) throw recError;

      // Obtener el último feedback del cliente
      const { data: feedbackData, error: feedbackError } = await supabase
        .from('cliente_feedbacks')
        .select('feedback')
        .eq('cliente_id', cliente.cliente_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (feedbackError) throw feedbackError;

      const info: ClienteInfo = {
        razon_social: cliente.razon_social,
        cuit_dni: cliente.cuit_dni,
        score_comercial: recomendacion?.score_comercial,
        score_recencia: recomendacion?.score_recencia,
        score_volumen: recomendacion?.score_volumen,
        orders_count: recomendacion?.orders_count,
        monto_total_vendido: recomendacion?.monto_total_vendido,
        avg_ticket: recomendacion?.avg_ticket,
        days_since_last_purchase: recomendacion?.days_since_last_purchase,
        provincias: recomendacion?.provincias,
        ciudades: recomendacion?.ciudades,
        telefonos: recomendacion?.telefonos,
        ultimo_feedback: feedbackData?.feedback,
      };

      setClienteInfo(info);
    } catch (error) {
      console.error('Error fetching cliente info:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar la información del cliente",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveFeedback = async () => {
    if (!selectedCliente || !feedback.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor ingrese un feedback",
      });
      return;
    }

    setIsSavingFeedback(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      // Guardar feedback
      const { error: feedbackError } = await supabase
        .from('cliente_feedbacks')
        .insert({
          cliente_id: selectedCliente.cliente_id,
          vendedor_id: user.id,
          feedback: feedback.trim(),
        });

      if (feedbackError) throw feedbackError;

      // Actualizar estado a "Visitado"
      const { error: updateError } = await supabase
        .from('asignaciones_vendedores_clientes')
        .update({ estado: 'Visitado' })
        .eq('id', selectedCliente.id);

      if (updateError) throw updateError;

      // Actualizar UI
      setAssignments(prev => {
        const fromColumn = Object.entries(prev).find(([_, clientes]) => 
          clientes.some(c => c.id === selectedCliente.id)
        )?.[0];

        if (!fromColumn) return prev;

        return {
          ...prev,
          [fromColumn]: prev[fromColumn].filter(c => c.id !== selectedCliente.id),
          'Visitado': [...prev['Visitado'], { ...selectedCliente, estado: 'Visitado' }],
        };
      });

      toast({
        title: "Feedback guardado",
        description: "El feedback ha sido guardado exitosamente",
      });

      setShowFeedbackDialog(false);
      setFeedback("");
      setSelectedCliente(null);
    } catch (error) {
      console.error('Error saving feedback:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al guardar el feedback",
      });
    } finally {
      setIsSavingFeedback(false);
    }
  };

  const DraggableCard = ({ cliente }: { cliente: ClienteAsignado }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: cliente.id,
    });

    const style = transform ? {
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    return (
      <div ref={setNodeRef} style={style}>
        <Card 
          className={`p-3 cursor-move transition-all ${isDragging ? 'opacity-50' : 'hover-lift'}`}
          onClick={() => handleCardClick(cliente)}
        >
          <div className="space-y-2" {...listeners} {...attributes}>
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
        <p className="text-muted-foreground">Haz clic en un cliente para ver detalles. Arrastra entre columnas para actualizar su estado</p>
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

      {/* Dialog de información del cliente */}
      <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCliente?.razon_social}</DialogTitle>
            <DialogDescription>Información detallada del cliente</DialogDescription>
          </DialogHeader>
          
          {clienteInfo && (
            <div className="space-y-4">
              {/* Información básica */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">CUIT/DNI</p>
                  <p className="text-sm">{clienteInfo.cuit_dni}</p>
                </div>
                {clienteInfo.telefonos && clienteInfo.telefonos.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Teléfonos</p>
                    <p className="text-sm">{clienteInfo.telefonos.join(', ')}</p>
                  </div>
                )}
              </div>

              {/* Ubicación */}
              {(clienteInfo.provincias || clienteInfo.ciudades) && (
                <div className="grid grid-cols-2 gap-4">
                  {clienteInfo.provincias && clienteInfo.provincias.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Provincia</p>
                      <p className="text-sm">{clienteInfo.provincias.join(', ')}</p>
                    </div>
                  )}
                  {clienteInfo.ciudades && clienteInfo.ciudades.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Ciudad</p>
                      <p className="text-sm">{clienteInfo.ciudades.join(', ')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Scores */}
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Scores</p>
                <div className="grid grid-cols-3 gap-2">
                  {clienteInfo.score_comercial && (
                    <Badge variant="outline">
                      Comercial: {clienteInfo.score_comercial}
                    </Badge>
                  )}
                  {clienteInfo.score_recencia && (
                    <Badge variant="outline">
                      Recencia: {clienteInfo.score_recencia}
                    </Badge>
                  )}
                  {clienteInfo.score_volumen && (
                    <Badge variant="outline">
                      Volumen: {clienteInfo.score_volumen}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Métricas de ventas */}
              <div className="grid grid-cols-2 gap-4">
                {clienteInfo.orders_count !== undefined && (
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Cantidad de órdenes</p>
                      <p className="text-lg font-bold">{clienteInfo.orders_count}</p>
                    </div>
                  </div>
                )}
                {clienteInfo.monto_total_vendido !== undefined && (
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Monto total vendido</p>
                      <p className="text-lg font-bold">
                        ${clienteInfo.monto_total_vendido.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                )}
                {clienteInfo.avg_ticket !== undefined && (
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Ticket promedio</p>
                      <p className="text-lg font-bold">
                        ${clienteInfo.avg_ticket.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                )}
                {clienteInfo.days_since_last_purchase !== undefined && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Días desde última compra</p>
                    <p className="text-lg font-bold">{clienteInfo.days_since_last_purchase}</p>
                  </div>
                )}
              </div>

              {/* Último feedback */}
              {clienteInfo.ultimo_feedback && (
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Último feedback</p>
                  <p className="text-sm">{clienteInfo.ultimo_feedback}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog de feedback */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Feedback de Visita</DialogTitle>
            <DialogDescription>
              Cliente: {selectedCliente?.razon_social}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Textarea
              placeholder="Ingrese sus notas sobre la visita al cliente..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={6}
            />
            
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowFeedbackDialog(false);
                  setFeedback("");
                }}
                disabled={isSavingFeedback}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveFeedback}
                disabled={isSavingFeedback || !feedback.trim()}
              >
                {isSavingFeedback ? "Guardando..." : "Guardar Feedback"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendedorKanban;
