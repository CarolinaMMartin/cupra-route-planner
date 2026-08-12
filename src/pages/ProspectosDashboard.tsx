import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Star,
  Store,
  SlidersHorizontal,
  ExternalLink,
  Globe,
  Download,
  Plus,
  Search,
  X,
  ChevronsUpDown,
  List,
  LayoutGrid,
  MoreHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AgregarProspectoForm from "@/components/vendedor/AgregarProspectoForm";
import { ProspectDiscoveryDialog } from "@/components/prospectos/ProspectDiscoveryDialog";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Prospecto {
  id: string;
  place_id: string;
  nombre: string;
  telefono: string | null;
  direccion: string;
  barrio: string | null;
  comuna: string | null;
  ciudad: string;
  provincia: string;
  rating: number | null;
  total_ratings: number | null;
  nivel_precio: string | null;
  tipo_principal: string | null;
  tipos: string[] | null;
  website: string | null;
  email: string | null;
  instagram: string | null;
  estado_negocio: string | null;
  last_recommendation_at: string | null;
  latitud: number;
  longitud: number;
}

const ESTADOS = ["Nuevo", "Contactado", "En negociación", "Descartado"] as const;
type EstadoProspecto = (typeof ESTADOS)[number];

const normalizeEstado = (value: string | null): EstadoProspecto => {
  const found = ESTADOS.find((estado) => estado.toLowerCase() === (value || "").toLowerCase());
  return found || "Nuevo";
};

const estadoStyles: Record<EstadoProspecto, string> = {
  "Nuevo": "border-accent/40 bg-accent/10 text-accent",
  "Contactado": "border-primary/40 bg-primary/10 text-primary",
  "En negociación": "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  "Descartado": "border-border bg-muted text-muted-foreground",
};

const formatTipoNegocio = (tipo: string) =>
  tipo.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

const precioCorto = (nivel: string | null) => {
  if (!nivel) return "-";
  const map: Record<string, string> = {
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return map[nivel] || nivel;
};

const formatNivelPrecio = (nivel: string | null) => {
  if (!nivel) return "-";
  const map: Record<string, string> = {
    PRICE_LEVEL_INEXPENSIVE: "$ Económico",
    PRICE_LEVEL_MODERATE: "$$ Moderado",
    PRICE_LEVEL_EXPENSIVE: "$$$ Caro",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$ Muy Caro",
  };
  return map[nivel] || nivel;
};

const ProspectosDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [prospectosData, setProspectosData] = useState<Prospecto[]>([]);

  // Filtros
  const [selectedProvincia, setSelectedProvincia] = useState<string>("all");
  const [selectedComuna, setSelectedComuna] = useState<string>("all");
  const [selectedBarrio, setSelectedBarrio] = useState<string>("all");
  const [selectedTipos, setSelectedTipos] = useState<string[]>([]);
  const [selectedNivelPrecio, setSelectedNivelPrecio] = useState<string>("all");
  const [minRating, setMinRating] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Vista y orden
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [sortBy, setSortBy] = useState<"nombre" | "rating" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Dialogs
  const [showAgregarProspecto, setShowAgregarProspecto] = useState(false);
  const [showBuscarProspectos, setShowBuscarProspectos] = useState(false);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    void checkAuthAndFetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuthAndFetchData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('rol')
        .eq('user_id', session.user.id)
        .single();

      if (profile?.rol !== 'asignador') {
        toast({
          title: "Acceso denegado",
          description: "No tienes permisos para acceder a esta página",
          variant: "destructive",
        });
        navigate('/');
        return;
      }

      await fetchProspectosData();
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: "Error al cargar los datos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchProspectosData = async () => {
    const pageSize = 1000;
    let allProspectos: Prospecto[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data: prospectos, error } = await supabase
        .from('prospectos')
        .select('*')
        .eq('provincia', 'Ciudad Autónoma de Buenos Aires')
        .range(from, to);

      if (error) {
        console.error('Error fetching prospectos:', error);
        return;
      }

      if (prospectos && prospectos.length > 0) {
        allProspectos = [...allProspectos, ...prospectos];
        hasMore = prospectos.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    setProspectosData(allProspectos);
  };

  // Opciones únicas para filtros
  const provincias = useMemo(() => {
    const unique = new Set<string>();
    prospectosData.forEach((p) => { if (p.provincia) unique.add(p.provincia); });
    return Array.from(unique).sort();
  }, [prospectosData]);

  const comunas = useMemo(() => {
    const unique = new Set<string>();
    prospectosData.forEach((p) => {
      if (selectedProvincia !== "all" && p.provincia !== selectedProvincia) return;
      if (p.comuna) unique.add(p.comuna);
    });
    return Array.from(unique).sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [prospectosData, selectedProvincia]);

  const barrios = useMemo(() => {
    const unique = new Set<string>();
    prospectosData.forEach((p) => {
      if (selectedProvincia !== "all" && p.provincia !== selectedProvincia) return;
      if (selectedComuna !== "all" && p.comuna !== selectedComuna) return;
      if (p.barrio) unique.add(p.barrio);
    });
    return Array.from(unique).sort();
  }, [prospectosData, selectedProvincia, selectedComuna]);

  const tiposNegocio = useMemo(() => {
    const unique = new Set<string>();
    prospectosData.forEach((p) => { if (p.tipo_principal) unique.add(p.tipo_principal); });
    return Array.from(unique).sort();
  }, [prospectosData]);

  const nivelesPrecio = useMemo(() => {
    const unique = new Set<string>();
    prospectosData.forEach((p) => { if (p.nivel_precio) unique.add(p.nivel_precio); });
    return Array.from(unique).sort();
  }, [prospectosData]);

  // Datos filtrados
  const filteredData = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return prospectosData.filter((p) => {
      const matchProvincia = selectedProvincia === "all" || p.provincia === selectedProvincia;
      const matchComuna = selectedComuna === "all" || p.comuna === selectedComuna;
      const matchBarrio = selectedBarrio === "all" || p.barrio === selectedBarrio;
      const matchTipos = selectedTipos.length === 0 || selectedTipos.some((t) => p.tipo_principal === t);
      const matchNivelPrecio = selectedNivelPrecio === "all" || p.nivel_precio === selectedNivelPrecio;
      const matchRating = (p.rating || 0) >= minRating;
      const matchSearch = term === "" ||
        p.nombre.toLowerCase().includes(term) ||
        (p.direccion || "").toLowerCase().includes(term) ||
        (p.tipo_principal ? formatTipoNegocio(p.tipo_principal).toLowerCase().includes(term) : false);

      return matchProvincia && matchComuna && matchBarrio && matchTipos &&
        matchNivelPrecio && matchRating && matchSearch;
    });
  }, [prospectosData, selectedProvincia, selectedComuna, selectedBarrio,
    selectedTipos, selectedNivelPrecio, minRating, searchTerm]);

  const sortedData = useMemo(() => {
    if (!sortBy) return filteredData;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...filteredData].sort((a, b) => {
      if (sortBy === "nombre") return a.nombre.localeCompare(b.nombre) * factor;
      return ((a.rating || 0) - (b.rating || 0)) * factor;
    });
  }, [filteredData, sortBy, sortDir]);

  // KPIs (responden a los filtros)
  const kpis = useMemo(() => {
    const total = filteredData.length;
    const conTelefono = filteredData.filter((p) => p.telefono).length;
    const porcentajeConTelefono = total > 0 ? Math.round((conTelefono / total) * 100) : 0;
    const conRating = filteredData.filter((p) => p.rating !== null);
    const ratingPromedio = conRating.length > 0
      ? conRating.reduce((sum, p) => sum + (p.rating || 0), 0) / conRating.length
      : 0;
    const barriosCubiertos = new Set(filteredData.map((p) => p.barrio).filter(Boolean)).size;

    return { total, porcentajeConTelefono, ratingPromedio, barriosCubiertos };
  }, [filteredData]);

  // Paginación
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (selectedProvincia !== "all") chips.push({ key: "provincia", label: selectedProvincia, clear: () => setSelectedProvincia("all") });
    if (selectedComuna !== "all") chips.push({ key: "comuna", label: `Comuna ${selectedComuna}`, clear: () => setSelectedComuna("all") });
    if (selectedBarrio !== "all") chips.push({ key: "barrio", label: selectedBarrio, clear: () => setSelectedBarrio("all") });
    selectedTipos.forEach((tipo) => chips.push({
      key: `tipo-${tipo}`,
      label: formatTipoNegocio(tipo),
      clear: () => setSelectedTipos((current) => current.filter((t) => t !== tipo)),
    }));
    if (selectedNivelPrecio !== "all") chips.push({ key: "precio", label: formatNivelPrecio(selectedNivelPrecio), clear: () => setSelectedNivelPrecio("all") });
    if (minRating > 0) chips.push({ key: "rating", label: `Rating ≥ ${minRating.toFixed(1)}`, clear: () => setMinRating(0) });
    if (searchTerm.trim() !== "") chips.push({ key: "search", label: `"${searchTerm.trim()}"`, clear: () => setSearchTerm("") });
    return chips;
  }, [selectedProvincia, selectedComuna, selectedBarrio, selectedTipos, selectedNivelPrecio, minRating, searchTerm]);

  const handleClearFilters = () => {
    setSelectedProvincia("all");
    setSelectedComuna("all");
    setSelectedBarrio("all");
    setSelectedTipos([]);
    setSelectedNivelPrecio("all");
    setMinRating(0);
    setSearchTerm("");
    setCurrentPage(1);
  };

  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedComuna("all");
    setSelectedBarrio("all");
    setCurrentPage(1);
  };

  const handleComunaChange = (value: string) => {
    setSelectedComuna(value);
    setSelectedBarrio("all");
    setCurrentPage(1);
  };

  const toggleSort = (column: "nombre" | "rating") => {
    if (sortBy === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir(column === "rating" ? "desc" : "asc");
    }
    setCurrentPage(1);
  };

  const pageIds = paginatedData.map((p) => p.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const togglePageSelection = () => {
    setSelectedIds((current) => allPageSelected
      ? current.filter((id) => !pageIds.includes(id))
      : Array.from(new Set([...current, ...pageIds])));
  };

  const toggleRow = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const buildCsv = (rowsSource: Prospecto[]) => {
    const headers = ["Nombre", "Dirección", "Tipo", "Barrio", "Comuna", "Ciudad", "Rating", "Nivel Precio", "Teléfono", "Website", "Estado"];
    const rows = rowsSource.map((p) => [
      p.nombre,
      p.direccion || "",
      p.tipo_principal ? formatTipoNegocio(p.tipo_principal) : "",
      p.barrio || "",
      p.comuna || "",
      p.ciudad,
      p.rating?.toString() || "",
      formatNivelPrecio(p.nivel_precio),
      p.telefono || "",
      p.website || "",
      normalizeEstado(p.estado_negocio),
    ]);
    return [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  };

  const downloadCsv = (rowsSource: Prospecto[]) => {
    const blob = new Blob([buildCsv(rowsSource)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prospectos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exportación exitosa", description: `Se exportaron ${rowsSource.length} prospectos` });
  };

  const handleEstadoChange = async (prospecto: Prospecto, estado: EstadoProspecto) => {
    const previous = prospecto.estado_negocio;
    setProspectosData((current) => current.map((p) => (
      p.id === prospecto.id ? { ...p, estado_negocio: estado } : p
    )));
    const { error } = await supabase
      .from('prospectos')
      .update({ estado_negocio: estado })
      .eq('id', prospecto.id);
    if (error) {
      setProspectosData((current) => current.map((p) => (
        p.id === prospecto.id ? { ...p, estado_negocio: previous } : p
      )));
      toast({ title: "No se pudo actualizar el estado", description: error.message, variant: "destructive" });
    }
  };

  const mapsUrl = (p: Prospecto) => (
    `https://www.google.com/maps/search/?api=1&query=${p.latitud},${p.longitud}&query_place_id=${encodeURIComponent(p.place_id)}`
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <img src={cupraLogo} alt="Cupra Logo" className="w-32 animate-pulse" />
      </div>
    );
  }

  const EstadoBadge = ({ estado }: { estado: EstadoProspecto }) => (
    <Badge variant="outline" className={`text-xs font-medium ${estadoStyles[estado]}`}>{estado}</Badge>
  );

  const RowActions = ({ p }: { p: Prospecto }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 bg-popover z-50">
        <DropdownMenuItem asChild>
          <a href={mapsUrl(p)} target="_blank" rel="noreferrer" className="gap-2">
            <ExternalLink className="h-4 w-4" /> Ver en Maps
          </a>
        </DropdownMenuItem>
        {p.website && (
          <DropdownMenuItem asChild>
            <a href={p.website} target="_blank" rel="noreferrer" className="gap-2">
              <Globe className="h-4 w-4" /> Abrir sitio web
            </a>
          </DropdownMenuItem>
        )}
        {p.telefono && (
          <DropdownMenuItem asChild>
            <a href={`tel:${p.telefono}`} className="gap-2">
              <Phone className="h-4 w-4" /> Llamar
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Cambiar estado</DropdownMenuLabel>
        {ESTADOS.map((estado) => (
          <DropdownMenuItem key={estado} onClick={() => handleEstadoChange(p, estado)}>
            {estado}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <AppNav />
        {/* Header sticky compacto */}
        <header className="sticky top-14 z-40 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">

                <h1 className="text-xl md:text-2xl font-sans text-foreground tracking-tight truncate">
                  Dashboard de Prospectos
                </h1>
                <p className="text-xs md:text-sm text-muted-foreground truncate">
                  Exploración y análisis de prospectos potenciales
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Button variant="outline" onClick={() => downloadCsv(filteredData)} className="h-[38px] gap-2">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Exportar CSV</span>
              </Button>
              <Button variant="outline" onClick={() => setShowAgregarProspecto(true)} className="h-[38px] gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Agregar manual</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setShowBuscarProspectos(true)} className="h-[38px] gap-2 wine-button">
                    <MapPin className="h-4 w-4" />
                    <span className="hidden sm:inline">Buscar prospectos en Maps</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Buscá comercios reales en Google Maps y agregalos como prospectos
                </TooltipContent>
              </Tooltip>
              <span className="hidden md:inline pl-3 border-l border-border/60 text-accent tracking-[0.35em] text-sm font-semibold">
                CUPRA
              </span>
            </div>
          </div>
        </header>

        <div className="max-w-[1920px] mx-auto p-4 md:p-6 space-y-4">
          {/* KPIs compactos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total prospectos", value: kpis.total.toLocaleString(), Icon: Store },
              { label: "Con teléfono", value: `${kpis.porcentajeConTelefono}%`, Icon: Phone },
              { label: "Rating promedio", value: kpis.ratingPromedio.toFixed(2), Icon: Star },
              { label: "Barrios cubiertos", value: kpis.barriosCubiertos.toString(), Icon: MapPin },
            ].map(({ label, value, Icon }) => (
              <Card key={label} className="matte-card">
                <CardContent className="h-[70px] p-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
                    <p className="text-xl font-semibold text-foreground leading-tight">{value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Barra de búsqueda + filtros */}
          <Card className="matte-card">
            <CardContent className="p-3 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre, dirección o tipo de negocio"
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="h-[38px] pl-9 bg-background/50"
                  />
                </div>

                <Button
                  variant="outline"
                  onClick={() => setFiltersOpen((open) => !open)}
                  className="h-[38px] gap-2"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtros
                  <span className={`ml-1 rounded-full px-2 text-xs ${activeFilters.length > 0 ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {activeFilters.length}
                  </span>
                </Button>

                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground whitespace-nowrap">
                    <span className="text-foreground font-medium">{filteredData.length}</span> de {prospectosData.length} prospectos
                  </p>
                  <div className="flex items-center rounded-md border border-border/60 p-0.5">
                    <Button
                      variant={viewMode === "table" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode("table")}
                      aria-label="Vista tabla"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === "cards" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode("cards")}
                      aria-label="Vista tarjetas"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {filtersOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 pt-2 border-t border-border/40">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provincia</label>
                    <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                      <SelectTrigger className="bg-background/50"><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectItem value="all">Todas</SelectItem>
                        {provincias.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Comuna</label>
                    <SearchableSelect
                      options={[{ label: "Todas", value: "all" }, ...comunas.map((c) => ({ label: `Comuna ${c}`, value: c }))]}
                      value={selectedComuna}
                      onValueChange={handleComunaChange}
                      placeholder="Seleccionar comuna"
                      searchPlaceholder="Buscar comuna..."
                      emptyMessage="No se encontró la comuna"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Barrio</label>
                    <SearchableSelect
                      options={[{ label: "Todos", value: "all" }, ...barrios.map((b) => ({ label: b, value: b }))]}
                      value={selectedBarrio}
                      onValueChange={(v) => { setSelectedBarrio(v); setCurrentPage(1); }}
                      placeholder="Seleccionar barrio"
                      searchPlaceholder="Buscar barrio..."
                      emptyMessage="No se encontró el barrio"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo de negocio</label>
                    <MultiSelect
                      options={tiposNegocio.map((t) => ({ label: formatTipoNegocio(t), value: t }))}
                      selected={selectedTipos}
                      onChange={(v) => { setSelectedTipos(v); setCurrentPage(1); }}
                      placeholder="Todos los tipos"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nivel precio</label>
                    <Select value={selectedNivelPrecio} onValueChange={(v) => { setSelectedNivelPrecio(v); setCurrentPage(1); }}>
                      <SelectTrigger className="bg-background/50"><SelectValue placeholder="Todos" /></SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectItem value="all">Todos</SelectItem>
                        {nivelesPrecio.map((n) => <SelectItem key={n} value={n}>{formatNivelPrecio(n)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Rating mínimo <span className="text-accent ml-1">{minRating.toFixed(1)}</span>
                    </label>
                    <Slider
                      value={[minRating]}
                      onValueChange={(v) => { setMinRating(v[0]); setCurrentPage(1); }}
                      min={0}
                      max={5}
                      step={0.5}
                      className="mt-3"
                    />
                  </div>
                </div>
              )}

              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {activeFilters.map((chip) => (
                    <button
                      key={chip.key}
                      onClick={() => { chip.clear(); setCurrentPage(1); }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20 transition-colors"
                    >
                      {chip.label}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  <button
                    onClick={handleClearFilters}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Limpiar todo
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Barra de selección múltiple */}
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5">
              <span className="text-sm font-medium text-accent">{selectedIds.length} seleccionados</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 wine-button"
                  onClick={() => toast({
                    title: "Asignar vendedor",
                    description: "La asignación de prospectos se hace desde el panel de asignación.",
                  })}
                >
                  Asignar vendedor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => downloadCsv(prospectosData.filter((p) => selectedIds.includes(p.id)))}
                >
                  Exportar selección
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds([])}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Contenido principal */}
          {sortedData.length === 0 ? (
            <Card className="matte-card">
              <CardContent className="py-16 flex flex-col items-center text-center gap-3">
                <div className="h-12 w-12 rounded-md bg-accent/10 flex items-center justify-center">
                  <Search className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground">Ningún prospecto coincide con los filtros</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Probá quitar filtros o ampliar la zona. Si todavía no cargaste prospectos de esta zona, buscalos directamente en Google Maps.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                  <Button variant="outline" className="h-[38px]" onClick={handleClearFilters}>Limpiar filtros</Button>
                  <Button className="h-[38px] gap-2 wine-button" onClick={() => setShowBuscarProspectos(true)}>
                    <MapPin className="h-4 w-4" /> Buscar prospectos en Maps
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : viewMode === "table" ? (
            <Card className="matte-card">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[1100px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox checked={allPageSelected} onCheckedChange={togglePageSelection} aria-label="Seleccionar todo" />
                        </TableHead>
                        <TableHead>
                          <button onClick={() => toggleSort("nombre")} className="inline-flex items-center gap-1 uppercase text-xs tracking-wide hover:text-foreground">
                            Prospecto <ChevronsUpDown className="h-3.5 w-3.5" />
                          </button>
                        </TableHead>
                        <TableHead className="uppercase text-xs tracking-wide">Tipo</TableHead>
                        <TableHead className="uppercase text-xs tracking-wide">Ubicación</TableHead>
                        <TableHead>
                          <button onClick={() => toggleSort("rating")} className="inline-flex items-center gap-1 uppercase text-xs tracking-wide hover:text-foreground">
                            Rating <ChevronsUpDown className="h-3.5 w-3.5" />
                          </button>
                        </TableHead>
                        <TableHead className="uppercase text-xs tracking-wide">Precio</TableHead>
                        <TableHead className="uppercase text-xs tracking-wide">Contacto</TableHead>
                        <TableHead className="uppercase text-xs tracking-wide">Estado</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedData.map((p) => (
                        <TableRow key={p.id} data-state={selectedIds.includes(p.id) ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(p.id)}
                              onCheckedChange={() => toggleRow(p.id)}
                              aria-label={`Seleccionar ${p.nombre}`}
                            />
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <p className="font-medium text-foreground truncate">{p.nombre}</p>
                            <p className="text-xs text-muted-foreground truncate">{p.direccion || "Sin dirección"}</p>
                          </TableCell>
                          <TableCell className="text-sm">
                            {p.tipo_principal ? formatTipoNegocio(p.tipo_principal) : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            <p className="text-foreground truncate max-w-[180px]">{p.barrio || p.ciudad}</p>
                            <p className="text-xs text-muted-foreground">{p.comuna ? `Comuna ${p.comuna}` : ""}</p>
                          </TableCell>
                          <TableCell>
                            {p.rating !== null ? (
                              <span className="inline-flex items-center gap-1.5 text-sm">
                                <Star className="h-4 w-4 text-accent" />
                                {p.rating.toFixed(1)}
                              </span>
                            ) : <span className="text-muted-foreground text-sm">-</span>}
                          </TableCell>
                          <TableCell className="text-sm text-foreground">{precioCorto(p.nivel_precio)}</TableCell>
                          <TableCell className="text-sm">
                            {p.telefono ? (
                              <a href={`tel:${p.telefono}`} className="hover:underline">{p.telefono}</a>
                            ) : <span className="text-muted-foreground">Sin teléfono</span>}
                          </TableCell>
                          <TableCell><EstadoBadge estado={normalizeEstado(p.estado_negocio)} /></TableCell>
                          <TableCell><RowActions p={p} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, sortedData.length)} de {sortedData.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                      Anterior
                    </Button>
                    <span className="text-sm text-muted-foreground">Página {currentPage} de {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                      Siguiente
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {paginatedData.map((p) => (
                  <Card key={p.id} className="matte-card">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          className="mt-1"
                          checked={selectedIds.includes(p.id)}
                          onCheckedChange={() => toggleRow(p.id)}
                          aria-label={`Seleccionar ${p.nombre}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{p.nombre}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.direccion || "Sin dirección"}</p>
                        </div>
                        <RowActions p={p} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-muted-foreground">{p.tipo_principal ? formatTipoNegocio(p.tipo_principal) : "-"}</span>
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-accent" />
                          {p.barrio || p.ciudad}
                        </span>
                        {p.rating !== null && (
                          <span className="inline-flex items-center gap-1.5">
                            <Star className="h-3.5 w-3.5 text-accent" />
                            {p.rating.toFixed(1)}
                          </span>
                        )}
                        <span>{precioCorto(p.nivel_precio)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">
                          {p.telefono ? (
                            <a href={`tel:${p.telefono}`} className="hover:underline">{p.telefono}</a>
                          ) : <span className="text-muted-foreground">Sin teléfono</span>}
                        </span>
                        <EstadoBadge estado={normalizeEstado(p.estado_negocio)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, sortedData.length)} de {sortedData.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">Página {currentPage} de {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Dialog para agregar prospecto */}
        <Dialog open={showAgregarProspecto} onOpenChange={setShowAgregarProspecto}>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Agregar Nuevo Prospecto</DialogTitle>
              <DialogDescription>
                Ingresá los datos del establecimiento. La dirección será validada automáticamente.
              </DialogDescription>
            </DialogHeader>
            <AgregarProspectoForm
              onSuccess={() => {
                setShowAgregarProspecto(false);
                fetchProspectosData();
              }}
              onCancel={() => setShowAgregarProspecto(false)}
            />
          </DialogContent>
        </Dialog>

        <ProspectDiscoveryDialog
          open={showBuscarProspectos}
          onOpenChange={setShowBuscarProspectos}
          onConverted={fetchProspectosData}
        />
      </div>
    </TooltipProvider>
  );
};

export default ProspectosDashboard;
