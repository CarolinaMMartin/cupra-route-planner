import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Users, MapPin, DollarSign, ShoppingCart, Filter, Download, RefreshCw, ClipboardList, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ZonaKPIs from "@/components/clientes/ZonaKPIs";

interface BarrioVentas {
  barrio: string;
  ventas: number;
}

interface ClienteVentas {
  razon_social: string;
  monto_total: number;
}

interface VendedorVentas {
  vendedor: string;
  ventas: number;
}

const ClientesDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [clientesData, setClientesData] = useState<any[]>([]);
  
  // Filtros
  const [selectedProvincia, setSelectedProvincia] = useState<string>("all");
  const [selectedCiudad, setSelectedCiudad] = useState<string>("all");
  const [selectedBarrio, setSelectedBarrio] = useState<string>("all");
  const [selectedVendedor, setSelectedVendedor] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCanal, setSelectedCanal] = useState<string>("all");

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

      await fetchDashboardData();
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

  const fetchDashboardData = async () => {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('*');

    if (!clientes) return;
    setClientesData(clientes);
  };

  // Helper: normalizar strings para comparación case-insensitive
  const normalize = (str: string | null | undefined): string => {
    return str ? str.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  };

  // Helper: obtener barrios de un cliente con fallback robusto
  const getClienteBarrios = (cliente: any): string[] => {
    if (cliente.todos_barrios?.length > 0) return cliente.todos_barrios;
    if (cliente.barrio_principal) return [cliente.barrio_principal];
    return [];
  };

  // Helper: obtener ciudades de un cliente con fallback robusto
  const getClienteCiudades = (cliente: any): string[] => {
    if (cliente.todas_ciudades?.length > 0) return cliente.todas_ciudades;
    if (cliente.ciudad_principal) return [cliente.ciudad_principal];
    return [];
  };

  // Opciones únicas para filtros (con dedupe case-insensitive)
  const provincias = useMemo(() => {
    const provinciasMap = new Map<string, string>(); // normalized -> display
    clientesData.forEach(cliente => {
      if (cliente.provincia_principal) {
        const key = normalize(cliente.provincia_principal);
        if (!provinciasMap.has(key)) {
          provinciasMap.set(key, cliente.provincia_principal);
        }
      }
    });
    return Array.from(provinciasMap.values()).sort();
  }, [clientesData]);

  // Ciudades filtradas por provincia (con dedupe case-insensitive)
  const ciudades = useMemo(() => {
    const ciudadesMap = new Map<string, string>(); // normalized -> display
    clientesData.forEach(cliente => {
      if (selectedProvincia !== "all" && cliente.provincia_principal !== selectedProvincia) {
        return;
      }
      const ciudadesList = getClienteCiudades(cliente);
      ciudadesList.forEach((c: string) => {
        if (c) {
          const key = normalize(c);
          if (!ciudadesMap.has(key)) {
            ciudadesMap.set(key, c);
          }
        }
      });
    });
    return Array.from(ciudadesMap.values()).sort();
  }, [clientesData, selectedProvincia]);

  // Barrios filtrados por provincia y ciudad (con dedupe case-insensitive)
  const barrios = useMemo(() => {
    const barriosMap = new Map<string, string>(); // normalized -> display
    clientesData.forEach(cliente => {
      if (selectedProvincia !== "all" && cliente.provincia_principal !== selectedProvincia) {
        return;
      }
      if (selectedCiudad !== "all") {
        const ciudadesList = getClienteCiudades(cliente);
        const matchCiudad = ciudadesList.some(c => normalize(c) === normalize(selectedCiudad));
        if (!matchCiudad) {
          return;
        }
      }
      const barriosList = getClienteBarrios(cliente);
      barriosList.forEach((b: string) => {
        if (b) {
          const key = normalize(b);
          if (!barriosMap.has(key)) {
            barriosMap.set(key, b);
          }
        }
      });
    });
    return Array.from(barriosMap.values()).sort();
  }, [clientesData, selectedProvincia, selectedCiudad]);

  const vendedores = useMemo(() => {
    const uniqueVendedores = new Set<string>();
    clientesData.forEach(cliente => {
      // Usar vendedor_actual (único) para evitar duplicación multi-vendedor
      const vendedor = cliente.vendedor_actual || cliente.vendedor_principal;
      if (vendedor) uniqueVendedores.add(vendedor);
    });
    return Array.from(uniqueVendedores).sort();
  }, [clientesData]);

  const canales = useMemo(() => {
    const uniqueCanales = new Set<string>();
    clientesData.forEach(cliente => {
      if (cliente.canal) uniqueCanales.add(cliente.canal);
    });
    return Array.from(uniqueCanales).sort();
  }, [clientesData]);

  // Datos filtrados (con comparación case-insensitive para provincia, barrio y ciudad)
  const filteredData = useMemo(() => {
    return clientesData.filter(cliente => {
      const matchProvincia = selectedProvincia === "all" || 
        normalize(cliente.provincia_principal) === normalize(selectedProvincia);
      
      // Ciudades: case-insensitive con fallback robusto
      const ciudadesCliente = getClienteCiudades(cliente);
      const matchCiudad = selectedCiudad === "all" || 
        ciudadesCliente.some(c => normalize(c) === normalize(selectedCiudad));
      
      // Barrios: case-insensitive con fallback robusto
      const barriosCliente = getClienteBarrios(cliente);
      const matchBarrio = selectedBarrio === "all" || 
        barriosCliente.some(b => normalize(b) === normalize(selectedBarrio));
      
      // Filtrar por vendedor_actual (único) para evitar que un cliente aparezca en múltiples vendedores
      const vendedorCliente = cliente.vendedor_actual || cliente.vendedor_principal;
      const matchVendedor = selectedVendedor === "all" || vendedorCliente === selectedVendedor;
      const matchCanal = selectedCanal === "all" || cliente.canal === selectedCanal;
      const matchSearch = searchTerm === "" || 
        (cliente.razon_social || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (cliente.fantasia || "").toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchProvincia && matchCiudad && matchBarrio && matchVendedor && matchCanal && matchSearch;
    });
  }, [clientesData, selectedProvincia, selectedCiudad, selectedBarrio, selectedVendedor, selectedCanal, searchTerm]);

  // KPIs calculados
  const kpis = useMemo(() => {
    const totalVentas = filteredData.reduce((sum, c) => sum + Number(c.monto_total_historico || 0), 0);
    const totalClientes = filteredData.length;
    const totalOrdenes = filteredData.reduce((sum, c) => sum + Number(c.cantidad_ordenes || 0), 0);
    const ticketPromedio = totalOrdenes > 0 ? totalVentas / totalOrdenes : 0;

    return { totalVentas, totalClientes, totalOrdenes, ticketPromedio };
  }, [filteredData]);

  // Top barrios - usar barrio_principal (único) para evitar inflación por múltiples barrios
  const topBarrios = useMemo(() => {
    const barriosMap = new Map<string, { display: string; ventas: number }>();
    filteredData.forEach(cliente => {
      const barrio = cliente.barrio_principal;
      const monto = Number(cliente.monto_total_historico || 0);
      if (barrio) {
        const key = normalize(barrio);
        const existing = barriosMap.get(key);
        if (existing) {
          existing.ventas += monto;
        } else {
          barriosMap.set(key, { display: barrio, ventas: monto });
        }
      }
    });
    return Array.from(barriosMap.values())
      .map(({ display, ventas }) => ({ barrio: display, ventas }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
  }, [filteredData]);

  // Top clientes
  const topClientes = useMemo(() => {
    return filteredData
      .map(c => ({
        razon_social: c.razon_social || 'Sin nombre',
        monto_total: Number(c.monto_total_historico || 0),
        ordenes: Number(c.cantidad_ordenes || 0),
        provincia: c.provincia_principal
      }))
      .sort((a, b) => b.monto_total - a.monto_total)
      .slice(0, 10);
  }, [filteredData]);

  // Top vendedores - usar vendedor_actual (único) para evitar doble conteo en clientes multi-vendedor
  const topVendedores = useMemo(() => {
    const vendedoresMap = new Map<string, { ventas: number; clientes: number }>();
    filteredData.forEach(cliente => {
      const vendedor = cliente.vendedor_actual || cliente.vendedor_principal;
      const monto = Number(cliente.monto_total_historico || 0);
      if (vendedor) {
        const existing = vendedoresMap.get(vendedor) || { ventas: 0, clientes: 0 };
        existing.ventas += monto;
        existing.clientes += 1;
        vendedoresMap.set(vendedor, existing);
      }
    });
    return Array.from(vendedoresMap.entries())
      .map(([vendedor, data]) => ({ vendedor, ventas: data.ventas, clientes: data.clientes }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
  }, [filteredData]);

  const handleClearFilters = () => {
    setSelectedProvincia("all");
    setSelectedCiudad("all");
    setSelectedBarrio("all");
    setSelectedVendedor("all");
    setSelectedCanal("all");
    setSearchTerm("");
  };

  // Manejar cambio de provincia (resetear ciudad y barrio)
  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedCiudad("all");
    setSelectedBarrio("all");
  };

  // Manejar cambio de ciudad (resetear barrio)
  const handleCiudadChange = (value: string) => {
    setSelectedCiudad(value);
    setSelectedBarrio("all");
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
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
              <h1 className="text-2xl md:text-3xl font-serif text-foreground tracking-tight">
                Dashboard de Consultas
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Análisis interactivo de clientes y ventas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => navigate('/clientes-edicion')}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              Editar Datos
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/supervision-vendedores')}
              className="gap-2"
            >
              <ClipboardList className="h-4 w-4" />
              Supervisión
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Buscar Cliente
                </label>
                <Input
                  placeholder="Razón social..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
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
                  onValueChange={setSelectedBarrio}
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
                  Vendedor
                </label>
                <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {vendedores.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Canal
                </label>
                <Select value={selectedCanal} onValueChange={setSelectedCanal}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {canales.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                {filteredData.length} clientes filtrados
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
                  Ventas Totales
                </CardTitle>
                <DollarSign className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">
                {formatCurrency(kpis.totalVentas)}
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Clientes
                </CardTitle>
                <Users className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">
                {kpis.totalClientes.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Órdenes Totales
                </CardTitle>
                <ShoppingCart className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">
                {kpis.totalOrdenes.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="matte-card hover-lift">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Ticket Promedio
                </CardTitle>
                <TrendingUp className="h-5 w-5 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">
                {formatCurrency(kpis.ticketPromedio)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs: Rankings / KPIs por Zona */}
        <Tabs defaultValue="rankings" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="rankings">Top Rankings</TabsTrigger>
            <TabsTrigger value="zonas">KPIs por Zona</TabsTrigger>
          </TabsList>

          <TabsContent value="zonas">
            <ZonaKPIs clientesData={filteredData} formatCurrency={formatCurrency} />
          </TabsContent>

          <TabsContent value="rankings">

        {/* Gráficos y Tablas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Barrios */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-accent" />
                Top 10 Barrios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topBarrios.map((barrio, index) => (
                  <div
                    key={barrio.barrio}
                    className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/40 hover:bg-card/70 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge variant="secondary" className="shrink-0">
                        {index + 1}
                      </Badge>
                      <span className="text-sm font-medium text-foreground truncate">
                        {barrio.barrio}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-accent ml-2 shrink-0">
                      {formatCurrency(barrio.ventas)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Clientes */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-secondary" />
                Top 10 Clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topClientes.map((cliente, index) => (
                  <div
                    key={`${cliente.razon_social}-${index}`}
                    className="p-3 rounded-lg bg-card/50 border border-border/40 hover:bg-card/70 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <Badge variant="secondary" className="shrink-0 mt-0.5">
                        {index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground line-clamp-1">
                          {cliente.razon_social}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-accent font-semibold">
                            {formatCurrency(cliente.monto_total)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            • {cliente.ordenes} órdenes
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Vendedores */}
          <Card className="matte-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-accent" />
                Top 10 Vendedores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topVendedores.map((vendedor, index) => (
                  <div
                    key={vendedor.vendedor}
                    className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/40 hover:bg-card/70 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge variant="secondary" className="shrink-0">
                        {index + 1}
                      </Badge>
                      <span className="text-sm font-medium text-foreground truncate">
                        {vendedor.vendedor}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-accent ml-2 shrink-0">
                      {formatCurrency(vendedor.ventas)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ClientesDashboard;
