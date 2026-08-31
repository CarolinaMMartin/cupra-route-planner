import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Save, Search, ChevronDown, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toTitleCase } from "@/lib/format";
import { SALES_PROFILE_OR_FILTER } from "@/lib/roles";

interface Vendedor {
  id: string;
  nombre: string;
  email: string;
}

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
}

interface EditAssignmentsTableProps {
  selectedAssignments: Assignment[];
  onBack: () => void;
  onComplete?: () => void;
}

const EditAssignmentsTable = ({
  selectedAssignments,
  onBack,
  onComplete,
}: EditAssignmentsTableProps) => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [assignmentMap, setAssignmentMap] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVendedor, setFilterVendedor] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchVendedores();
  }, []);

  const fetchVendedores = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, nombre, email")
        .or(SALES_PROFILE_OR_FILTER)
        .eq("activo", true);

      if (error) throw error;

      const mapped = (data || []).map((v) => ({
        id: v.user_id,
        nombre: v.nombre,
        email: v.email,
      }));
      setVendedores(mapped);

      // Initialize assignment map with current vendedor_id
      const initialMap: Record<string, string> = {};
      selectedAssignments.forEach((a) => {
        initialMap[a.id] = a.vendedor_id;
      });
      setAssignmentMap(initialMap);
    } catch (error) {
      console.error("Error fetching vendedores:", error);
      toast({ variant: "destructive", title: "Error", description: "Error al cargar vendedores" });
    }
  };

  const filteredData = useMemo(() => {
    return selectedAssignments.filter((a) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const name = (a.cliente?.razon_social || "").toLowerCase();
        const cuit = (a.cliente?.cuit_dni || "").toLowerCase();
        if (!name.includes(term) && !cuit.includes(term)) return false;
      }
      if (filterVendedor !== "all") {
        const assigned = assignmentMap[a.id];
        if (assigned !== filterVendedor) return false;
      }
      return true;
    });
  }, [selectedAssignments, searchTerm, filterVendedor, assignmentMap]);

  const allSelected = filteredData.length > 0 && filteredData.every((a) => selectedIds.has(a.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredData.forEach((a) => next.delete(a.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredData.forEach((a) => next.add(a.id));
        return next;
      });
    }
  };

  const deselectAll = () => setSelectedIds(new Set());

  const assignSelectedTo = (vendedorId: string) => {
    setAssignmentMap((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => { next[id] = vendedorId; });
      return next;
    });
    const v = vendedores.find((v) => v.id === vendedorId);
    toast({
      title: `${selectedIds.size} clientes reasignados`,
      description: `Reasignados a ${v?.nombre || "vendedor"}`,
    });
  };

  const getVendedorName = (id: string | null) => {
    if (!id) return null;
    return vendedores.find((v) => v.id === id)?.nombre || null;
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Separate clients and prospects
      const clientIds = selectedAssignments
        .filter((a) => !a.es_prospecto && a.client_id)
        .map((a) => a.client_id);

      const prospectoPlaceIds = selectedAssignments
        .filter((a) => a.es_prospecto && a.prospecto_place_id)
        .map((a) => a.prospecto_place_id!);

      // Delete existing assignments
      const deletePromises = [];
      if (clientIds.length > 0) {
        deletePromises.push(
          supabase.from("asignaciones_vendedores_clientes").delete().in("client_id", clientIds)
        );
      }
      if (prospectoPlaceIds.length > 0) {
        deletePromises.push(
          supabase.from("asignaciones_vendedores_clientes").delete().in("prospecto_place_id", prospectoPlaceIds)
        );
      }
      const deleteResults = await Promise.all(deletePromises);
      const deleteError = deleteResults.find((r) => r.error);
      if (deleteError?.error) throw deleteError.error;

      // Create new assignments
      const newAssignments: any[] = [];
      const assignedPairs = new Set<string>();

      for (const assignment of selectedAssignments) {
        const vendedorId = assignmentMap[assignment.id];
        if (!vendedorId) continue;

        if (assignment.es_prospecto && assignment.prospecto_place_id) {
          const key = `${vendedorId}-prospecto-${assignment.prospecto_place_id}`;
          if (!assignedPairs.has(key)) {
            assignedPairs.add(key);
            newAssignments.push({
              vendedor_id: vendedorId,
              prospecto_place_id: assignment.prospecto_place_id,
              es_prospecto: true,
              origen_asignacion: "asignador",
            });
          }
        } else if (assignment.client_id) {
          const key = `${vendedorId}-cliente-${assignment.client_id}`;
          if (!assignedPairs.has(key)) {
            assignedPairs.add(key);
            newAssignments.push({
              vendedor_id: vendedorId,
              client_id: assignment.client_id,
              es_prospecto: false,
              origen_asignacion: "asignador",
            });
          }
        }
      }

      if (newAssignments.length > 0) {
        const { error } = await supabase.from("asignaciones_vendedores_clientes").insert(newAssignments);
        if (error) throw error;
      }

      toast({
        title: "Asignaciones actualizadas",
        description: `Se modificaron ${newAssignments.length} asignaciones exitosamente`,
      });

      if (onComplete) onComplete(); else onBack();
    } catch (error) {
      console.error("Error saving assignments:", error);
      toast({ variant: "destructive", title: "Error", description: "Error al guardar las asignaciones" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-sans text-foreground tracking-tight">Reasignar Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Modifica las asignaciones de vendedores usando los desplegables
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterVendedor} onValueChange={setFilterVendedor}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Todos los vendedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los vendedores</SelectItem>
            {vendedores.map((v) => (
              <SelectItem key={v.id} value={v.id}>{toTitleCase(v.nombre)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2" disabled={selectedIds.size === 0}>
              Asignar a
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Checkbox checked={selectedIds.size > 0} className="h-4 w-4" />
                <span className="text-sm font-medium">{selectedIds.size} seleccionados</span>
              </div>
              {selectedIds.size > 0 && (
                <button onClick={deselectAll} className="text-xs text-muted-foreground hover:text-foreground mt-1">
                  Desmarcar todos
                </button>
              )}
            </div>
            {vendedores.map((v) => (
              <DropdownMenuItem key={v.id} onClick={() => assignSelectedTo(v.id)}>
                {toTitleCase(v.nombre)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <div className="relative w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Button>

        <Button onClick={handleSave} disabled={isLoading} className="gap-2">
          <Save className="w-4 h-4" />
          Guardar
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-4 w-4" />
              </TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Vendedor actual</TableHead>
              <TableHead className="text-right">Asignado a</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  No se encontraron clientes
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((assignment) => {
                const isSelected = selectedIds.has(assignment.id);
                const assignedName = getVendedorName(assignmentMap[assignment.id] || null);
                const originalVendedor = assignment.vendedor?.nombre || "—";
                const changed = assignmentMap[assignment.id] !== assignment.vendedor_id;

                return (
                  <TableRow
                    key={assignment.id}
                    data-state={isSelected ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => toggleSelect(assignment.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(assignment.id)}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {assignment.es_prospecto && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">P</Badge>
                        )}
                        <span className="font-medium text-sm">
                          {assignment.cliente?.razon_social || "Cliente desconocido"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {assignment.cliente?.cuit_dni || ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {assignment.cliente?.barrio_principal || assignment.cliente?.provincia_principal || "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{originalVendedor}</span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={assignmentMap[assignment.id] || "none"}
                        onValueChange={(val) => {
                          setAssignmentMap((prev) => ({
                            ...prev,
                            [assignment.id]: val,
                          }));
                        }}
                      >
                        <SelectTrigger className={`w-[160px] ml-auto h-8 text-xs ${changed ? "border-primary" : ""}`}>
                          <SelectValue>
                            {assignedName || <span className="text-muted-foreground">Sin asignar</span>}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {vendedores.map((v) => (
                            <SelectItem key={v.id} value={v.id}>{toTitleCase(v.nombre)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        {selectedAssignments.length} asignaciones en total
      </p>
    </div>
  );
};

export default EditAssignmentsTable;
