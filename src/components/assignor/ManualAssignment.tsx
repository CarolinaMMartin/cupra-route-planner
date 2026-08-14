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
import { Search, UserCheck, Users, AlertCircle, Lightbulb, Clock, UserX, TrendingDown, Loader2, SlidersHorizontal, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
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
type SortKey = "nombre" | "ciudad" | "provincia" | "vendedor" | "monto" | "dias";
type SortDir = "asc" | "desc";

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
  const [filterVendedor, setFilterVendedor] = useState("all");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedVendedorId, setSelectedVendedorId] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("monto");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const activeFilterCount =
    (filterCiudad !== "all" ? 1 : 0) +
    (filterProvincia !== "all" ? 1 : 0) +
    (filterVendedor !== "all" ? 1 : 0);

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
  const searchClientes = useCallback(async (
    query: string,
    ciudad: string,
    provincia: string,
    vendedor: string,
    suggestion?: SuggestionMode
  ) => {
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
      if (vendedor !== "all") {
        if (vendedor === "__SIN_ASIGNAR__") {
          q = q.is("vendedor_actual", null);
        } else {
          q = q.eq("vendedor_actual", vendedor);
        }
      }

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

  // ── Carga inicial + búsqueda al cambiar query o filtros ──
  useEffect(() => {
    searchClientes(debouncedQuery, filterCiudad, filterProvincia, filterVendedor, suggestionMode || undefined);
  }, [debouncedQuery, filterCiudad, filterProvincia, filterVendedor, suggestionMode, searchClientes]);


  // ── Opciones de filtro (catálogo completo, independiente del resultado actual) ──
  const [geoOptions, setGeoOptions] = useState<{ ciudades: string[]; provincias: string[] }>({ ciudades: [], provincias: [] });
  useEffect(() => {
    const loadGeo = async () => {
      const { data } = await supabase
        .from("clientes")
        .select("ciudad_principal, provincia_principal")
        .limit(5000);
      const ci = new Set<string>();
      const pr = new Set<string>();
      (data || []).forEach((r: { ciudad_principal: string | null; provincia_principal: string | null }) => {
        if (r.ciudad_principal) ci.add(r.ciudad_principal);
        if (r.provincia_principal) pr.add(r.provincia_principal);
      });
      setGeoOptions({ ciudades: Array.from(ci).sort(), provincias: Array.from(pr).sort() });
    };
    loadGeo();
  }, []);
  const ciudades = geoOptions.ciudades;
  const provincias = geoOptions.provincias;


  // ── Unificar registros duplicados del mismo cliente (mismo CUIT o misma razón social) ──
  const grupos = useMemo<ClienteGrupo[]>(() => {
    const map = new Map<string, ClienteGrupo>();
    const ultimaCompraPorGrupo = new Map<string, string>();

    for (const c of clientes) {
      const key = (c.cuit_dni?.trim() || normalizeRS(c.razon_social || c.fantasia || c.client_id));
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          clientIds: [c.client_id],
          razon_social: c.razon_social,
          fantasia: c.fantasia,
          ciudad_principal: c.ciudad_principal,
          provincia_principal: c.provincia_principal,
          vendedor_actual: c.vendedor_actual,
          vendedor_principal: c.vendedor_principal,
          monto_total_historico: c.monto_total_historico || 0,
          dias_sin_compra: null,
          cantidad_ordenes: c.cantidad_ordenes || 0,
          registros: 1,
        });
      } else {
        existing.clientIds.push(c.client_id);
        existing.monto_total_historico += c.monto_total_historico || 0;
        existing.cantidad_ordenes += c.cantidad_ordenes || 0;
        existing.registros += 1;
        existing.ciudad_principal ||= c.ciudad_principal;
        existing.provincia_principal ||= c.provincia_principal;
        existing.vendedor_actual ||= c.vendedor_actual;
        existing.vendedor_principal ||= c.vendedor_principal;
      }
      // La última compra del cliente unificado es la más reciente de sus registros
      const prev = ultimaCompraPorGrupo.get(key);
      if (c.ultima_compra && (!prev || c.ultima_compra > prev)) {
        ultimaCompraPorGrupo.set(key, c.ultima_compra);
      }
    }

    return Array.from(map.values())
      .map(g => ({ ...g, dias_sin_compra: diasDesde(ultimaCompraPorGrupo.get(g.key) || null) }))
      .sort((a, b) => b.monto_total_historico - a.monto_total_historico);
  }, [clientes]);

  // ── Ordenamiento de la tabla ──
  const sortedGrupos = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const txt = (v: string | null) => (v || "").toLocaleLowerCase("es-AR");
    return [...grupos].sort((a, b) => {
      switch (sortKey) {
        case "nombre":
          return txt(a.razon_social || a.fantasia).localeCompare(txt(b.razon_social || b.fantasia), "es-AR") * dir;
        case "ciudad":
          return txt(a.ciudad_principal).localeCompare(txt(b.ciudad_principal), "es-AR") * dir;
        case "provincia":
          return txt(a.provincia_principal).localeCompare(txt(b.provincia_principal), "es-AR") * dir;
        case "vendedor":
          return txt(a.vendedor_actual || a.vendedor_principal).localeCompare(txt(b.vendedor_actual || b.vendedor_principal), "es-AR") * dir;
        case "dias":
          return ((a.dias_sin_compra ?? -1) - (b.dias_sin_compra ?? -1)) * dir;
        default:
          return (a.monto_total_historico - b.monto_total_historico) * dir;
      }
    });
  }, [grupos, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "monto" || key === "dias" ? "desc" : "asc");
    }
  };

  const SortHeader = ({ column, label, align = "left" }: { column: SortKey; label: string; align?: "left" | "right" }) => (
    <button
      type="button"
      onClick={() => toggleSort(column)}
      className={`flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors ${
        sortKey === column ? "text-foreground" : "text-muted-foreground"
      } ${align === "right" ? "ml-auto" : ""}`}
    >
      {label}
      {sortKey !== column ? (
        <ArrowUpDown className="w-3 h-3 opacity-50" />
      ) : sortDir === "asc" ? (
        <ArrowUp className="w-3 h-3" />
      ) : (
        <ArrowDown className="w-3 h-3" />
      )}
    </button>
  );

  // ── Selection helpers (por cliente unificado) ──
  const toggleClient = (groupKey: string) => {
    setSelectedClients(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedClients.size === grupos.length) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(new Set(grupos.map(g => g.key)));
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

      const selectedGrupos = grupos.filter(g => selectedClients.has(g.key));
      const clientIds = selectedGrupos.flatMap(g => g.clientIds);
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
      searchClientes(debouncedQuery, filterCiudad, filterProvincia, filterVendedor, suggestionMode || undefined);

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
    setFilterVendedor("all");
  };

  return (
    <div className="space-y-4">
      {/* ── Barra superior: vendedor destino + sugerencias + acción ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="w-full lg:w-[320px] shrink-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <UserCheck className="w-3.5 h-3.5 text-primary" /> Vendedor destino
              </label>
              <SearchableSelect
                options={vendedores.map(v => ({ value: v.user_id, label: toTitleCase(v.nombre) }))}
                value={selectedVendedorId}
                onValueChange={setSelectedVendedorId}
                placeholder="Seleccionar vendedor..."
                searchPlaceholder="Escribí el nombre..."
                emptyMessage="No se encontró ese vendedor."
                className="h-10"
              />
            </div>

            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-primary" /> Sugerencias inteligentes
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={suggestionMode === "sin_vendedor" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSuggestion("sin_vendedor")}
                  className="gap-2 h-10"
                >
                  <UserX className="w-4 h-4" /> Sin vendedor
                </Button>
                <Button
                  variant={suggestionMode === "baja_frecuencia" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSuggestion("baja_frecuencia")}
                  className="gap-2 h-10"
                >
                  <TrendingDown className="w-4 h-4" /> Baja frecuencia
                </Button>
                <Button
                  variant={suggestionMode === "no_visitados" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSuggestion("no_visitados")}
                  className="gap-2 h-10"
                >
                  <Clock className="w-4 h-4" /> Sin compra +60d
                </Button>
              </div>
            </div>

            <div className="shrink-0">
              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={!selectedVendedorId || selectedClients.size === 0 || isAssigning}
                className="gap-2 h-10 w-full lg:w-auto"
              >
                {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                Asignar{selectedClients.size > 0 ? ` (${selectedClients.size})` : ""}
              </Button>
            </div>
          </div>

          {!selectedVendedorId && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Seleccioná un vendedor para habilitar la asignación
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Búsqueda + filtros colapsables + resultados ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por razón social..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltersOpen(o => !o)}
              className="gap-2 h-10"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
              )}
              <ChevronDown className={`w-4 h-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {filtersOpen && (
            <div className="flex flex-col sm:flex-row gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="w-full sm:w-[220px] space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Provincia</label>
                <SearchableSelect
                  options={[
                    { value: "all", label: "Todas las provincias" },
                    ...provincias.map(p => ({ value: p, label: p })),
                  ]}
                  value={filterProvincia}
                  onValueChange={setFilterProvincia}
                  placeholder="Todas las provincias"
                  searchPlaceholder="Escribí para buscar provincia..."
                  emptyMessage="No se encontró esa provincia."
                  className="h-9"
                />
              </div>
              <div className="w-full sm:w-[220px] space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ciudad</label>
                <SearchableSelect
                  options={[
                    { value: "all", label: "Todas las ciudades" },
                    ...ciudades.map(c => ({ value: c, label: c })),
                  ]}
                  value={filterCiudad}
                  onValueChange={setFilterCiudad}
                  placeholder="Todas las ciudades"
                  searchPlaceholder="Escribí para buscar ciudad..."
                  emptyMessage="No se encontró esa ciudad."
                  className="h-9"
                />
              </div>
              <div className="w-full sm:w-[240px] space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Vendedor actual</label>
                <SearchableSelect
                  options={[
                    { value: "all", label: "Todos los vendedores" },
                    { value: "__SIN_ASIGNAR__", label: "Sin asignar" },
                    ...vendedores.map(v => ({ value: v.nombre, label: toTitleCase(v.nombre) })),
                  ]}
                  value={filterVendedor}
                  onValueChange={setFilterVendedor}
                  placeholder="Todos los vendedores"
                  searchPlaceholder="Escribí para buscar vendedor..."
                  emptyMessage="No se encontró ese vendedor."
                  className="h-9"
                />
              </div>
              {activeFilterCount > 0 && (
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setFilterCiudad("all"); setFilterProvincia("all"); setFilterVendedor("all"); }}
                  >
                    Limpiar filtros
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Results counter + orden ── */}
          {hasSearched && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {grupos.length} cliente(s){grupos.length !== clientes.length ? ` · ${clientes.length} registros unificados` : ""}
                </span>
                {selectedClients.size > 0 && (
                  <Badge variant="default" className="gap-1">
                    <Users className="w-3 h-3" />
                    {selectedClients.size} seleccionado(s)
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Ordenar por</span>
                <Select
                  value={`${sortKey}:${sortDir}`}
                  onValueChange={v => {
                    const [k, d] = v.split(":");
                    setSortKey(k as SortKey);
                    setSortDir(d as SortDir);
                  }}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nombre:asc">Razón social (A → Z)</SelectItem>
                    <SelectItem value="nombre:desc">Razón social (Z → A)</SelectItem>
                    <SelectItem value="vendedor:asc">Vendedor (A → Z)</SelectItem>
                    <SelectItem value="vendedor:desc">Vendedor (Z → A)</SelectItem>
                    <SelectItem value="monto:desc">Ventas (mayor a menor)</SelectItem>
                    <SelectItem value="monto:asc">Ventas (menor a mayor)</SelectItem>
                    <SelectItem value="dias:desc">Días s/compra (más)</SelectItem>
                    <SelectItem value="dias:asc">Días s/compra (menos)</SelectItem>
                    <SelectItem value="ciudad:asc">Ciudad (A → Z)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
          ) : grupos.length === 0 ? (
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
                        checked={selectedClients.size === grupos.length && grupos.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead><SortHeader column="nombre" label="Razón Social" /></TableHead>
                    <TableHead><SortHeader column="ciudad" label="Ciudad" /></TableHead>
                    <TableHead><SortHeader column="provincia" label="Provincia" /></TableHead>
                    <TableHead><SortHeader column="vendedor" label="Vendedor Actual" /></TableHead>
                    <TableHead className="text-right"><SortHeader column="monto" label="Total Compras" align="right" /></TableHead>
                    <TableHead className="text-right"><SortHeader column="dias" label="Días s/compra" align="right" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedGrupos.map(c => {
                    const isSelected = selectedClients.has(c.key);
                    return (
                      <TableRow
                        key={c.key}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-accent/30"}`}
                        onClick={() => toggleClient(c.key)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleClient(c.key)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{c.razon_social || c.fantasia || "Sin nombre"}</span>
                            {c.registros > 1 && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {c.registros} registros
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.ciudad_principal || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.provincia_principal || "—"}
                        </TableCell>
                        <TableCell>
                          {c.vendedor_actual ? (
                            <span className="text-sm">{toTitleCase(c.vendedor_actual)}</span>

                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin asignar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(c.monto_total_historico)}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.dias_sin_compra != null ? (
                            <Badge variant={c.dias_sin_compra > 90 ? "destructive" : c.dias_sin_compra > 30 ? "secondary" : "default"} className="text-xs">
                              {c.dias_sin_compra}d
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin compras</span>
                          )}
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
