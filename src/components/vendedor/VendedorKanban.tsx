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
import { MapPin, Phone, Building, TrendingUp, TrendingDown, Package, Mail, Navigation } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";

interface ClienteAsignado {
  id: string;
  client_id: string;
  estado: 'Por visitar' | 'Visitado';
  razon_social: string;
  cuit_dni: string;
  barrio_principal?: string;
  dias_desde_ultima_compra?: number;
  // Información de contacto y ubicación
  ciudad_principa?: string;
  provincia_principal?: string;
  direccion_principal?: string;
  todas_direcciones?: string[];
  todas_ciudades?: string[];
  todos_barrios?: string[];
  // Información comercial
  primera_compra?: string;
  ultima_compra?: string;
  cantidad_ordenes?: number;
  monto_total_historico?: number;
  ticket_promedio?: number;
  categoria_recencia?: string;
  categoria_volumen?: string;
  score_recencia?: number;
  score_volumen?: number;
  score_comercial?: number;
  participacion_mercado?: number;
  // Productos y vendedores
  productos_comprados?: string[];
  todos_vendedores?: string[];
  etiquetas?: string[];
  canal?: string;
  // Link de Google Maps
  google_maps_link?: string;
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
  const [visitaRealizada, setVisitaRealizada] = useState(false);
  const [motivoNoVisita, setMotivoNoVisita] = useState("");
  const [tipoInteraccion, setTipoInteraccion] = useState("");
  const [actualizarEtiquetaWa, setActualizarEtiquetaWa] = useState("");
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

      // Obtener asignaciones del vendedor con información completa del cliente
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
            dias_desde_ultima_compra,
            ciudad_principa,
            provincia_principal,
            direccion_principal,
            todas_direcciones,
            todas_ciudades,
            todos_barrios,
            primera_compra,
            ultima_compra,
            cantidad_ordenes,
            monto_total_historico,
            ticket_promedio,
            categoria_recencia,
            categoria_volumen,
            score_recencia,
            score_volumen,
            score_comercial,
            participacion_mercado,
            productos_comprados,
            todos_vendedores,
            etiquetas,
            canal
          )
        `)
        .eq('vendedor_id', user.id);

      if (error) throw error;

      // Obtener google_maps_link de client_places para cada cliente
      const clientIds = [...new Set((asignaciones || []).map((a: any) => a.client_id))];
      const { data: placesData } = await supabase
        .from('client_places')
        .select('client_id, google_maps_link')
        .in('client_id', clientIds)
        .eq('is_primary', true);

      const placesMap = new Map(
        (placesData || []).map(p => [p.client_id, p.google_maps_link])
      );

      // Agrupar por estado
      const grouped: Record<string, ClienteAsignado[]> = {
        'Por visitar': [],
        'Visitado': [],
      };

      (asignaciones || []).forEach((asig: any) => {
        // Convertir "Asignado" a "Por visitar"
        const estado = asig.estado === 'Asignado' ? 'Por visitar' : asig.estado;
        
        const cliente: ClienteAsignado = {
          id: asig.id,
          client_id: asig.client_id,
          estado: estado as 'Por visitar' | 'Visitado',
          razon_social: asig.clientes?.razon_social || 'Sin nombre',
          cuit_dni: asig.clientes?.cuit_dni || '',
          barrio_principal: asig.clientes?.barrio_principal,
          dias_desde_ultima_compra: asig.clientes?.dias_desde_ultima_compra,
          ciudad_principa: asig.clientes?.ciudad_principa,
          provincia_principal: asig.clientes?.provincia_principal,
          direccion_principal: asig.clientes?.direccion_principal,
          todas_direcciones: asig.clientes?.todas_direcciones,
          todas_ciudades: asig.clientes?.todas_ciudades,
          todos_barrios: asig.clientes?.todos_barrios,
          primera_compra: asig.clientes?.primera_compra,
          ultima_compra: asig.clientes?.ultima_compra,
          cantidad_ordenes: asig.clientes?.cantidad_ordenes,
          monto_total_historico: asig.clientes?.monto_total_historico,
          ticket_promedio: asig.clientes?.ticket_promedio,
          categoria_recencia: asig.clientes?.categoria_recencia,
          categoria_volumen: asig.clientes?.categoria_volumen,
          score_recencia: asig.clientes?.score_recencia,
          score_volumen: asig.clientes?.score_volumen,
          score_comercial: asig.clientes?.score_comercial,
          participacion_mercado: asig.clientes?.participacion_mercado,
          productos_comprados: asig.clientes?.productos_comprados,
          todos_vendedores: asig.clientes?.todos_vendedores,
          etiquetas: asig.clientes?.etiquetas,
          canal: asig.clientes?.canal,
          google_maps_link: placesMap.get(asig.client_id) || undefined,
        };
        grouped[estado].push(cliente);
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
    const newEstado = over.id as 'Por visitar' | 'Visitado';

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
    setShowInfoDialog(true);
    
    // Ya no necesitamos hacer una query adicional porque tenemos toda la info
    // Solo buscamos el último feedback
    try {
      const { data: feedbackData } = await supabase
        .from('cliente_feedbacks')
        .select('feedback')
        .eq('client_id', cliente.client_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const info: ClienteInfo = {
        razon_social: cliente.razon_social,
        cuit_dni: cliente.cuit_dni,
        ultimo_feedback: feedbackData?.feedback,
      };

      setClienteInfo(info);
    } catch (error) {
      console.error('Error fetching feedback:', error);
    }
  };

  const handleSaveFeedback = async () => {
    if (!selectedCliente || !feedback.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor ingrese un comentario",
      });
      return;
    }

    if (feedback.length > 400) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El comentario no puede exceder 400 caracteres",
      });
      return;
    }

    if (!visitaRealizada && !motivoNoVisita) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor seleccione el motivo de la no visita",
      });
      return;
    }

    if (visitaRealizada && !tipoInteraccion) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor seleccione el tipo de interacción",
      });
      return;
    }

    setIsSavingFeedback(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      // Guardar feedback con todos los campos
      const { error: feedbackError } = await supabase
        .from('cliente_feedbacks')
        .insert({
          client_id: selectedCliente.client_id,
          vendedor_id: user.id,
          feedback: feedback.trim(),
          visita_realizada: visitaRealizada,
          motivo_no_visita: !visitaRealizada ? motivoNoVisita : null,
          tipo_interaccion: visitaRealizada ? tipoInteraccion : null,
          actualizar_etiqueta_wa: actualizarEtiquetaWa || null,
        });

      if (feedbackError) throw feedbackError;

      // Si se realizó la visita, actualizar ultima_visita en clientes
      if (visitaRealizada) {
        const { error: clienteUpdateError } = await supabase
          .from('clientes')
          .update({ ultima_visita: new Date().toISOString() })
          .eq('client_id', selectedCliente.client_id);

        if (clienteUpdateError) throw clienteUpdateError;
      }

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
        description: visitaRealizada 
          ? "El feedback ha sido guardado y la visita registrada. El cliente será recomendado en 15 días."
          : "El feedback ha sido guardado. El cliente será recomendado nuevamente mañana.",
      });

      setShowFeedbackDialog(false);
      setFeedback("");
      setVisitaRealizada(false);
      setMotivoNoVisita("");
      setTipoInteraccion("");
      setActualizarEtiquetaWa("");
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <DialogDescription>Información completa del cliente y contacto</DialogDescription>
          </DialogHeader>
          
          {selectedCliente && (
            <div className="space-y-6">
              {/* Botones de acción rápida */}
              <div className="flex flex-wrap gap-2">
                {selectedCliente.google_maps_link && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.open(selectedCliente.google_maps_link, '_blank');
                    }}
                  >
                    <Navigation className="w-4 h-4 mr-2" />
                    Ver en Mapa
                  </Button>
                )}
              </div>

              {/* Información de contacto y ubicación */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Información de Contacto</h3>
                <div className="grid gap-3">
                  <div className="flex items-start gap-2">
                    <Building className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">CUIT/DNI</p>
                      <p className="text-sm font-medium">{selectedCliente.cuit_dni}</p>
                    </div>
                  </div>

                  {selectedCliente.direccion_principal && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">Dirección Principal</p>
                        <p className="text-sm font-medium">{selectedCliente.direccion_principal}</p>
                        {selectedCliente.barrio_principal && (
                          <p className="text-xs text-muted-foreground">Barrio: {selectedCliente.barrio_principal}</p>
                        )}
                        {selectedCliente.ciudad_principa && selectedCliente.provincia_principal && (
                          <p className="text-xs text-muted-foreground">
                            {selectedCliente.ciudad_principa}, {selectedCliente.provincia_principal}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedCliente.todas_direcciones && selectedCliente.todas_direcciones.length > 1 && (
                    <div className="pl-6">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Otras direcciones:</p>
                      <div className="space-y-1">
                        {selectedCliente.todas_direcciones.slice(0, 3).map((dir, idx) => (
                          <p key={idx} className="text-xs">{dir}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Información comercial */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Información Comercial</h3>
                <div className="grid grid-cols-2 gap-4">
                  {selectedCliente.cantidad_ordenes !== undefined && (
                    <div className="flex items-start gap-2">
                      <Package className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Órdenes</p>
                        <p className="text-lg font-bold">{selectedCliente.cantidad_ordenes}</p>
                      </div>
                    </div>
                  )}
                  {selectedCliente.monto_total_historico !== undefined && (
                    <div className="flex items-start gap-2">
                      <TrendingUp className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Total vendido</p>
                        <p className="text-lg font-bold">
                          ${Number(selectedCliente.monto_total_historico).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  )}
                  {selectedCliente.ticket_promedio !== undefined && (
                    <div className="flex items-start gap-2">
                      <TrendingDown className="w-4 h-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-xs text-muted-foreground">Ticket promedio</p>
                        <p className="text-lg font-bold">
                          ${Number(selectedCliente.ticket_promedio).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  )}
                  {selectedCliente.participacion_mercado !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Participación</p>
                      <p className="text-lg font-bold">{Number(selectedCliente.participacion_mercado).toFixed(2)}%</p>
                    </div>
                  )}
                  {selectedCliente.dias_desde_ultima_compra !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Última compra</p>
                      <p className="text-lg font-bold">hace {selectedCliente.dias_desde_ultima_compra} días</p>
                    </div>
                  )}
                  {selectedCliente.primera_compra && (
                    <div>
                      <p className="text-xs text-muted-foreground">Primera compra</p>
                      <p className="text-sm font-semibold">
                        {new Date(selectedCliente.primera_compra).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Scores */}
              {(selectedCliente.categoria_recencia || selectedCliente.categoria_volumen || selectedCliente.score_comercial) && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Scores</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {selectedCliente.score_comercial && (
                      <Badge variant="outline" className="justify-center py-2">
                        Comercial: {selectedCliente.score_comercial}
                      </Badge>
                    )}
                    {selectedCliente.categoria_recencia && (
                      <Badge variant="outline" className="justify-center py-2">
                        Recencia: {selectedCliente.categoria_recencia}
                      </Badge>
                    )}
                    {selectedCliente.categoria_volumen && (
                      <Badge variant="outline" className="justify-center py-2">
                        Volumen: {selectedCliente.categoria_volumen}
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Vendedores previos */}
              {selectedCliente.todos_vendedores && selectedCliente.todos_vendedores.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Vendedores Previos</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedCliente.todos_vendedores.map((vendedor, idx) => (
                      <Badge key={idx} variant="secondary">
                        {vendedor}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Productos comprados */}
              {selectedCliente.productos_comprados && selectedCliente.productos_comprados.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Productos Comprados Habitualmente</h3>
                  <div className="max-h-32 overflow-y-auto bg-muted/50 rounded-lg p-3">
                    <div className="flex flex-wrap gap-1">
                      {selectedCliente.productos_comprados.map((producto, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {producto}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Etiquetas */}
              {selectedCliente.etiquetas && selectedCliente.etiquetas.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Etiquetas</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedCliente.etiquetas.map((etiqueta, idx) => (
                      <Badge key={idx} variant="secondary">
                        {etiqueta}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Último feedback */}
              {clienteInfo?.ultimo_feedback && (
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
            <div className="flex items-center space-x-2">
              <Checkbox
                id="visitaRealizada"
                checked={visitaRealizada}
                onCheckedChange={(checked) => setVisitaRealizada(checked === true)}
              />
              <label
                htmlFor="visitaRealizada"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Visita realizada: ☐ Sí / ☐ No
              </label>
            </div>

            {!visitaRealizada && (
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Motivo de la No Visita
                </label>
                <select
                  value={motivoNoVisita}
                  onChange={(e) => setMotivoNoVisita(e.target.value)}
                  className="w-full p-2 border rounded-md bg-background"
                >
                  <option value="">Seleccione un motivo...</option>
                  <option value="Local Cerrado / Fuera de Horario">Local Cerrado / Fuera de Horario</option>
                  <option value="No se encontraba el Contacto/Decisor">No se encontraba el Contacto/Decisor</option>
                  <option value="Rechazo de visita">Rechazo de visita</option>
                  <option value="Falta de tiempo (Vendedor)">Falta de tiempo (Vendedor)</option>
                  <option value="Otro (ver notas)">Otro (ver notas)</option>
                </select>
              </div>
            )}

            {visitaRealizada && (
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Propósito Principal
                </label>
                <select
                  value={tipoInteraccion}
                  onChange={(e) => setTipoInteraccion(e.target.value)}
                  className="w-full p-2 border rounded-md bg-background"
                >
                  <option value="">Seleccione el propósito...</option>
                  <option value="Seguimiento / Rutina">Seguimiento / Rutina</option>
                  <option value="Asesoramiento (Carta / Exhibición)">Asesoramiento (Carta / Exhibición)</option>
                  <option value="Gestión de Activación (Degustación / Capacitación)">Gestión de Activación (Degustación / Capacitación)</option>
                  <option value="Presentación de Muestras">Presentación de Muestras</option>
                  <option value="Gestión de Problemas (Entrega / Cobranza)">Gestión de Problemas (Entrega / Cobranza)</option>
                  <option value="Prospección (Visita inicial)">Prospección (Visita inicial)</option>
                </select>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-2 block">
                Actualizar Etiqueta (WhatsApp)
              </label>
              <select
                value={actualizarEtiquetaWa}
                onChange={(e) => setActualizarEtiquetaWa(e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
              >
                <option value="">(No cambiar)</option>
                <option value="Nuevo Pedido">Nuevo Pedido</option>
                <option value="Pago Pendiente">Pago Pendiente</option>
                <option value="Importante (Seguimiento)">Importante (Seguimiento)</option>
                <option value="Cliente Potencial">Cliente Potencial</option>
                <option value="Cliente Perdido">Cliente Perdido</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Comentarios de la visita ({feedback.length}/400)
              </label>
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Ingrese sus comentarios sobre la visita..."
                className="min-h-[100px]"
                maxLength={400}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {visitaRealizada 
                  ? "El cliente será recomendado nuevamente en 15 días"
                  : "El cliente será recomendado nuevamente mañana"}
              </p>
            </div>
            
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowFeedbackDialog(false);
                  setFeedback("");
                  setVisitaRealizada(false);
                  setMotivoNoVisita("");
                  setTipoInteraccion("");
                  setActualizarEtiquetaWa("");
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
