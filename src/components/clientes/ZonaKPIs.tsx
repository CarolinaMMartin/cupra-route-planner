import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, TrendingUp, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ZonaKPIsProps {
  clientesData: any[];
  formatCurrency: (amount: number) => string;
}

const ZonaKPIs = ({ clientesData, formatCurrency }: ZonaKPIsProps) => {
  // Categorías del manual de operaciones
  const categorizeClient = (diasSinCompra: number | null): 'activo' | 'inactivo' | 'perdido' => {
    if (diasSinCompra === null || diasSinCompra === undefined) return 'perdido';
    if (diasSinCompra <= 30) return 'activo';
    if (diasSinCompra <= 90) return 'inactivo';
    return 'perdido';
  };

  const zonaData = useMemo(() => {
    const zonaMap = new Map<string, {
      barrio: string;
      total: number;
      activos: number;
      inactivos: number;
      perdidos: number;
      ventas: number;
      ordenes: number;
      vendedores: Set<string>;
    }>();

    clientesData.forEach(cliente => {
      const barrio = cliente.barrio_principal || 'Sin barrio';
      const key = barrio.trim().toLowerCase();
      
      if (!zonaMap.has(key)) {
        zonaMap.set(key, {
          barrio,
          total: 0,
          activos: 0,
          inactivos: 0,
          perdidos: 0,
          ventas: 0,
          ordenes: 0,
          vendedores: new Set(),
        });
      }

      const zona = zonaMap.get(key)!;
      zona.total++;
      
      const categoria = categorizeClient(cliente.dias_desde_ultima_compra);
      if (categoria === 'activo') zona.activos++;
      else if (categoria === 'inactivo') zona.inactivos++;
      else zona.perdidos++;

      zona.ventas += Number(cliente.monto_total_historico || 0);
      zona.ordenes += Number(cliente.cantidad_ordenes || 0);
      
      const vendedores = cliente.todos_vendedores || [cliente.vendedor_principal];
      vendedores.forEach((v: string) => v && zona.vendedores.add(v));
    });

    return Array.from(zonaMap.values())
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 15);
  }, [clientesData]);

  // KPIs globales por estado
  const globalStats = useMemo(() => {
    let activos = 0, inactivos = 0, perdidos = 0;
    clientesData.forEach(c => {
      const cat = categorizeClient(c.dias_desde_ultima_compra);
      if (cat === 'activo') activos++;
      else if (cat === 'inactivo') inactivos++;
      else perdidos++;
    });
    const total = clientesData.length;
    return { activos, inactivos, perdidos, total };
  }, [clientesData]);

  if (clientesData.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Resumen global por estado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Activos</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{globalStats.activos}</div>
            <p className="text-xs text-muted-foreground">
              Compraron en últimos 30 días ({globalStats.total > 0 ? Math.round(globalStats.activos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.activos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Inactivos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{globalStats.inactivos}</div>
            <p className="text-xs text-muted-foreground">
              1–3 meses sin comprar ({globalStats.total > 0 ? Math.round(globalStats.inactivos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.inactivos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Perdidos</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{globalStats.perdidos}</div>
            <p className="text-xs text-muted-foreground">
              +3 meses sin comprar ({globalStats.total > 0 ? Math.round(globalStats.perdidos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.perdidos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Tabla de zonas */}
      <Card className="matte-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent" />
            KPIs por Zona (Top 15 por facturación)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Zona</th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">Total</th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">
                    <span className="text-emerald-500">Act.</span>
                  </th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">
                    <span className="text-amber-500">Inact.</span>
                  </th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">
                    <span className="text-red-500">Perd.</span>
                  </th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Facturación</th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">Vendedores</th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {zonaData.map((zona, i) => {
                  const cobertura = zona.total > 0 ? Math.round(zona.activos / zona.total * 100) : 0;
                  return (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 text-xs">{i + 1}</Badge>
                          <span className="font-medium truncate max-w-[180px]">{zona.barrio}</span>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-2">{zona.total}</td>
                      <td className="text-center py-2.5 px-2 text-emerald-500 font-medium">{zona.activos}</td>
                      <td className="text-center py-2.5 px-2 text-amber-500 font-medium">{zona.inactivos}</td>
                      <td className="text-center py-2.5 px-2 text-red-500 font-medium">{zona.perdidos}</td>
                      <td className="text-right py-2.5 px-2 font-semibold text-accent">{formatCurrency(zona.ventas)}</td>
                      <td className="text-center py-2.5 px-2">{zona.vendedores.size}</td>
                      <td className="text-center py-2.5 px-2">
                        <div className="flex items-center gap-1.5 justify-center">
                          <Progress value={cobertura} className="w-12 h-1.5" />
                          <span className={`text-xs font-medium ${cobertura >= 50 ? 'text-emerald-500' : cobertura >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
                            {cobertura}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ZonaKPIs;
