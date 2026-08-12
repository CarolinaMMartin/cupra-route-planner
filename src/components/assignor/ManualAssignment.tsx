import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import { Search, UserCheck, Users, AlertCircle, Lightbulb, Clock, UserX, TrendingDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toTitleCase } from "@/lib/format";


interface Cliente {
  client_id: string;
  cuit_dni: string | null;
  razon_social: string | null;
  fantasia: string | null;
  ciudad_principal: string | null;
  provincia_principal: string | null;
  vendedor_actual: string | null;
  vendedor_principal: string | null;
  monto_total_historico: number | null;
  ultima_compra: string | null;
  dias_desde_ultima_compra: number | null;
  cantidad_ordenes: number | null;
}

interface ClienteGrupo {
  key: string;
  clientIds: string[];
  razon_social: string | null;
  fantasia: string | null;
  ciudad_principal: string | null;
  provincia_principal: string | null;
  vendedor_actual: string | null;
  vendedor_principal: string | null;
  monto_total_historico: number;
  dias_sin_compra: number | null;
  cantidad_ordenes: number;
  registros: number;
}

interface Vendedor {
  user_id: string;
  nombre: string;
}

type SuggestionMode = "sin_vendedor" | "baja_frecuencia" | "no_visitados";

const formatCurrency = (v: number | null) =>
  v != null ? `$${v.toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : "—";

const normalizeRS = (rs: string) => rs.trim().toUpperCase().replace(/\s+/g, " ");

// Días reales desde la última compra, calculados en horario Argentina (UTC-3)
const diasDesde = (fecha: string | null): number | null => {
  if (!fecha) return null;
  const parsed = new Date(`${fecha.slice(0, 10)}T00:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const hoyAR = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hoy = new Date(`${hoyAR.toISOString().slice(0, 10)}T00:00:00-03:00`);
  return Math.max(0, Math.round((hoy.getTime() - parsed.getTime()) / 86400000));
};


const ManualAssignment = () => {
  const { toast } = useToast();

  // ── State ──
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filterCiudad, setFilterCiudad] = useState("all");
  const [filterProvincia, setFilterProvincia] = useState("all");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedVendedorId, setSelectedVendedorId] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Debounce search ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Load vendedores on mount ──
  useEffect(() => {
    const loadVendedores = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, nombre")
        .eq("rol", "vendedor")
        .eq("activo", true)
        .order("nombre");
      setVendedores(data || []);
    };
    loadVendedores();
  }, []);

  // ── Search clientes ──
  const searchClientes = useCallback(async (query: string, ciudad: string, provincia: string, suggestion?: SuggestionMode) => {
    setIsSearching(true);
    setHasSearched(true);
    try {
      let q = supabase
        .from("clientes")
        .select("client_id, cuit_dni, ultima_compra, razon_social, fantasia, ciudad_principal, provincia_principal, vendedor_actual, vendedor_principal, monto_total_historico, dias_desde_ultima_compra, cantidad_ordenes")
        .order("monto_total_historico", { ascending: false })
        .limit(200);

      if (query.trim()) {
        const sanitized = query.trim().replace(/[%_]/g, "");
        q = q.or(`razon_social.ilike.%${sanitized}%,fantasia.ilike.%${sanitized}%`);
      }
      if (ciudad !== "all") q = q.eq("ciudad_principal", ciudad);
      if (provincia !== "all") q = q.eq("provincia_principal", provincia);

      // Smart suggestions filters
      if (suggestion === "sin_vendedor") {
        q = q.is("vendedor_actual", null);
      } else if (suggestion === "baja_frecuencia") {
        q = q.lt("cantidad_ordenes", 3).not("cantidad_ordenes", "is", null);
      } else if (suggestion === "no_visitados") {
        q = q.gt("dias_desde_ultima_compra", 60);
      }

      const { data, error } = await q;
      if (error) throw error;
      setClientes(data || []);
      setSelectedClients(new Set());
    } catch (err) {
      console.error("Error searching:", err);
      toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar los clientes" });
    } finally {
      setIsSearching(false);
    }
  }, [toast]);

  // ── Trigger search on debounced query or filter change ──
  useEffect(() => {
    if (debouncedQuery.trim() || filterCiudad !== "all" || filterProvincia !== "all" || suggestionMode) {
      searchClientes(debouncedQuery, filterCiudad, filterProvincia, suggestionMode || undefined);
    }
  }, [debouncedQuery, filterCiudad, filterProvincia, suggestionMode, searchClientes]);

  // ── Unique filter options ──
  const ciudades = useMemo(() => {
    const set = new Set(clientes.map(c => c.ciudad_principal).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [clientes]);

  const provincias = useMemo(() => {
    const set = new Set(clientes.map(c => c.provincia_principal).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [clientes]);

  // ── Selection helpers ──
  const toggleClient = (clientId: string) => {
    setSelectedClients(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedClients.size === clientes.length) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(new Set(clientes.map(c => c.client_id)));
    }
  };

  // ── Assign ──
  const selectedVendedor = vendedores.find(v => v.user_id === selectedVendedorId);

  const handleAssign = async () => {
    if (!selectedVendedorId || selectedClients.size === 0) return;
    setIsAssigning(true);
    setShowConfirmDialog(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const clientIds = Array.from(selectedClients);
      const selectedClientesData = clientes.filter(c => clientIds.includes(c.client_id));

      // 1. Create assignments in asignaciones_vendedores_clientes
      const assignments = clientIds.map(client_id => ({
        vendedor_id: selectedVendedorId,
        client_id,
        es_prospecto: false,
        origen_asignacion: "asignador",
        estado: "Asignado" as const,
      }));

      const { error: assignError } = await supabase
        .from("asignaciones_vendedores_clientes")
        .insert(assignments);
      if (assignError) throw assignError;

      // 2. Update vendedor_actual on clientes table
      for (const clientId of clientIds) {
        await supabase
          .from("clientes")
          .update({ vendedor_actual: selectedVendedor!.nombre })
          .eq("client_id", clientId);
      }

      // 3. Audit trail
      const auditRecords = selectedClientesData.map(c => ({
        usuario_id: session.user.id,
        vendedor_anterior: c.vendedor_actual || c.vendedor_principal || null,
        vendedor_nuevo_id: selectedVendedorId,
        vendedor_nuevo_nombre: selectedVendedor!.nombre,
        client_id: c.client_id,
        razon_social: c.razon_social,
      }));

      await supabase.from("asignaciones_manuales_audit").insert(auditRecords);

      toast({
        title: "Asignación realizada",
        description: `${clientIds.length} cliente(s) asignado(s) a ${selectedVendedor!.nombre}`,
      });

      // Reset
      setSelectedClients(new Set());
      // Refresh results
      searchClientes(debouncedQuery, filterCiudad, filterProvincia, suggestionMode || undefined);

    } catch (err: any) {
      console.error("Assignment error:", err);
      const msg = err.message?.includes("duplicate") 
        ? "Algunos clientes ya están asignados a este vendedor" 
        : "Error al realizar la asignación";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSuggestion = (mode: SuggestionMode) => {
    setSuggestionMode(prev => prev === mode ? null : mode);
    setSearchQuery("");
    setFilterCiudad("all");
    setFilterProvincia("all");
  };

  return (
    <div className="space-y-6">
      {/* ── Vendor selector ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg font-sans">Vendedor Destino</CardTitle>
          </div>
          <CardDescription>Buscá y seleccioná el vendedor al que se asignarán los clientes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md">
            <SearchableSelect
              options={vendedores.map(v => ({ value: v.user_id, label: toTitleCase(v.nombre) }))}
              value={selectedVendedorId}
              onValueChange={setSelectedVendedorId}
              placeholder="Seleccionar vendedor..."
              searchPlaceholder="Escribí el nombre..."
              emptyMessage="No se encontró ese vendedor."
              className="h-11"
            />
          </div>
          {!selectedVendedorId && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Seleccioná un vendedor para habilitar la asignación
            </p>
          )}
        </CardContent>
      </Card>


      {/* ── Smart Suggestions ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg font-sans">Sugerencias Inteligentes</CardTitle>
          </div>
          <CardDescription>Filtros rápidos para encontrar oportunidades</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={suggestionMode === "sin_vendedor" ? "default" : "outline"}
              size="sm"
              onClick={() => handleSuggestion("sin_vendedor")}
              className="gap-2"
            >
              <UserX className="w-4 h-4" />
              Sin vendedor asignado
            </Button>
            <Button
              variant={suggestionMode === "baja_frecuencia" ? "default" : "outline"}
              size="sm"
              onClick={() => handleSuggestion("baja_frecuencia")}
              className="gap-2"
            >
              <TrendingDown className="w-4 h-4" />
              Baja frecuencia (&lt;3 órdenes)
            </Button>
            <Button
              variant={suggestionMode === "no_visitados" ? "default" : "outline"}
              size="sm"
              onClick={() => handleSuggestion("no_visitados")}
              className="gap-2"
            >
              <Clock className="w-4 h-4" />
              Sin compra +60 días
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Search + Filters ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg font-sans">Buscar Clientes</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por razón social..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterProvincia} onValueChange={setFilterProvincia}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Provincia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las provincias</SelectItem>
                {provincias.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCiudad} onValueChange={setFilterCiudad}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Ciudad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las ciudades</SelectItem>
                {ciudades.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Results counter + action bar ── */}
          {hasSearched && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {clientes.length} resultado(s)
                </span>
                {selectedClients.size > 0 && (
                  <Badge variant="default" className="gap-1">
                    <Users className="w-3 h-3" />
                    {selectedClients.size} seleccionado(s)
                  </Badge>
                )}
              </div>
              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={!selectedVendedorId || selectedClients.size === 0 || isAssigning}
                className="gap-2"
              >
                {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                Asignar seleccionados
              </Button>
            </div>
          )}

          <Separator />

          {/* ── Results table ── */}
          {isSearching ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Buscando...
            </div>
          ) : !hasSearched ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Search className="w-8 h-8 opacity-40" />
              <p className="text-sm">Usá el buscador o las sugerencias inteligentes para encontrar clientes</p>
            </div>
          ) : clientes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <AlertCircle className="w-8 h-8 opacity-40" />
              <p className="text-sm">No se encontraron clientes con esos criterios</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[450px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedClients.size === clientes.length && clientes.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Razón Social</TableHead>
                    <TableHead>Ciudad</TableHead>
                    <TableHead>Provincia</TableHead>
                    <TableHead>Vendedor Actual</TableHead>
                    <TableHead className="text-right">Total Compras</TableHead>
                    <TableHead className="text-right">Días s/compra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientes.map(c => {
                    const isSelected = selectedClients.has(c.client_id);
                    return (
                      <TableRow
                        key={c.client_id}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-accent/30"}`}
                        onClick={() => toggleClient(c.client_id)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleClient(c.client_id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {c.razon_social || c.fantasia || "Sin nombre"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.ciudad_principal || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.provincia_principal || "—"}
                        </TableCell>
                        <TableCell>
                          {c.vendedor_actual ? (
                            <Badge variant="secondary" className="text-xs">{toTitleCase(c.vendedor_actual)}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin asignar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(c.monto_total_historico)}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.dias_desde_ultima_compra != null ? (
                            <Badge variant={c.dias_desde_ultima_compra > 90 ? "destructive" : c.dias_desde_ultima_compra > 30 ? "secondary" : "default"} className="text-xs">
                              {c.dias_desde_ultima_compra}d
                            </Badge>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── Confirmation Dialog ── */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar asignación manual</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Vas a asignar <strong>{selectedClients.size} cliente(s)</strong> a{" "}
                <strong>{selectedVendedor?.nombre}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                Se creará una asignación para cada cliente y se actualizará el vendedor actual. 
                Esta acción queda registrada en el historial de auditoría.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAssign}>
              Confirmar asignación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManualAssignment;
