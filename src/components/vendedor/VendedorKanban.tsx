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
  client_id: string;
  estado: 'Asignado' | 'Por visitar' | 'Visitado';
  razon_social: string;
  cuit_dni: string;
  barrio_principal?: string;
  dias_desde_ultima_compra?: number;
}

interface ClienteInfo {
  razon_social: string;
  cuit_dni: string;
  // Scores
  score_comercial?: string;
  score_recencia?: string;
  score_volumen?: string;
  score_volumen_num?: number;
  score_recencia_num?: number;
  priority_score?: number;
  // Ubicación
  provincias?: string[];
  ciudades?: string[];
  telefonos?: string[];
  // Ventas
  orders_count?: number;
  monto_total_vendido?: number;
  avg_ticket?: number;
  participacion?: number;
  // Fechas
  first_purchase_at?: string;
  last_purchase_at?: string;
  days_since_last_purchase?: number;
  // Productos y vendedores
  etiquetas?: string[];
  vendedores?: string[];
  // Feedback
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
          client_id,
          estado,
          clientes (
            razon_social,
            cuit_dni,
            barrio_principal,
            dias_desde_ultima_compra
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
          client_id: asig.client_id,
          estado: asig.estado,
          razon_social: asig.clientes?.razon_social || 'Sin nombre',
          cuit_dni: asig.clientes?.cuit_dni || '',
          barrio_principal: asig.clientes?.barrio_principal,
          dias_desde_ultima_compra: asig.clientes?.dias_desde_ultima_compra,
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
      // Obtener información completa del cliente desde clientes_recomendaciones_temporal
      const { data: clienteData, error: clienteError } = await supabase
        .from('clientes_recomendaciones_temporal')
        .select('*')
        .eq('cuit_dni', cliente.cuit_dni)
        .limit(1)
        .single();

      if (clienteError) {
        console.error('Error fetching cliente info:', clienteError);
      }

      // Obtener el último feedback del cliente
      const { data: feedbackData, error: feedbackError } = await supabase
        .from('cliente_feedbacks')
        .select('feedback')
        .eq('client_id', cliente.client_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (feedbackError) {
        console.error('Error fetching feedback:', feedbackError);
      }

      const info: ClienteInfo = {
        razon_social: cliente.razon_social,
        cuit_dni: cliente.cuit_dni,
        score_comercial: clienteData?.score_comercial,
        score_recencia: clienteData?.score_recencia,
        score_volumen: clienteData?.score_volumen,
        score_volumen_num: clienteData?.score_volumen_num,
        score_recencia_num: clienteData?.score_recencia_num,
        priority_score: clienteData?.priority_score,
        orders_count: clienteData?.orders_count,
        monto_total_vendido: clienteData?.monto_total_vendido,
        avg_ticket: clienteData?.avg_ticket,
        participacion: clienteData?.participacion,
        first_purchase_at: clienteData?.first_purchase_at,
        last_purchase_at: clienteData?.last_purchase_at,
        days_since_last_purchase: clienteData?.days_since_last_purchase,
        provincias: clienteData?.provincias,
        ciudades: clienteData?.ciudades,
        telefonos: clienteData?.telefonos,
        etiquetas: clienteData?.etiquetas,
        vendedores: clienteData?.vendedores,
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
          client_id: selectedCliente.client_id,
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
            <div className="flex items-center justify-between pt-1">
              {cliente.barrio_principal && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {cliente.barrio_principal}
                </p>
              )}
              {cliente.dias_desde_ultima_compra !== undefined && (
                <Badge variant="outline" className="text-xs">
                  {cliente.dias_desde_ultima_compra} días sin compra
                </Badge>
              )}
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
          <div className="flex items-center justify-between pt-1">
            {cliente.barrio_principal && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {cliente.barrio_principal}
              </p>
            )}
            {cliente.dias_desde_ultima_compra !== undefined && (
              <Badge variant="outline" className="text-xs">
                {cliente.dias_desde_ultima_compra} días sin compra
              </Badge>
            )}
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
            <div className="space-y-6">
              {/* Información básica */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Información de Contacto</h3>
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
              </div>

              {/* Scores */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Scores</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {clienteInfo.score_comercial && (
                    <Badge variant="outline" className="justify-center py-2">
                      Comercial: {clienteInfo.score_comercial}
                    </Badge>
                  )}
                  {clienteInfo.score_recencia && (
                    <Badge variant="outline" className="justify-center py-2">
                      Recencia: {clienteInfo.score_recencia}
                    </Badge>
                  )}
                  {clienteInfo.score_volumen && (
                    <Badge variant="outline" className="justify-center py-2">
                      Volumen: {clienteInfo.score_volumen}
                    </Badge>
                  )}
                  {clienteInfo.priority_score !== undefined && (
                    <Badge variant="secondary" className="justify-center py-2">
                      Prioridad: {clienteInfo.priority_score}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Métricas de ventas */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Historial de Ventas</h3>
                <div className="grid grid-cols-2 gap-4">
                  {clienteInfo.orders_count !== undefined && (
                    <div className="flex items-start gap-2">
                      <Package className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Órdenes</p>
                        <p className="text-lg font-bold">{clienteInfo.orders_count}</p>
                      </div>
                    </div>
                  )}
                  {clienteInfo.monto_total_vendido !== undefined && (
                    <div className="flex items-start gap-2">
                      <TrendingUp className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Total vendido</p>
                        <p className="text-lg font-bold">
                          ${clienteInfo.monto_total_vendido.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  )}
                  {clienteInfo.avg_ticket !== undefined && (
                    <div className="flex items-start gap-2">
                      <TrendingDown className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Ticket promedio</p>
                        <p className="text-lg font-bold">
                          ${clienteInfo.avg_ticket.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  )}
                  {clienteInfo.participacion !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Participación</p>
                      <p className="text-lg font-bold">{clienteInfo.participacion}%</p>
                    </div>
                  )}
                  {clienteInfo.days_since_last_purchase !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Última compra</p>
                      <p className="text-lg font-bold">hace {clienteInfo.days_since_last_purchase} días</p>
                    </div>
                  )}
                  {clienteInfo.first_purchase_at && (
                    <div>
                      <p className="text-xs text-muted-foreground">Primera compra</p>
                      <p className="text-sm font-semibold">
                        {new Date(clienteInfo.first_purchase_at).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Vendedores previos */}
              {clienteInfo.vendedores && clienteInfo.vendedores.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Vendedores Previos</h3>
                  <div className="flex flex-wrap gap-2">
                    {clienteInfo.vendedores.map((vendedor, idx) => (
                      <Badge key={idx} variant="secondary">
                        {vendedor}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Productos (Etiquetas) */}
              {clienteInfo.etiquetas && clienteInfo.etiquetas.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Productos Comprados</h3>
                  <div className="max-h-32 overflow-y-auto bg-muted/50 rounded-lg p-3">
                    <div className="flex flex-wrap gap-1">
                      {clienteInfo.etiquetas.map((etiqueta, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {etiqueta}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Último feedback */}
              {clienteInfo.ultimo_feedback && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Último Feedback</h3>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm">{clienteInfo.ultimo_feedback}</p>
                  </div>
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
