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

      setAssignments(data as any || []);
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
                  className="flex items-center justify-between p-2 rounded bg-background text-sm"
                >
                  <div>
                    <p className="font-medium">{assignment.cliente?.razon_social || 'Cliente desconocido'}</p>
                    <p className="text-xs text-muted-foreground">{assignment.cliente?.cuit_dni}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(assignment.created_at).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
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
