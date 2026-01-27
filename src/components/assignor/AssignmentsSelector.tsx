import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Filter, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Assignment {
  id: string;
  vendedor_id: string;
  client_id: string;
  prospecto_place_id?: string;
  es_prospecto: boolean;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente: {
    razon_social: string;
    cuit_dni: string;
    barrio_principal?: string;
    provincia_principal?: string;
    vendedor_principal?: string;
  };
  prospecto?: {
    nombre: string;
    telefono?: string;
    barrio?: string;
    provincia?: string;
    direccion?: string;
  };
  created_at: string;
}

interface AssignmentsSelectorProps {
  onContinue: (selectedAssignments: Assignment[]) => void;
  onBack: () => void;
}

const AssignmentsSelector = ({ onContinue, onBack }: AssignmentsSelectorProps) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVendedor, setFilterVendedor] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<Assignment | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchAssignments();
  }, []);

  const fetchAssignments = async () => {
    setIsLoading(true);
    try {
      // Solo mostrar asignaciones vigentes (no visitadas)
      const { data, error } = await supabase
        .from('asignaciones_vendedores_clientes')
        .select(`
          id,
          vendedor_id,
          client_id,
          prospecto_place_id,
          es_prospecto,
          created_at,
          vendedor:profiles!asignaciones_vendedores_clientes_vendedor_id_fkey(nombre, email),
          cliente:clientes!asignaciones_vendedores_clientes_client_id_fkey(
            razon_social, 
            cuit_dni,
            barrio_principal,
            provincia_principal,
            vendedor_principal
          ),
          prospecto:prospectos!fk_prospecto(
            nombre,
            telefono,
            barrio,
            provincia,
            direccion
          )
        `)
        .neq('estado', 'Visitado')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Normalizar los datos para que todos tengan la misma estructura
      const normalizedData = (data || []).map(item => ({
        ...item,
        cliente: item.es_prospecto 
          ? {
              razon_social: item.prospecto?.nombre || 'Prospecto sin nombre',
              cuit_dni: item.prospecto?.telefono || 'Sin teléfono',
              barrio_principal: item.prospecto?.barrio,
              provincia_principal: item.prospecto?.provincia,
              vendedor_principal: null
            }
          : item.cliente
      }));

      setAssignments(normalizedData as any || []);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar las asignaciones",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAssignment = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === filteredAssignments.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAssignments.map(a => a.id));
    }
  };

  const handleContinue = () => {
    const selected = assignments.filter(a => selectedIds.includes(a.id));
    onContinue(selected);
  };

  const handleDeleteClick = (assignment: Assignment, event: React.MouseEvent) => {
    event.stopPropagation(); // Evitar que active el checkbox
    setAssignmentToDelete(assignment);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!assignmentToDelete) return;

    try {
      const { error } = await supabase
        .from('asignaciones_vendedores_clientes')
        .delete()
        .eq('id', assignmentToDelete.id);

      if (error) throw error;

      // Actualizar lista local removiendo la asignación eliminada
      setAssignments(prev => prev.filter(a => a.id !== assignmentToDelete.id));
      
      // Si estaba seleccionada, quitarla de la selección
      setSelectedIds(prev => prev.filter(id => id !== assignmentToDelete.id));

      toast({
        title: "Asignación eliminada",
        description: `Se eliminó la asignación de ${assignmentToDelete.cliente?.razon_social || 'Cliente desconocido'}`,
      });
    } catch (error) {
      console.error('Error deleting assignment:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al eliminar la asignación",
      });
    } finally {
      setDeleteDialogOpen(false);
      setAssignmentToDelete(null);
    }
  };

  // Obtener vendedores únicos para el filtro
  const vendedores = Array.from(new Set(assignments.map(a => a.vendedor?.nombre).filter(Boolean)));

  // Aplicar filtros
  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch = !searchTerm || 
      assignment.cliente?.razon_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assignment.cliente?.cuit_dni?.includes(searchTerm);
    
    const matchesVendedor = filterVendedor === "all" || 
      assignment.vendedor?.nombre === filterVendedor;

    return matchesSearch && matchesVendedor;
  });

  // Agrupar por vendedor
  const assignmentsByVendedor = filteredAssignments.reduce((acc, assignment) => {
    const vendedorNombre = assignment.vendedor?.nombre || 'Vendedor desconocido';
    if (!acc[vendedorNombre]) {
      acc[vendedorNombre] = [];
    }
    acc[vendedorNombre].push(assignment);
    return acc;
  }, {} as Record<string, Assignment[]>);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Cargando asignaciones...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Button>
        <Button 
          onClick={handleContinue} 
          disabled={selectedIds.length === 0}
          className="gap-2"
        >
          Continuar con {selectedIds.length} seleccionado{selectedIds.length !== 1 ? 's' : ''}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selecciona asignaciones para modificar</CardTitle>
          <CardDescription>
            Total: {assignments.length} asignaciones
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filtros */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Buscar por nombre o CUIT..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={filterVendedor} onValueChange={setFilterVendedor}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los vendedores</SelectItem>
                {vendedores.map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={toggleAll}
              className="gap-2"
            >
              {selectedIds.length === filteredAssignments.length ? 'Deseleccionar' : 'Seleccionar'} todos
            </Button>
          </div>

          {/* Lista agrupada por vendedor */}
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {Object.entries(assignmentsByVendedor).map(([vendedorNombre, vendedorAssignments]) => (
              <div key={vendedorNombre} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{vendedorNombre}</h3>
                  <Badge variant="secondary">
                    {vendedorAssignments.length} cliente{vendedorAssignments.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {vendedorAssignments.map(assignment => (
                    <div
                      key={assignment.id}
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedIds.includes(assignment.id)}
                        onCheckedChange={() => toggleAssignment(assignment.id)}
                        className="mt-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => toggleAssignment(assignment.id)}
                      >
                        <p className="font-medium">{assignment.cliente?.razon_social || 'Cliente desconocido'}</p>
                        <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                          {assignment.cliente?.cuit_dni && (
                            <span>CUIT: {assignment.cliente.cuit_dni}</span>
                          )}
                          {assignment.cliente?.barrio_principal && (
                            <span>• {assignment.cliente.barrio_principal}</span>
                          )}
                          {assignment.cliente?.provincia_principal && (
                            <span>• {assignment.cliente.provincia_principal}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Asignado: {new Date(assignment.created_at).toLocaleDateString('es-AR')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(assignment, e)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Eliminar asignación"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {filteredAssignments.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No se encontraron asignaciones
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar asignación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la asignación de <strong>{assignmentToDelete?.cliente?.razon_social || 'Cliente desconocido'}</strong> 
              {' '}al vendedor <strong>{assignmentToDelete?.vendedor?.nombre}</strong>.
              <br /><br />
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AssignmentsSelector;
