import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  MapPin, 
  Phone, 
  Star, 
  Store, 
  Filter, 
  RefreshCw, 
  ExternalLink,
  Globe,
  Download
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/ui/multi-select";
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
  last_recommendation_at: string | null;
  latitud: number;
  longitud: number;
}

// Helper functions (defined before component to avoid hoisting issues)
const formatTipoNegocio = (tipo: string) => {
  return tipo
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};

const formatNivelPrecio = (nivel: string | null) => {
  if (!nivel) return "-";
  const map: Record<string, string> = {
    "PRICE_LEVEL_INEXPENSIVE": "$ Económico",
    "PRICE_LEVEL_MODERATE": "$$ Moderado",
    "PRICE_LEVEL_EXPENSIVE": "$$$ Caro",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$ Muy Caro",
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
  const [selectedCiudad, setSelectedCiudad] = useState<string>("all");
  const [selectedBarrio, setSelectedBarrio] = useState<string>("all");
  const [selectedTipos, setSelectedTipos] = useState<string[]>([]);
  const [selectedNivelPrecio, setSelectedNivelPrecio] = useState<string>("all");
  const [minRating, setMinRating] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    checkAuthAndFetchData();
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
    const { data: prospectos, error } = await supabase
      .from('prospectos')
      .select('*');

    if (error) {
      console.error('Error fetching prospectos:', error);
      return;
    }
    
    setProspectosData(prospectos || []);
  };

  // Opciones únicas para filtros
  const provincias = useMemo(() => {
    const uniqueProvincias = new Set<string>();
    prospectosData.forEach(p => {
      if (p.provincia) uniqueProvincias.add(p.provincia);
    });
    return Array.from(uniqueProvincias).sort();
  }, [prospectosData]);

  const ciudades = useMemo(() => {
    const uniqueCiudades = new Set<string>();
    prospectosData.forEach(p => {
      if (selectedProvincia !== "all" && p.provincia !== selectedProvincia) return;
      if (p.ciudad) uniqueCiudades.add(p.ciudad);
    });
    return Array.from(uniqueCiudades).sort();
  }, [prospectosData, selectedProvincia]);

  const barrios = useMemo(() => {
    const uniqueBarrios = new Set<string>();
    prospectosData.forEach(p => {
      if (selectedProvincia !== "all" && p.provincia !== selectedProvincia) return;
      if (selectedCiudad !== "all" && p.ciudad !== selectedCiudad) return;
      if (p.barrio) uniqueBarrios.add(p.barrio);
    });
    return Array.from(uniqueBarrios).sort();
  }, [prospectosData, selectedProvincia, selectedCiudad]);

  const tiposNegocio = useMemo(() => {
    const uniqueTipos = new Set<string>();
    prospectosData.forEach(p => {
      if (p.tipo_principal) uniqueTipos.add(p.tipo_principal);
      if (p.tipos) p.tipos.forEach(t => uniqueTipos.add(t));
    });
    return Array.from(uniqueTipos).sort();
  }, [prospectosData]);

  const nivelesPrecio = useMemo(() => {
    const uniqueNiveles = new Set<string>();
    prospectosData.forEach(p => {
      if (p.nivel_precio) uniqueNiveles.add(p.nivel_precio);
    });
    return Array.from(uniqueNiveles).sort();
  }, [prospectosData]);

  // Datos filtrados
  const filteredData = useMemo(() => {
    return prospectosData.filter(p => {
      const matchProvincia = selectedProvincia === "all" || p.provincia === selectedProvincia;
      const matchCiudad = selectedCiudad === "all" || p.ciudad === selectedCiudad;
      const matchBarrio = selectedBarrio === "all" || p.barrio === selectedBarrio;
      const matchTipos = selectedTipos.length === 0 || 
        selectedTipos.some(t => p.tipo_principal === t || (p.tipos && p.tipos.includes(t)));
      const matchNivelPrecio = selectedNivelPrecio === "all" || p.nivel_precio === selectedNivelPrecio;
      const matchRating = (p.rating || 0) >= minRating;
      const matchSearch = searchTerm === "" || 
        p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.direccion || "").toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchProvincia && matchCiudad && matchBarrio && matchTipos && 
             matchNivelPrecio && matchRating && matchSearch;
    });
  }, [prospectosData, selectedProvincia, selectedCiudad, selectedBarrio, 
      selectedTipos, selectedNivelPrecio, minRating, searchTerm]);

  // KPIs calculados
  const kpis = useMemo(() => {
    const total = filteredData.length;
    const conTelefono = filteredData.filter(p => p.telefono).length;
    const porcentajeConTelefono = total > 0 ? Math.round((conTelefono / total) * 100) : 0;
    const conRating = filteredData.filter(p => p.rating !== null);
    const ratingPromedio = conRating.length > 0 
      ? conRating.reduce((sum, p) => sum + (p.rating || 0), 0) / conRating.length 
      : 0;
    const tiposUnicos = new Set(filteredData.map(p => p.tipo_principal).filter(Boolean)).size;

    return { total, porcentajeConTelefono, ratingPromedio, tiposUnicos };
  }, [filteredData]);

  // Top barrios por cantidad
  const topBarriosCantidad = useMemo(() => {
    const barriosMap = new Map<string, { count: number; totalRating: number; ratingCount: number }>();
    filteredData.forEach(p => {
      if (p.barrio) {
        const current = barriosMap.get(p.barrio) || { count: 0, totalRating: 0, ratingCount: 0 };
        current.count++;
        if (p.rating) {
          current.totalRating += p.rating;
          current.ratingCount++;
        }
        barriosMap.set(p.barrio, current);
      }
    });
    return Array.from(barriosMap.entries())
      .map(([barrio, data]) => ({ 
        barrio, 
        cantidad: data.count,
        ratingPromedio: data.ratingCount > 0 ? data.totalRating / data.ratingCount : 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
  }, [filteredData]);

  // Top tipos de negocio
  const topTiposNegocio = useMemo(() => {
    const tiposMap = new Map<string, { count: number; totalRating: number; ratingCount: number }>();
    filteredData.forEach(p => {
      if (p.tipo_principal) {
        const current = tiposMap.get(p.tipo_principal) || { count: 0, totalRating: 0, ratingCount: 0 };
        current.count++;
        if (p.rating) {
          current.totalRating += p.rating;
          current.ratingCount++;
        }
        tiposMap.set(p.tipo_principal, current);
      }
    });
    return Array.from(tiposMap.entries())
      .map(([tipo, data]) => ({ 
        tipo: formatTipoNegocio(tipo), 
        cantidad: data.count,
        ratingPromedio: data.ratingCount > 0 ? data.totalRating / data.ratingCount : 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
  }, [filteredData]);

  // Distribución por nivel de precio
  const distribucionPrecio = useMemo(() => {
    const preciosMap = new Map<string, number>();
    filteredData.forEach(p => {
      const nivel = p.nivel_precio || "Sin info";
      preciosMap.set(nivel, (preciosMap.get(nivel) || 0) + 1);
    });
    const total = filteredData.length;
    return Array.from(preciosMap.entries())
      .map(([nivel, cantidad]) => ({ 
        nivel, 
        cantidad,
        porcentaje: total > 0 ? Math.round((cantidad / total) * 100) : 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredData]);

  // Paginación
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const handleClearFilters = () => {
    setSelectedProvincia("all");
    setSelectedCiudad("all");
    setSelectedBarrio("all");
    setSelectedTipos([]);
    setSelectedNivelPrecio("all");
    setMinRating(0);
    setSearchTerm("");
    setCurrentPage(1);
  };

  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedCiudad("all");
    setSelectedBarrio("all");
    setCurrentPage(1);
  };

  const handleCiudadChange = (value: string) => {
    setSelectedCiudad(value);
    setSelectedBarrio("all");
    setCurrentPage(1);
  };


  const handleExportCSV = () => {
    const headers = ["Nombre", "Tipo", "Barrio", "Ciudad", "Provincia", "Rating", "Nivel Precio", "Teléfono", "Website"];
    const rows = filteredData.map(p => [
      p.nombre,
      p.tipo_principal || "",
      p.barrio || "",
      p.ciudad,
      p.provincia,
      p.rating?.toString() || "",
      formatNivelPrecio(p.nivel_precio),
      p.telefono || "",
      p.website || ""
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prospectos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Exportación exitosa",
      description: `Se exportaron ${filteredData.length} prospectos`,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <img src={cupraLogo} alt="Cupra Logo" className="w-32 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate('/')}
              className="border-border/60"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground">
                Dashboard de Prospectos
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Exploración y análisis de prospectos potenciales
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={handleExportCSV}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
            <img src={cupraLogo} alt="Cupra Logo" className="h-10 md:h-12" />
          </div>
        </div>

        {/* Panel de Filtros */}
        <Card className="matte-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="h-5 w-5" />
              Filtros Interactivos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Buscar
                </label>
                <Input
                  placeholder="Nombre o dirección..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="bg-background/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Provincia
                </label>
                <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todas</SelectItem>
                    {provincias.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ciudad
                </label>
                <Select 
                  value={selectedCiudad} 
                  onValueChange={handleCiudadChange}
                  disabled={selectedProvincia === "all"}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder={selectedProvincia === "all" ? "Seleccione provincia" : "Todas"} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todas</SelectItem>
                    {ciudades.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Barrio
                </label>
                <Select 
                  value={selectedBarrio} 
                  onValueChange={(v) => { setSelectedBarrio(v); setCurrentPage(1); }}
                  disabled={selectedProvincia === "all"}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder={selectedProvincia === "all" ? "Seleccione provincia" : "Todos"} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {barrios.map(b => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Tipo de Negocio
                </label>
                <MultiSelect
                  options={tiposNegocio.map(t => ({ label: formatTipoNegocio(t), value: t }))}
                  selected={selectedTipos}
                  onChange={(v) => { setSelectedTipos(v); setCurrentPage(1); }}
                  placeholder="Todos los tipos"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Nivel Precio
                </label>
                <Select 
                  value={selectedNivelPrecio} 
                  onValueChange={(v) => { setSelectedNivelPrecio(v); setCurrentPage(1); }}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {nivelesPrecio.map(n => (
                      <SelectItem key={n} value={n}>{formatNivelPrecio(n)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Rating Mínimo: {minRating.toFixed(1)} ⭐
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

            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Limpiar Filtros
              </Button>
              <Badge variant="secondary" className="ml-auto">
                {filteredData.length} prospectos filtrados
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Prospectos
                </CardTitle>
                <Store className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {kpis.total.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Con Teléfono
                </CardTitle>
                <Phone className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {kpis.porcentajeConTelefono}%
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Rating Promedio
                </CardTitle>
                <Star className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground flex items-center gap-1">
                {kpis.ratingPromedio.toFixed(2)} <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tipos de Negocio
                </CardTitle>
                <MapPin className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {kpis.tiposUnicos}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rankings */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top Barrios */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-accent" />
                Top 10 Barrios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topBarriosCantidad.map((item, idx) => (
                  <div key={item.barrio} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                        {idx + 1}
                      </Badge>
                      <span className="text-sm font-medium truncate max-w-[120px]">{item.barrio}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{item.cantidad}</span>
                      <span className="text-xs text-yellow-500 flex items-center gap-0.5">
                        {item.ratingPromedio.toFixed(1)} <Star className="h-3 w-3 fill-current" />
                      </span>
                    </div>
                  </div>
                ))}
                {topBarriosCantidad.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin datos</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Tipos de Negocio */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Store className="h-5 w-5 text-accent" />
                Top 10 Tipos de Negocio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topTiposNegocio.map((item, idx) => (
                  <div key={item.tipo} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                        {idx + 1}
                      </Badge>
                      <span className="text-sm font-medium truncate max-w-[120px]">{item.tipo}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{item.cantidad}</span>
                      <span className="text-xs text-yellow-500 flex items-center gap-0.5">
                        {item.ratingPromedio.toFixed(1)} <Star className="h-3 w-3 fill-current" />
                      </span>
                    </div>
                  </div>
                ))}
                {topTiposNegocio.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin datos</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Distribución por Precio */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                💰 Distribución por Precio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {distribucionPrecio.map((item) => (
                  <div key={item.nivel} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <span className="text-sm font-medium">{formatNivelPrecio(item.nivel === "Sin info" ? null : item.nivel)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{item.cantidad}</span>
                      <Badge variant="secondary">{item.porcentaje}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla de Prospectos */}
        <Card className="matte-card">
          <CardHeader>
            <CardTitle className="text-lg">Detalle de Prospectos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Web</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedData.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {p.nombre}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {p.tipo_principal ? formatTipoNegocio(p.tipo_principal) : "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                        {p.barrio ? `${p.barrio}, ` : ""}{p.ciudad}
                      </TableCell>
                      <TableCell>
                        {p.rating ? (
                          <span className="flex items-center gap-1 text-sm">
                            {p.rating.toFixed(1)} <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            <span className="text-xs text-muted-foreground">({p.total_ratings})</span>
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatNivelPrecio(p.nivel_precio)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.telefono ? (
                          <a href={`tel:${p.telefono}`} className="text-accent hover:underline">
                            {p.telefono}
                          </a>
                        ) : "-"}
                      </TableCell>
                      <TableCell>
                        {p.website ? (
                          <a 
                            href={p.website} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-accent hover:underline flex items-center gap-1"
                          >
                            <Globe className="h-3 w-3" />
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {paginatedData.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No se encontraron prospectos con los filtros seleccionados
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, filteredData.length)} de {filteredData.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProspectosDashboard;
