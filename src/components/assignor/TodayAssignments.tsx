import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Users, Calendar } from "lucide-react";

interface Assignment {
  id: string;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente: {
    razon_social: string;
    cuit_dni: string;
  };
  created_at: string;
  cliente_info?: {
    etiquetas?: string[];
    score_volumen_num?: number;
    score_recencia_num?: number;
    razon_social?: string;
    priority_score?: number;
    provincias?: string[];
    ciudades?: string[];
    score_comercial?: string;
    score_volumen?: string;
    score_recencia?: string;
    vendedores?: string[];
    telefonos?: string[];
    monto_total_vendido?: number;
    orders_count?: number;
    avg_ticket?: number;
    first_purchase_at?: string;
    last_purchase_at?: string;
    days_since_last_purchase?: number;
    participacion?: number;
  };
}

const TodayAssignments = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchTodayAssignments();
  }, []);

  const fetchTodayAssignments = async () => {
    setIsLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('asignaciones_vendedores_clientes')
        .select(`
          id,
          created_at,
          vendedor:profiles!asignaciones_vendedores_clientes_vendedor_id_fkey(nombre, email),
          cliente:clientes!asignaciones_vendedores_clientes_cliente_id_fkey(razon_social, cuit_dni)
        `)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Enriquecer con información adicional de clientes_recomendaciones_temporal
      const assignmentsWithInfo = await Promise.all(
        (data || []).map(async (assignment: any) => {
          try {
            const { data: clienteInfo, error: infoError } = await supabase
              .from('clientes_recomendaciones_temporal')
              .select('*')
              .eq('cuit_dni', assignment.cliente?.cuit_dni)
              .limit(1)
              .single();

            if (infoError) {
              console.error('Error fetching cliente info:', infoError);
              return assignment;
            }

            return {
              ...assignment,
              cliente_info: clienteInfo,
            };
          } catch (err) {
            console.error('Error processing cliente:', err);
            return assignment;
          }
        })
      );

      setAssignments(assignmentsWithInfo as any);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar las asignaciones del día",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Agrupar asignaciones por vendedor
  const assignmentsByVendedor = assignments.reduce((acc, assignment) => {
    const vendedorNombre = assignment.vendedor?.nombre || 'Vendedor desconocido';
    if (!acc[vendedorNombre]) {
      acc[vendedorNombre] = {
        email: assignment.vendedor?.email || '',
        clientes: [],
      };
    }
    acc[vendedorNombre].clientes.push(assignment);
    return acc;
  }, {} as Record<string, { email: string; clientes: Assignment[] }>);

  if (isLoading) {
    return (
      <Card className="shadow-medium">
        <CardContent className="p-6">
          <p className="text-muted-foreground">Cargando asignaciones...</p>
        </CardContent>
      </Card>
    );
  }

  if (assignments.length === 0) {
    return (
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            Asignaciones de hoy
          </CardTitle>
          <CardDescription>No hay asignaciones realizadas hoy</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="shadow-medium">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-accent" />
          Asignaciones de hoy
        </CardTitle>
        <CardDescription>
          Total: {assignments.length} cliente{assignments.length !== 1 ? 's' : ''} asignado{assignments.length !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(assignmentsByVendedor).map(([vendedorNombre, data]) => (
          <div key={vendedorNombre} className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  <h3 className="font-semibold">{vendedorNombre}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{data.email}</p>
              </div>
              <Badge variant="secondary">
                {data.clientes.length} cliente{data.clientes.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="space-y-2">
              {data.clientes.map((assignment) => (
                <div
                  key={assignment.id}
                  className="p-3 rounded-lg bg-background border space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-base">{assignment.cliente?.razon_social || 'Cliente desconocido'}</p>
                      <p className="text-xs text-muted-foreground mt-1">CUIT: {assignment.cliente?.cuit_dni}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(assignment.created_at).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {assignment.cliente_info && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {assignment.cliente_info.ciudades && assignment.cliente_info.ciudades.length > 0 && (
                        <div>
                          <span className="font-medium">Ciudad:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.ciudades.join(', ')}</span>
                        </div>
                      )}
                      {assignment.cliente_info.provincias && assignment.cliente_info.provincias.length > 0 && (
                        <div>
                          <span className="font-medium">Provincia:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.provincias.join(', ')}</span>
                        </div>
                      )}
                      {assignment.cliente_info.telefonos && assignment.cliente_info.telefonos.length > 0 && (
                        <div>
                          <span className="font-medium">Teléfono:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.telefonos.join(', ')}</span>
                        </div>
                      )}
                      {assignment.cliente_info.score_comercial && (
                        <div>
                          <span className="font-medium">Score:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.score_comercial}</span>
                        </div>
                      )}
                      {assignment.cliente_info.monto_total_vendido && (
                        <div>
                          <span className="font-medium">Total vendido:</span>{' '}
                          <span className="text-muted-foreground">
                            ${assignment.cliente_info.monto_total_vendido.toLocaleString('es-AR')}
                          </span>
                        </div>
                      )}
                      {assignment.cliente_info.orders_count && (
                        <div>
                          <span className="font-medium">Órdenes:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.orders_count}</span>
                        </div>
                      )}
                      {assignment.cliente_info.avg_ticket && (
                        <div>
                          <span className="font-medium">Ticket promedio:</span>{' '}
                          <span className="text-muted-foreground">
                            ${assignment.cliente_info.avg_ticket.toLocaleString('es-AR')}
                          </span>
                        </div>
                      )}
                      {assignment.cliente_info.participacion !== null && (
                        <div>
                          <span className="font-medium">Participación:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.participacion}%</span>
                        </div>
                      )}
                      {assignment.cliente_info.days_since_last_purchase !== null && (
                        <div>
                          <span className="font-medium">Última compra:</span>{' '}
                          <span className="text-muted-foreground">
                            hace {assignment.cliente_info.days_since_last_purchase} días
                          </span>
                        </div>
                      )}
                      {assignment.cliente_info.first_purchase_at && (
                        <div>
                          <span className="font-medium">Primera compra:</span>{' '}
                          <span className="text-muted-foreground">
                            {new Date(assignment.cliente_info.first_purchase_at).toLocaleDateString('es-AR')}
                          </span>
                        </div>
                      )}
                      {assignment.cliente_info.vendedores && assignment.cliente_info.vendedores.length > 0 && (
                        <div className="md:col-span-2">
                          <span className="font-medium">Vendedores previos:</span>{' '}
                          <span className="text-muted-foreground">{assignment.cliente_info.vendedores.join(', ')}</span>
                        </div>
                      )}
                      {assignment.cliente_info.etiquetas && assignment.cliente_info.etiquetas.length > 0 && (
                        <div className="md:col-span-2">
                          <span className="font-medium">Productos:</span>{' '}
                          <span className="text-muted-foreground text-xs">
                            {assignment.cliente_info.etiquetas.slice(0, 3).join(', ')}
                            {assignment.cliente_info.etiquetas.length > 3 && ` +${assignment.cliente_info.etiquetas.length - 3} más`}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default TodayAssignments;
