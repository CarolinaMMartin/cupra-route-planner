import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ZonaKPIsProps {
  clientesData: any[];
  formatCurrency: (amount: number) => string;
}

/**
 * Categorías de estado comercial:
 * • activo: dias_desde_ultima_compra <= 30
 * • inactivo: 31–90 días
 * • perdido: >90 días
 * • sin_datos: dias_desde_ultima_compra === null (no confundir con "perdido")
 */
type ClientCategory = 'activo' | 'inactivo' | 'perdido' | 'sin_datos';

const ZonaKPIs = ({ clientesData, formatCurrency }: ZonaKPIsProps) => {
  const categorizeClient = (diasSinCompra: number | null): ClientCategory => {
    if (diasSinCompra === null || diasSinCompra === undefined) return 'sin_datos';
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
      sin_datos: number;
      ventas: number;
      ordenes: number;
      vendedores: Set<string>;
    }>();

    clientesData.forEach(cliente => {
      // TAREA 5: Clientes sin barrio → "Sin barrio asignado" (visible)
      const barrio = cliente.barrio_principal || '⚠️ Sin barrio asignado';
      const key = barrio.trim().toLowerCase();
      
      if (!zonaMap.has(key)) {
        zonaMap.set(key, {
          barrio,
          total: 0,
          activos: 0,
          inactivos: 0,
          perdidos: 0,
          sin_datos: 0,
          ventas: 0,
          ordenes: 0,
          vendedores: new Set(),
        });
      }

      const zona = zonaMap.get(key)!;
      zona.total++;
      
      // TAREA 6: Separar "sin_datos" de "perdidos"
      const categoria = categorizeClient(cliente.dias_desde_ultima_compra);
      if (categoria === 'activo') zona.activos++;
      else if (categoria === 'inactivo') zona.inactivos++;
      else if (categoria === 'perdido') zona.perdidos++;
      else zona.sin_datos++;

      zona.ventas += Number(cliente.monto_total_historico || 0);
      zona.ordenes += Number(cliente.cantidad_ordenes || 0);
      
      const vendedor = cliente.vendedor_actual || cliente.vendedor_principal;
      if (vendedor) zona.vendedores.add(vendedor);
    });

    return Array.from(zonaMap.values())
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 15);
  }, [clientesData]);

  // KPIs globales por estado
  const globalStats = useMemo(() => {
    let activos = 0, inactivos = 0, perdidos = 0, sin_datos = 0;
    clientesData.forEach(c => {
      const cat = categorizeClient(c.dias_desde_ultima_compra);
      if (cat === 'activo') activos++;
      else if (cat === 'inactivo') inactivos++;
      else if (cat === 'perdido') perdidos++;
      else sin_datos++;
    });
    const total = clientesData.length;
    return { activos, inactivos, perdidos, sin_datos, total };
  }, [clientesData]);

  if (clientesData.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Resumen global por estado — TAREA 6: 4 categorías */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground/90">Activos</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{globalStats.activos}</div>
            <p className="text-sm text-foreground/60">
              Compraron en últimos 30 días ({globalStats.total > 0 ? Math.round(globalStats.activos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.activos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground/90">Inactivos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{globalStats.inactivos}</div>
            <p className="text-sm text-foreground/60">
              1–3 meses sin comprar ({globalStats.total > 0 ? Math.round(globalStats.inactivos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.inactivos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground/90">Perdidos</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{globalStats.perdidos}</div>
            <p className="text-sm text-foreground/60">
              +3 meses sin comprar ({globalStats.total > 0 ? Math.round(globalStats.perdidos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.perdidos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        <Card className="matte-card hover-lift">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground/90">Sin datos</CardTitle>
              <HelpCircle className="h-4 w-4 text-foreground/40" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground/70">{globalStats.sin_datos}</div>
            <p className="text-sm text-foreground/60">
              Sin fecha de compra registrada ({globalStats.total > 0 ? Math.round(globalStats.sin_datos / globalStats.total * 100) : 0}%)
            </p>
            <Progress value={globalStats.total > 0 ? (globalStats.sin_datos / globalStats.total) * 100 : 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Tabla de zonas */}
      <Card className="matte-card">
        <CardHeader>
          <CardTitle className="section-title flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent" />
            KPIs por Zona (Top 15 por facturación)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left py-2.5 px-2 text-[13px] font-medium text-foreground/50 uppercase tracking-wide">Zona</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-foreground/50 uppercase tracking-wide">Total</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-emerald-500 uppercase tracking-wide">Act.</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-amber-500 uppercase tracking-wide">Inact.</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-red-500 uppercase tracking-wide">Perd.</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-foreground/40 uppercase tracking-wide">S/D</th>
                  <th className="text-right py-2.5 px-2 text-[13px] font-medium text-foreground/50 uppercase tracking-wide">Facturación</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-foreground/50 uppercase tracking-wide">Vend.</th>
                  <th className="text-center py-2.5 px-2 text-[13px] font-medium text-foreground/50 uppercase tracking-wide">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {zonaData.map((zona, i) => {
                  const cobertura = zona.total > 0 ? Math.round(zona.activos / zona.total * 100) : 0;
                  const isSinBarrio = zona.barrio.includes('Sin barrio');
                  return (
                    <tr key={i} className={`border-b border-border/30 transition-colors ${
                      isSinBarrio ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-muted/30'
                    }`}>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 text-xs">{i + 1}</Badge>
                          <span className={`font-medium truncate max-w-[180px] ${isSinBarrio ? 'text-amber-500' : ''}`}>
                            {zona.barrio}
                          </span>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-2">{zona.total}</td>
                      <td className="text-center py-2.5 px-2 text-emerald-500 font-medium">{zona.activos}</td>
                      <td className="text-center py-2.5 px-2 text-amber-500 font-medium">{zona.inactivos}</td>
                      <td className="text-center py-2.5 px-2 text-red-500 font-medium">{zona.perdidos}</td>
                      <td className="text-center py-2.5 px-2 text-muted-foreground/60 font-medium">{zona.sin_datos || '—'}</td>
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
