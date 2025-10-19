import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Users, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo.png";

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
  const [barriosData, setBarriosData] = useState<BarrioVentas[]>([]);
  const [clientesData, setClientesData] = useState<ClienteVentas[]>([]);
  const [vendedoresData, setVendedoresData] = useState<VendedorVentas[]>([]);

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
      .select('barrio_principal, todos_barrios, razon_social, monto_total_historico, vendedor_principal, todos_vendedores');

    if (!clientes) return;

    // Procesar barrios con más ventas
    const barriosMap = new Map<string, number>();
    clientes.forEach(cliente => {
      const barrios = cliente.todos_barrios || [cliente.barrio_principal];
      const monto = cliente.monto_total_historico || 0;
      barrios.forEach((barrio: string) => {
        if (barrio) {
          barriosMap.set(barrio, (barriosMap.get(barrio) || 0) + Number(monto));
        }
      });
    });
    const barriosOrdenados = Array.from(barriosMap.entries())
      .map(([barrio, ventas]) => ({ barrio, ventas }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
    setBarriosData(barriosOrdenados);

    // Top 5 clientes con más ventas
    const clientesOrdenados = clientes
      .map(c => ({
        razon_social: c.razon_social || 'Sin nombre',
        monto_total: Number(c.monto_total_historico || 0)
      }))
      .sort((a, b) => b.monto_total - a.monto_total)
      .slice(0, 5);
    setClientesData(clientesOrdenados);

    // Vendedores con más ventas
    const vendedoresMap = new Map<string, number>();
    clientes.forEach(cliente => {
      const vendedores = cliente.todos_vendedores || [cliente.vendedor_principal];
      const monto = cliente.monto_total_historico || 0;
      vendedores.forEach((vendedor: string) => {
        if (vendedor) {
          vendedoresMap.set(vendedor, (vendedoresMap.get(vendedor) || 0) + Number(monto));
        }
      });
    });
    const vendedoresOrdenados = Array.from(vendedoresMap.entries())
      .map(([vendedor, ventas]) => ({ vendedor, ventas }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10);
    setVendedoresData(vendedoresOrdenados);
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
        <img src={cupraLogo} alt="Cupra Logo" className="w-64 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
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
              <h1 className="text-4xl font-bold text-foreground">
                Dashboard de Consultas
              </h1>
              <p className="text-muted-foreground mt-1">
                Análisis completo de clientes y ventas
              </p>
            </div>
          </div>
          <img src={cupraLogo} alt="Cupra Logo" className="h-16" />
        </div>

        {/* Métricas Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Barrios con más ventas */}
          <Card className="matte-card p-6 hover-lift">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-accent/20">
                <MapPin className="h-6 w-6 text-accent" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Barrios con Más Ventas
                </h2>
                <p className="text-sm text-muted-foreground">Top 10 zonas</p>
              </div>
            </div>
            <div className="space-y-3">
              {barriosData.map((barrio, index) => (
                <div
                  key={barrio.barrio}
                  className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-accent w-6">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {barrio.barrio}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-secondary">
                    {formatCurrency(barrio.ventas)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Top 5 Clientes */}
          <Card className="matte-card p-6 hover-lift">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-secondary/20">
                <TrendingUp className="h-6 w-6 text-secondary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Top 5 Clientes
                </h2>
                <p className="text-sm text-muted-foreground">Por volumen de ventas</p>
              </div>
            </div>
            <div className="space-y-3">
              {clientesData.map((cliente, index) => (
                <div
                  key={cliente.razon_social}
                  className="flex items-start justify-between p-4 rounded-lg bg-card/50 border border-border/40"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <span className="text-xl font-bold text-secondary w-6">
                      {index + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground line-clamp-2">
                        {cliente.razon_social}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatCurrency(cliente.monto_total)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Vendedores con más ventas */}
          <Card className="matte-card p-6 hover-lift">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-accent/20">
                <Users className="h-6 w-6 text-accent" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Vendedores Destacados
                </h2>
                <p className="text-sm text-muted-foreground">Por valor de ventas</p>
              </div>
            </div>
            <div className="space-y-3">
              {vendedoresData.map((vendedor, index) => (
                <div
                  key={vendedor.vendedor}
                  className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-accent w-6">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {vendedor.vendedor}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-secondary">
                    {formatCurrency(vendedor.ventas)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ClientesDashboard;
