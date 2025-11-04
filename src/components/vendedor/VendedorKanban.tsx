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
import { Label } from "@/components/ui/label";
import ExcludeClientButton from "@/components/assignor/ExcludeClientButton";

interface ClienteAsignado {
  id: string;
  client_id: string;
  estado: 'Por visitar' | 'Visitado';
  razon_social: string;
  cuit_dni: string;
  barrio_principal?: string;
  dias_desde_ultima_compra?: number;
  // Información de contacto y ubicación
  ciudad_principal?: string;
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
  // Información de contacto adicional
  telefonos?: string[];
  emails?: string[];
  // Link de Google Maps
  google_maps_link?: string;
  // Información de prospectos
  website?: string;
  rating?: number;
  nivel_precio?: string;
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

      // Obtener asignaciones del vendedor
      const { data: asignaciones, error } = await supabase
        .from('asignaciones_vendedores_clientes')
        .select('*')
        .eq('vendedor_id', user.id);

      if (error) throw error;

      // Separar clientes y prospectos
      const clienteAsignaciones = asignaciones?.filter(a => !a.es_prospecto) || [];
      const prospectoAsignaciones = asignaciones?.filter(a => a.es_prospecto) || [];

      // Obtener información de clientes
      const clientIds = [...new Set(clienteAsignaciones.map(a => a.client_id))];
      let clientesData: any[] = [];
      
      if (clientIds.length > 0) {
        const { data, error: clientesError } = await supabase
          .from('clientes')
          .select(`
            razon_social,
            cuit_dni,
            barrio_principal,
            dias_desde_ultima_compra,
            ciudad_principal,
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
            canal,
            telefonos,
            emails,
            client_id
          `)
          .in('client_id', clientIds);

        if (clientesError) throw clientesError;
        clientesData = data || [];
      }

      // Obtener información de prospectos
      const prospectoIds = [...new Set(prospectoAsignaciones.map(a => a.prospecto_place_id))];
      let prospectosData: any[] = [];
      
      if (prospectoIds.length > 0) {
        const { data, error: prospectosError } = await supabase
          .from('prospectos')
          .select('*')
          .in('place_id', prospectoIds);

        if (prospectosError) throw prospectosError;
        prospectosData = data || [];
      }

      // Obtener google_maps_link de client_places para clientes
      const { data: placesData } = await supabase
        .from('client_places')
        .select('client_id, google_maps_link')
        .in('client_id', clientIds)
        .eq('is_primary', true);

      const placesMap = new Map(
        (placesData || []).map(p => [p.client_id, p.google_maps_link])
      );

      // Crear mapas para acceso rápido
      const clientesMap = new Map(clientesData.map(c => [c.client_id, c]));
      const prospectosMap = new Map(prospectosData.map(p => [p.place_id, p]));

      // Agrupar por estado
      const grouped: Record<string, ClienteAsignado[]> = {
        'Por visitar': [],
        'Visitado': [],
      };

      // Procesar clientes
      clienteAsignaciones.forEach((asig: any) => {
        const clienteData = clientesMap.get(asig.client_id);
        if (!clienteData) return;

        const estado = asig.estado === 'Asignado' ? 'Por visitar' : asig.estado;
        
        const cliente: ClienteAsignado = {
          id: asig.id,
          client_id: asig.client_id,
          estado: estado as 'Por visitar' | 'Visitado',
          razon_social: clienteData.razon_social || 'Sin nombre',
          cuit_dni: clienteData.cuit_dni || '',
          barrio_principal: clienteData.barrio_principal,
          dias_desde_ultima_compra: clienteData.dias_desde_ultima_compra,
          ciudad_principal: clienteData.ciudad_principal,
          provincia_principal: clienteData.provincia_principal,
          direccion_principal: clienteData.direccion_principal,
          todas_direcciones: clienteData.todas_direcciones,
          todas_ciudades: clienteData.todas_ciudades,
          todos_barrios: clienteData.todos_barrios,
          primera_compra: clienteData.primera_compra,
          ultima_compra: clienteData.ultima_compra,
          cantidad_ordenes: clienteData.cantidad_ordenes,
          monto_total_historico: clienteData.monto_total_historico,
          ticket_promedio: clienteData.ticket_promedio,
          categoria_recencia: clienteData.categoria_recencia,
          categoria_volumen: clienteData.categoria_volumen,
          score_recencia: clienteData.score_recencia,
          score_volumen: clienteData.score_volumen,
          score_comercial: clienteData.score_comercial,
          participacion_mercado: clienteData.participacion_mercado,
          productos_comprados: clienteData.productos_comprados,
          todos_vendedores: clienteData.todos_vendedores,
          etiquetas: clienteData.etiquetas,
          canal: clienteData.canal,
          telefonos: clienteData.telefonos,
          emails: clienteData.emails,
          google_maps_link: placesMap.get(asig.client_id) || undefined,
        };
        grouped[estado].push(cliente);
      });

      // Procesar prospectos
      prospectoAsignaciones.forEach((asig: any) => {
        const prospectoData = prospectosMap.get(asig.prospecto_place_id);
        if (!prospectoData) return;

        const estado = asig.estado === 'Asignado' ? 'Por visitar' : asig.estado;
        
        // Crear google maps link para prospectos
        const googleMapsLink = `https://www.google.com/maps/place/?q=place_id:${prospectoData.place_id}`;
        
        const prospecto: ClienteAsignado = {
          id: asig.id,
          client_id: `prospecto-${asig.prospecto_place_id}`, // ID único para prospectos
          estado: estado as 'Por visitar' | 'Visitado',
          razon_social: prospectoData.nombre || 'Prospecto sin nombre',
          cuit_dni: '',
          barrio_principal: prospectoData.barrio || prospectoData.comuna,
          dias_desde_ultima_compra: undefined,
          ciudad_principal: prospectoData.ciudad,
          provincia_principal: prospectoData.provincia,
          direccion_principal: prospectoData.direccion,
          todas_direcciones: [prospectoData.direccion],
          todas_ciudades: [prospectoData.ciudad],
          todos_barrios: prospectoData.barrio ? [prospectoData.barrio] : [],
          primera_compra: undefined,
          ultima_compra: undefined,
          cantidad_ordenes: 0,
          monto_total_historico: 0,
          ticket_promedio: 0,
          categoria_recencia: 'Prospecto Nuevo',
          categoria_volumen: 'Prospecto',
          score_recencia: 0,
          score_volumen: 0,
          score_comercial: 0,
          participacion_mercado: 0,
          productos_comprados: [],
          todos_vendedores: [],
          etiquetas: ['Prospecto'],
          canal: prospectoData.tipo_principal || 'Prospecto',
          telefonos: prospectoData.telefono ? [prospectoData.telefono] : [],
          emails: [],
          google_maps_link: googleMapsLink,
          website: prospectoData.website,
          rating: prospectoData.rating,
          nivel_precio: prospectoData.nivel_precio,
        };
        grouped[estado].push(prospecto);
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

    const esProspecto = cliente.etiquetas?.includes('Prospecto');

    return (
      <div ref={setNodeRef} style={style}>
        <Card 
          className={`p-3 cursor-move transition-all ${isDragging ? 'opacity-50' : 'hover-lift'}`}
          onClick={() => handleCardClick(cliente)}
        >
          <div className="space-y-2" {...listeners} {...attributes}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-sm flex-1">{cliente.razon_social}</h4>
                {esProspecto && (
                  <Badge variant="secondary" className="text-xs">NUEVO</Badge>
                )}
              </div>
              
              {esProspecto ? (
                // Card para prospectos - vista simple
                <>
                  {cliente.canal && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building className="w-3 h-3" />
                      {cliente.canal}
                    </p>
                  )}
                  {cliente.barrio_principal && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {cliente.barrio_principal}
                    </p>
                  )}
                </>
              ) : (
                // Card para clientes existentes
                <>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building className="w-3 h-3" />
                    {cliente.cuit_dni}
                  </p>
                  {cliente.telefonos && cliente.telefonos.length > 0 && (
                    <a 
                      href={`tel:${cliente.telefonos[0]}`}
                      className="text-xs text-primary flex items-center gap-1 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Phone className="w-3 h-3" />
                      {cliente.telefonos[0]}
                      {cliente.telefonos.length > 1 && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          +{cliente.telefonos.length - 1}
                        </Badge>
                      )}
                    </a>
                  )}
                  {cliente.emails && cliente.emails.length > 0 && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{cliente.emails[0]}</span>
                    </p>
                  )}
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
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const ClientCard = ({ cliente }: { cliente: ClienteAsignado }) => {
    const esProspecto = cliente.etiquetas?.includes('Prospecto');

    return (
      <Card className="p-3">
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm flex-1">{cliente.razon_social}</h4>
              {esProspecto && (
                <Badge variant="secondary" className="text-xs">NUEVO</Badge>
              )}
            </div>
            
            {esProspecto ? (
              <>
                {cliente.canal && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building className="w-3 h-3" />
                    {cliente.canal}
                  </p>
                )}
                {cliente.barrio_principal && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {cliente.barrio_principal}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building className="w-3 h-3" />
                  {cliente.cuit_dni}
                </p>
                {cliente.telefonos && cliente.telefonos.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {cliente.telefonos[0]}
                    {cliente.telefonos.length > 1 && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        +{cliente.telefonos.length - 1}
                      </Badge>
                    )}
                  </p>
                )}
                {cliente.emails && cliente.emails.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{cliente.emails[0]}</span>
                  </p>
                )}
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
              </>
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
            <div className="flex items-center gap-2">
              <DialogTitle className="flex-1">{selectedCliente?.razon_social}</DialogTitle>
              {selectedCliente?.etiquetas?.includes('Prospecto') && (
                <Badge variant="default" className="text-xs">NUEVO</Badge>
              )}
            </div>
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
                  {selectedCliente.cuit_dni && (
                    <div className="flex items-start gap-2">
                      <Building className="w-4 h-4 mt-0.5 text-foreground/60" />
                      <div>
                        <p className="text-xs text-foreground/60">CUIT/DNI</p>
                        <p className="text-sm font-medium">{selectedCliente.cuit_dni}</p>
                      </div>
                    </div>
                  )}

                  {selectedCliente.direccion_principal && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 mt-0.5 text-foreground/60" />
                      <div>
                        <p className="text-xs text-foreground/60">Dirección Principal</p>
                        <p className="text-sm font-medium">{selectedCliente.direccion_principal}</p>
                        {selectedCliente.barrio_principal && (
                          <p className="text-xs text-foreground/60">Barrio: {selectedCliente.barrio_principal}</p>
                        )}
                        {selectedCliente.ciudad_principal && selectedCliente.provincia_principal && (
                          <p className="text-xs text-foreground/60">
                            {selectedCliente.ciudad_principal}, {selectedCliente.provincia_principal}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedCliente.todas_direcciones && selectedCliente.todas_direcciones.length > 1 && (
                    <div className="pl-6">
                      <p className="text-xs font-medium text-foreground/60 mb-1">Otras direcciones:</p>
                      <div className="space-y-1">
                        {selectedCliente.todas_direcciones.slice(0, 3).map((dir, idx) => (
                          <p key={idx} className="text-xs">{dir}</p>
                        ))}
                      </div>
                     </div>
                   )}

                   {selectedCliente.telefonos && selectedCliente.telefonos.length > 0 && (
                     <div className="flex items-start gap-2">
                       <Phone className="w-4 h-4 mt-0.5 text-foreground/60" />
                       <div>
                         <p className="text-xs text-foreground/60">Teléfonos</p>
                         <div className="space-y-1">
                           {selectedCliente.telefonos.map((tel, idx) => (
                             <a 
                               key={idx}
                               href={`tel:${tel}`}
                               className="text-sm font-medium text-primary hover:underline block"
                             >
                               {tel}
                             </a>
                           ))}
                         </div>
                       </div>
                     </div>
                   )}

                   {selectedCliente.website && (
                     <div className="flex items-start gap-2">
                       <span className="text-base mt-0.5">🌐</span>
                       <div>
                         <p className="text-xs text-foreground/60">Sitio Web</p>
                         <a 
                           href={selectedCliente.website.startsWith('http') ? selectedCliente.website : `https://${selectedCliente.website}`}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="text-sm font-medium text-primary hover:underline"
                         >
                           {selectedCliente.website}
                         </a>
                       </div>
                     </div>
                   )}

                   {selectedCliente.rating && selectedCliente.rating > 0 && (
                     <div className="flex items-start gap-2">
                       <span className="text-base mt-0.5">⭐</span>
                       <div>
                         <p className="text-xs text-foreground/60">Valoración en Google</p>
                         <p className="text-sm font-medium">{selectedCliente.rating.toFixed(1)} estrellas</p>
                       </div>
                     </div>
                   )}

                   {selectedCliente.nivel_precio && (
                     <div className="flex items-start gap-2">
                       <span className="text-base mt-0.5">💰</span>
                       <div>
                         <p className="text-xs text-foreground/60">Nivel de Precio</p>
                         <p className="text-sm font-medium">{selectedCliente.nivel_precio}</p>
                       </div>
                     </div>
                   )}

                   {selectedCliente.canal && selectedCliente.etiquetas?.includes('Prospecto') && (
                     <div className="flex items-start gap-2">
                       <Building className="w-4 h-4 mt-0.5 text-foreground/60" />
                       <div>
                         <p className="text-xs text-foreground/60">Tipo de Negocio</p>
                         <p className="text-sm font-medium">{selectedCliente.canal}</p>
                       </div>
                     </div>
                   )}

                   {selectedCliente.emails && selectedCliente.emails.length > 0 && (
                     <div className="flex items-start gap-2">
                       <Mail className="w-4 h-4 mt-0.5 text-foreground/60" />
                       <div>
                         <p className="text-xs text-foreground/60">Emails</p>
                         <p className="text-sm font-medium">{selectedCliente.emails.join(', ')}</p>
                       </div>
                     </div>
                   )}
                 </div>
               </div>

               {/* Información comercial - solo mostrar si hay datos reales */}
              {(selectedCliente.cantidad_ordenes && selectedCliente.cantidad_ordenes > 0) || 
               (selectedCliente.monto_total_historico && selectedCliente.monto_total_historico > 0) ? (
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
              ) : null}

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

              {/* Botón de exclusión */}
              <div className="pt-4 border-t">
                <ExcludeClientButton 
                  clientId={selectedCliente.client_id}
                  clientName={selectedCliente.razon_social}
                  onSuccess={() => {
                    setShowInfoDialog(false);
                    fetchAsignaciones();
                  }}
                  variant="destructive"
                  size="default"
                />
              </div>
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
            <div className="flex items-center space-x-3">
              <Checkbox 
                id="visita-realizada"
                checked={visitaRealizada}
                onCheckedChange={(checked) => setVisitaRealizada(checked === true)}
              />
              <Label htmlFor="visita-realizada" className="text-sm font-medium cursor-pointer">
                Visita realizada
              </Label>
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
