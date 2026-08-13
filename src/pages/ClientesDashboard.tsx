/**
 * Dashboard de Clientes y Ventas
 * 
 * FUENTE DE VERDAD ÚNICA: tabla `ventas_cupra` (transaccional, Excel de ventas)
 * ─────────────────────────────────────────────────────────────────────────────
 * • Ventas Totales: SUM(facturacion_ars) desde ventas_cupra. Columna Excel: "Precio Total Final".
 * • Tickets Únicos: COUNT(DISTINCT ticket) desde ventas_cupra.
 * • Clientes: COUNT(DISTINCT razon_social) desde ventas_cupra.
 * • Ticket Promedio: Ventas Totales / Tickets Únicos.
 * • Top Vendedores: GROUP BY vendedor, SUM(facturacion_ars) desde ventas_cupra.
 * • Top Barrios: GROUP BY barrio (via join clientes), SUM(facturacion_ars) desde ventas_cupra.
 * 
 * NO se usan datos derivados de la tabla `clientes` para KPIs.
 * La tabla `clientes` solo se usa para filtros, segmentación y ZonaKPIs.
 */
import { useEffect, useState, useMemo } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
import AppNav from "@/components/AppNav";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Users, MapPin, DollarSign, ShoppingCart, Filter, RefreshCw, ClipboardList, Pencil, AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ZonaKPIs from "@/components/clientes/ZonaKPIs";
import ClienteDetalleDialog from "@/components/clientes/ClienteDetalleDialog";

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
  // KPIs 100% desde ventas_cupra
  const [ventasRaw, setVentasRaw] = useState<any[]>([]);
  const [ventasVendedorData, setVentasVendedorData] = useState<{ vendedor: string; ventas: number; tickets: number }[]>([]);
  
  // Filtros
  const [selectedProvincia, setSelectedProvincia] = useState<string>("all");
  const [selectedCiudad, setSelectedCiudad] = useState<string>("all");
  const [selectedBarrio, setSelectedBarrio] = useState<string>("all");
  const [selectedVendedor, setSelectedVendedor] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCanal, setSelectedCanal] = useState<string>("all");
  const [selectedCliente, setSelectedCliente] = useState<any | null>(null);
  const [detalleOpen, setDetalleOpen] = useState(false);

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

      if (!canViewSalesDashboard(profile?.rol)) {
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
    // Fetch clientes (para filtros, segmentación, ZonaKPIs)
    const { data: clientes } = await supabase
      .from('clientes')
      .select('*');
    if (clientes) setClientesData(clientes);

    // FUENTE DE VERDAD: Fetch TODAS las ventas desde ventas_cupra
    // Paginar para superar límite de 1000 filas
    let allVentas: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from('ventas_cupra')
        .select('vendedor, facturacion_ars, ticket, client_id, razon_social, ciudad')
        .range(offset, offset + pageSize - 1);
      if (!batch || batch.length === 0) break;
      allVentas = allVentas.concat(batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    setVentasRaw(allVentas);

    // Top Vendedores: GROUP BY vendedor, SUM(facturacion_ars)
    if (allVentas.length > 0) {
      const vendedorMap = new Map<string, { ventas: number; tickets: Set<string> }>();
      for (const v of allVentas) {
        if (!v.vendedor) continue;
        if (!vendedorMap.has(v.vendedor)) {
          vendedorMap.set(v.vendedor, { ventas: 0, tickets: new Set() });
        }
        const entry = vendedorMap.get(v.vendedor)!;
        entry.ventas += Number(v.facturacion_ars || 0);
        if (v.ticket) entry.tickets.add(v.ticket);
      }
      const vendedorArr = Array.from(vendedorMap.entries())
        .map(([vendedor, data]) => ({ vendedor, ventas: data.ventas, tickets: data.tickets.size }))
        .sort((a, b) => b.ventas - a.ventas);
      setVentasVendedorData(vendedorArr);
    }
  };

  const normalize = (str: string | null | undefined): string => {
    return str ? str.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  };

  const getClienteBarrios = (cliente: any): string[] => {
    if (cliente.todos_barrios?.length > 0) return cliente.todos_barrios;
    if (cliente.barrio_principal) return [cliente.barrio_principal];
    return [];
  };

  const getClienteCiudades = (cliente: any): string[] => {
    if (cliente.todas_ciudades?.length > 0) return cliente.todas_ciudades;
    if (cliente.ciudad_principal) return [cliente.ciudad_principal];
    return [];
  };

  const provincias = useMemo(() => {
    const provinciasMap = new Map<string, string>();
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

  const ciudades = useMemo(() => {
    const ciudadesMap = new Map<string, string>();
    clientesData.forEach(cliente => {
      if (selectedProvincia !== "all" && cliente.provincia_principal !== selectedProvincia) return;
      const ciudadesList = getClienteCiudades(cliente);
      ciudadesList.forEach((c: string) => {
        if (c) {
          const key = normalize(c);
          if (!ciudadesMap.has(key)) ciudadesMap.set(key, c);
        }
      });
    });
    return Array.from(ciudadesMap.values()).sort();
  }, [clientesData, selectedProvincia]);

  const barrios = useMemo(() => {
    const barriosMap = new Map<string, string>();
    clientesData.forEach(cliente => {
      if (selectedProvincia !== "all" && cliente.provincia_principal !== selectedProvincia) return;
      if (selectedCiudad !== "all") {
        const ciudadesList = getClienteCiudades(cliente);
        if (!ciudadesList.some(c => normalize(c) === normalize(selectedCiudad))) return;
      }
      const barriosList = getClienteBarrios(cliente);
      barriosList.forEach((b: string) => {
        if (b) {
          const key = normalize(b);
          if (!barriosMap.has(key)) barriosMap.set(key, b);
        }
      });
    });
    return Array.from(barriosMap.values()).sort();
  }, [clientesData, selectedProvincia, selectedCiudad]);

  const vendedores = useMemo(() => {
    const uniqueVendedores = new Set<string>();
    clientesData.forEach(cliente => {
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

  const filteredData = useMemo(() => {
    return clientesData.filter(cliente => {
      const matchProvincia = selectedProvincia === "all" || 
        normalize(cliente.provincia_principal) === normalize(selectedProvincia);
      const ciudadesCliente = getClienteCiudades(cliente);
      const matchCiudad = selectedCiudad === "all" || 
        ciudadesCliente.some(c => normalize(c) === normalize(selectedCiudad));
      const barriosCliente = getClienteBarrios(cliente);
      const matchBarrio = selectedBarrio === "all" || 
        barriosCliente.some(b => normalize(b) === normalize(selectedBarrio));
      const vendedorCliente = cliente.vendedor_actual || cliente.vendedor_principal;
      const matchVendedor = selectedVendedor === "all" || vendedorCliente === selectedVendedor;
      const matchCanal = selectedCanal === "all" || cliente.canal === selectedCanal;
      const matchSearch = searchTerm === "" || 
        (cliente.razon_social || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (cliente.fantasia || "").toLowerCase().includes(searchTerm.toLowerCase());
      return matchProvincia && matchCiudad && matchBarrio && matchVendedor && matchCanal && matchSearch;
    });
  }, [clientesData, selectedProvincia, selectedCiudad, selectedBarrio, selectedVendedor, selectedCanal, searchTerm]);

  const hasActiveFilters =
    selectedProvincia !== "all" ||
    selectedCiudad !== "all" ||
    selectedBarrio !== "all" ||
    selectedVendedor !== "all" ||
    selectedCanal !== "all" ||
    searchTerm.trim() !== "";


  /**
   * KPIs calculados 100% desde ventas_cupra (transaccional).
   * • totalVentas: SUM(facturacion_ars). Columna Excel: "Precio Total Final".
   * • totalTickets: COUNT(DISTINCT ticket).
   * • totalClientes: COUNT(DISTINCT client_id).
   * • ticketPromedio: totalVentas / totalTickets.
   */
  const normalizeRS = (rs: string) => rs.trim().toUpperCase().replace(/\s+/g, ' ');

  // Ventas restringidas a los clientes que pasan los filtros activos
  const filteredVentas = useMemo(() => {
    if (!hasActiveFilters) return ventasRaw;
    const idSet = new Set<string>();
    const rsSet = new Set<string>();
    for (const c of filteredData) {
      if (c.client_id) idSet.add(String(c.client_id));
      if (c.razon_social) rsSet.add(normalizeRS(c.razon_social));
      if (c.fantasia) rsSet.add(normalizeRS(c.fantasia));
    }
    return ventasRaw.filter(v =>
      (v.client_id && idSet.has(String(v.client_id))) ||
      (v.razon_social && rsSet.has(normalizeRS(v.razon_social)))
    );
  }, [ventasRaw, filteredData, hasActiveFilters]);

  const kpis = useMemo(() => {
    const totalVentas = filteredVentas.reduce((sum, v) => sum + Number(v.facturacion_ars || 0), 0);
    const ticketsSet = new Set<string>();
    const clientesSet = new Set<string>();
    for (const v of filteredVentas) {
      if (v.ticket) ticketsSet.add(v.ticket);
      // Fix 4: Count clients by normalized razon_social, not client_id
      if (v.razon_social) clientesSet.add(normalizeRS(v.razon_social));
    }
    const totalTickets = ticketsSet.size;
    const totalClientes = clientesSet.size;
    const ticketPromedio = totalTickets > 0 ? totalVentas / totalTickets : 0;
    return { totalVentas, totalClientes, totalOrdenes: totalTickets, ticketPromedio };
  }, [filteredVentas]);


  // TAREA 13: Indicador de calidad de datos
  const dataQuality = useMemo(() => {
    const total = clientesData.length;
    if (total === 0) return null;
    const sinBarrio = clientesData.filter(c => !c.barrio_principal).length;
    const sinVendedor = clientesData.filter(c => !c.vendedor_actual && !c.vendedor_principal).length;
    const ultimaCarga = clientesData.reduce((latest, c) => {
      const d = c.updated_at ? new Date(c.updated_at) : null;
      return d && (!latest || d > latest) ? d : latest;
    }, null as Date | null);
    return {
      pctSinBarrio: Math.round(sinBarrio / total * 100),
      pctSinVendedor: Math.round(sinVendedor / total * 100),
      sinBarrio,
      sinVendedor,
      ultimaCarga,
    };
  }, [clientesData]);

  // Fix 5: Top Ciudades desde ventas_cupra (reemplaza Top Barrios)
  const topCiudades = useMemo(() => {
    const ciudadMap = new Map<string, { display: string; ventas: number }>();
    let sinCiudadVentas = 0;
    for (const v of filteredVentas) {
      const monto = Number(v.facturacion_ars || 0);
      const ciudad = v.ciudad;
      if (ciudad) {
        const key = normalize(ciudad);
        const existing = ciudadMap.get(key);
        if (existing) { existing.ventas += monto; }
        else { ciudadMap.set(key, { display: ciudad, ventas: monto }); }
      } else {
        sinCiudadVentas += monto;
      }
    }
    const result = Array.from(ciudadMap.values())
      .map(({ display, ventas }) => ({ ciudad: display, ventas }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
    if (sinCiudadVentas > 0) {
      result.push({ ciudad: 'Sin ciudad', ventas: sinCiudadVentas });
      result.sort((a, b) => b.ventas - a.ventas);
    }
    return result.slice(0, 11);
  }, [filteredVentas]);

  // Top Clientes desde ventas_cupra
  const topClientes = useMemo(() => {
    const clienteMap = new Map<string, { razon_social: string; monto_total: number; tickets: Set<string> }>();
    for (const v of filteredVentas) {
      const rs = v.razon_social || 'Sin nombre';
      if (!clienteMap.has(rs)) clienteMap.set(rs, { razon_social: rs, monto_total: 0, tickets: new Set() });
      const entry = clienteMap.get(rs)!;
      entry.monto_total += Number(v.facturacion_ars || 0);
      if (v.ticket) entry.tickets.add(v.ticket);
    }
    return Array.from(clienteMap.values())
      .map(c => ({ razon_social: c.razon_social, monto_total: c.monto_total, ordenes: c.tickets.size }))
      .sort((a, b) => b.monto_total - a.monto_total)
      .slice(0, 10);
  }, [filteredVentas]);

  // TAREA 4: Top vendedores desde ventas_cupra (fuente transaccional)
  const topVendedores = useMemo(() => {
    if (!hasActiveFilters) return ventasVendedorData.slice(0, 10);
    const map = new Map<string, { ventas: number; tickets: Set<string> }>();
    for (const v of filteredVentas) {
      if (!v.vendedor) continue;
      if (!map.has(v.vendedor)) map.set(v.vendedor, { ventas: 0, tickets: new Set() });
      const e = map.get(v.vendedor)!;
      e.ventas += Number(v.facturacion_ars || 0);
      if (v.ticket) e.tickets.add(v.ticket);
    }
    return Array.from(map.entries())
      .map(([vendedor, d]) => ({ vendedor, ventas: d.ventas, tickets: d.tickets.size }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
  }, [ventasVendedorData, filteredVentas, hasActiveFilters]);

  // Resumen por cliente (para la pestaña de listado + ficha)
  const clientesResumen = useMemo(() => {
    const byId = new Map<string, { ventas: number; tickets: Set<string> }>();
    const byRs = new Map<string, { ventas: number; tickets: Set<string> }>();
    for (const v of ventasRaw) {
      const monto = Number(v.facturacion_ars || 0);
      if (v.client_id) {
        const k = String(v.client_id);
        if (!byId.has(k)) byId.set(k, { ventas: 0, tickets: new Set() });
        const e = byId.get(k)!; e.ventas += monto; if (v.ticket) e.tickets.add(v.ticket);
      }
      if (v.razon_social) {
        const k = normalizeRS(v.razon_social);
        if (!byRs.has(k)) byRs.set(k, { ventas: 0, tickets: new Set() });
        const e = byRs.get(k)!; e.ventas += monto; if (v.ticket) e.tickets.add(v.ticket);
      }
    }
    return filteredData
      .map(c => {
        const stats = (c.client_id && byId.get(String(c.client_id)))
          || (c.razon_social && byRs.get(normalizeRS(c.razon_social)))
          || null;
        return {
          cliente: c,
          ventas: stats?.ventas ?? Number(c.monto_total_historico || 0),
          tickets: stats?.tickets.size ?? Number(c.cantidad_ordenes || 0),
        };
      })
      .sort((a, b) => b.ventas - a.ventas);
  }, [filteredData, ventasRaw]);

  const handleClearFilters = () => {
    setSelectedProvincia("all");
    setSelectedCiudad("all");
    setSelectedBarrio("all");
    setSelectedVendedor("all");
    setSelectedCanal("all");
    setSearchTerm("");
  };

  const handleProvinciaChange = (value: string) => {
    setSelectedProvincia(value);
    setSelectedCiudad("all");
    setSelectedBarrio("all");
  };

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
    <TooltipProvider>
    <div className="min-h-screen">
      <AppNav />
      <div className="max-w-[1920px] mx-auto space-y-7 p-5 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">
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

        {/* TAREA 13: Indicador de calidad de datos */}
        {dataQuality && (dataQuality.pctSinBarrio > 10 || dataQuality.pctSinVendedor > 5) && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-muted-foreground">
                  Calidad de datos:
                  {dataQuality.pctSinBarrio > 10 && (
                    <span className="ml-2 font-medium text-amber-500">{dataQuality.sinBarrio} clientes sin barrio ({dataQuality.pctSinBarrio}%)</span>
                  )}
                  {dataQuality.pctSinVendedor > 5 && (
                    <span className="ml-2 font-medium text-amber-500">{dataQuality.sinVendedor} sin vendedor ({dataQuality.pctSinVendedor}%)</span>
                  )}
                  {dataQuality.ultimaCarga && (
                    <span className="ml-3 text-muted-foreground/70">
                      · Últ. actualización: {dataQuality.ultimaCarga.toLocaleDateString('es-AR')}
                    </span>
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Panel de Filtros */}
        <Card className="matte-card">
           <CardHeader className="pb-4">
            <CardTitle className="section-title flex items-center gap-2">
              <Filter className="h-4 w-4 text-foreground/40" />
              Filtros Interactivos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <label className="filter-label">
                  Buscar Cliente
                </label>
                <Input
                  placeholder="Razón social..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-muted/50 border-border/60"
                />
              </div>

              <div className="space-y-2">
                <label className="filter-label">
                  Provincia
                </label>
                <Select value={selectedProvincia} onValueChange={handleProvinciaChange}>
                  <SelectTrigger className="bg-muted/50 border-border/60">
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
                <label className="filter-label">
                  Ciudad
                </label>
                <Select 
                  value={selectedCiudad} 
                  onValueChange={handleCiudadChange}
                  disabled={selectedProvincia === "all"}
                >
                  <SelectTrigger className="bg-muted/50 border-border/60">
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
                <label className="filter-label">
                  Barrio
                </label>
                <Select 
                  value={selectedBarrio} 
                  onValueChange={setSelectedBarrio}
                  disabled={selectedProvincia === "all"}
                >
                  <SelectTrigger className="bg-muted/50 border-border/60">
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
                <label className="filter-label">
                  Vendedor
                </label>
                <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                  <SelectTrigger className="bg-muted/50 border-border/60">
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
                <label className="filter-label">
                  Canal
                </label>
                <Select value={selectedCanal} onValueChange={setSelectedCanal}>
                  <SelectTrigger className="bg-muted/50 border-border/60">
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
                {filteredData.length} de {clientesData.length} clientes
              </Badge>

            </div>
          </CardContent>
        </Card>

        {/* KPI Cards — unified typography */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="matte-card hover-lift p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="kpi-label flex items-center gap-1.5">
                Ventas Totales
                <Tooltip>
                  <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground/40" /></TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    <p className="font-medium">SUM(facturacion_ars)</p>
                    <p>Fuente: ventas_cupra · Columna: Precio Total Final</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <DollarSign className="h-4 w-4 text-muted-foreground/30" />
            </div>
            <div className="kpi-value">{formatCurrency(kpis.totalVentas)}</div>
          </Card>

          <Card className="matte-card hover-lift p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="kpi-label flex items-center gap-1.5">
                Clientes
                <Tooltip>
                  <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground/40" /></TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    <p className="font-medium">COUNT(DISTINCT razon_social)</p>
                    <p>Fuente: ventas_cupra · Cliente único por razón social</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <Users className="h-4 w-4 text-muted-foreground/30" />
            </div>
            <div className="kpi-value">{kpis.totalClientes.toLocaleString()}</div>
          </Card>

          <Card className="matte-card hover-lift p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="kpi-label flex items-center gap-1.5">
                Tickets
                <Tooltip>
                  <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground/40" /></TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    <p className="font-medium">COUNT(DISTINCT ticket)</p>
                    <p>Fuente: ventas_cupra · Ticket único</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <ShoppingCart className="h-4 w-4 text-muted-foreground/30" />
            </div>
            <div className="kpi-value">{kpis.totalOrdenes.toLocaleString()}</div>
          </Card>

          <Card className="matte-card hover-lift p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="kpi-label flex items-center gap-1.5">
                Ticket Promedio
                <Tooltip>
                  <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground/40" /></TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    <p className="font-medium">Ventas Totales ÷ Tickets</p>
                    <p>Fuente: ventas_cupra · Promedio ponderado global</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <TrendingUp className="h-4 w-4 text-muted-foreground/30" />
            </div>
            <div className="kpi-value">{formatCurrency(kpis.ticketPromedio)}</div>
          </Card>
        </div>

        {/* Tabs: Clientes / Rankings / KPIs por Zona */}
        <Tabs defaultValue="clientes" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
            <TabsTrigger value="rankings">Top Rankings</TabsTrigger>
            <TabsTrigger value="zonas">KPIs por Zona</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes">
            <Card className="matte-card">
              <CardHeader className="pb-4">
                <CardTitle className="section-title flex items-center gap-2">
                  <Users className="h-4 w-4 text-foreground/40" />
                  Clientes ({clientesResumen.length})
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Clic en un cliente para ver su ficha completa
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {clientesResumen.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No hay clientes que coincidan con la búsqueda.
                  </p>
                ) : (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="max-h-[560px] overflow-y-auto overflow-x-auto scroll-visible">
                    <table className="w-full text-sm table-fixed min-w-[840px]">
                      <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur supports-[backdrop-filter]:bg-secondary/80">
                        <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                          <th className="text-left py-3 px-4 font-semibold w-[30%]">Cliente</th>
                          <th className="text-left py-3 px-4 font-semibold w-[22%]">Zona</th>
                          <th className="text-left py-3 px-4 font-semibold w-[16%]">Vendedor</th>
                          <th className="text-center py-3 px-4 font-semibold w-[8%]">Tickets</th>
                          <th className="text-center py-3 px-4 font-semibold w-[12%]">Últ. compra</th>
                          <th className="text-right py-3 px-4 font-semibold w-[12%]">Facturación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientesResumen.slice(0, 300).map(({ cliente, ventas, tickets }) => (
                          <tr
                            key={cliente.client_id || cliente.id}
                            onClick={() => { setSelectedCliente(cliente); setDetalleOpen(true); }}
                            className="border-b border-border/20 cursor-pointer hover:bg-card/60 transition-colors"
                          >
                            <td className="py-2.5 px-4">
                              <span className="font-medium block truncate">{cliente.razon_social || cliente.fantasia || 'Sin nombre'}</span>
                              {cliente.cuit_dni && (
                                <span className="block text-xs text-muted-foreground">{cliente.cuit_dni}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground truncate">
                              {[cliente.barrio_principal, cliente.ciudad_principal].filter(Boolean).join(' · ') || '—'}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground truncate">
                              {cliente.vendedor_actual || cliente.vendedor_principal || '—'}
                            </td>
                            <td className="py-2.5 px-4 text-center text-muted-foreground">{tickets || 0}</td>
                            <td className="py-2.5 px-4 text-center text-muted-foreground">
                              {cliente.ultima_compra ? new Date(`${cliente.ultima_compra}T12:00:00`).toLocaleDateString('es-AR') : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-semibold text-accent whitespace-nowrap">{formatCurrency(ventas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    {clientesResumen.length > 300 && (
                      <p className="text-xs text-muted-foreground p-3 border-t border-border/40">
                        Mostrando los primeros 300 de {clientesResumen.length}. Refiná la búsqueda para ver más.
                      </p>
                    )}
                  </div>

                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="zonas">
            <ZonaKPIs clientesData={filteredData} ventasData={filteredVentas} formatCurrency={formatCurrency} />
          </TabsContent>


          <TabsContent value="rankings">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Ciudades (reemplaza Top Barrios) */}
          <Card className="matte-card">
            <CardHeader className="pb-4">
             <CardTitle className="section-title flex items-center gap-2">
                <MapPin className="h-4 w-4 text-foreground/40" />
                Top Ciudades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topCiudades.map((item, index) => (
                  <div
                    key={item.ciudad}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      item.ciudad === 'Sin ciudad' 
                        ? 'bg-amber-500/5 border-amber-500/20' 
                        : 'bg-card/50 border-border/40 hover:bg-card/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge variant="secondary" className="shrink-0">
                        {index + 1}
                      </Badge>
                      <span className="text-sm font-medium text-foreground truncate">
                        {item.ciudad}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-accent ml-2 shrink-0">
                      {formatCurrency(item.ventas)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Clientes */}
          <Card className="matte-card">
            <CardHeader className="pb-4">
             <CardTitle className="section-title flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-foreground/40" />
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
                            · {cliente.ordenes} tickets
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
            <CardHeader className="pb-4">
             <CardTitle className="section-title flex items-center gap-2">
                <Users className="h-4 w-4 text-foreground/40" />
                Top Vendedores
                <Tooltip>
                  <TooltipTrigger><Info className="h-3 w-3 text-foreground/30" /></TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    <p className="font-medium">SUM(facturacion_ars) desde ventas_cupra</p>
                    <p>Fuente transaccional · No afectado por filtros</p>
                  </TooltipContent>
                </Tooltip>
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
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground truncate block">
                          {vendedor.vendedor}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {vendedor.tickets} tickets
                        </span>
                      </div>
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

        <ClienteDetalleDialog
          cliente={selectedCliente}
          open={detalleOpen}
          onOpenChange={setDetalleOpen}
          formatCurrency={formatCurrency}
        />
      </div>
    </div>
    </TooltipProvider>
  );
};

export default ClientesDashboard;
