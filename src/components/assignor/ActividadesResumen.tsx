import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wine, GraduationCap, Calendar, Sparkles, Users } from "lucide-react";

const TIPOS_ACTIVACION = [
  { value: 'degustacion', label: 'Degustación', icon: Wine },
  { value: 'capacitacion', label: 'Capacitación', icon: GraduationCap },
  { value: 'evento', label: 'Evento', icon: Calendar },
  { value: 'otro', label: 'Otro', icon: Sparkles },
];

const META_MENSUAL = 4;

interface VendedorActivaciones {
  vendedor_id: string;
  nombre: string;
  activaciones: Array<{
    id: string;
    tipo: string;
    descripcion: string | null;
    fecha: string;
  }>;
}

const ActividadesResumen = () => {
  const [vendedoresData, setVendedoresData] = useState<VendedorActivaciones[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesOffset, setMesOffset] = useState(0); // 0 = este mes, -1 = mes anterior, etc.

  useEffect(() => {
    fetchData();
  }, [mesOffset]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth() + mesOffset, 1);
      const startOfMonth = targetDate.toISOString().split('T')[0];
      const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).toISOString().split('T')[0];

      // Fetch all active vendedores
      const { data: vendedores } = await supabase
        .from('profiles')
        .select('user_id, nombre')
        .eq('rol', 'vendedor')
        .eq('activo', true);

      if (!vendedores) return;

      // Fetch activaciones for the month
      const { data: activaciones } = await supabase
        .from('activaciones')
        .select('*')
        .gte('fecha', startOfMonth)
        .lte('fecha', endOfMonth);

      // Map to vendedores
      const result: VendedorActivaciones[] = vendedores.map(v => ({
        vendedor_id: v.user_id,
        nombre: v.nombre,
        activaciones: (activaciones || [])
          .filter(a => a.vendedor_id === v.user_id)
          .map(a => ({ id: a.id, tipo: a.tipo, descripcion: a.descripcion, fecha: a.fecha })),
      }));

      // Sort by activaciones count desc
      result.sort((a, b) => b.activaciones.length - a.activaciones.length);
      setVendedoresData(result);
    } catch (error) {
      console.error('Error fetching activaciones resumen:', error);
    } finally {
      setLoading(false);
    }
  };

  const mesLabel = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + mesOffset);
    return d.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  }, [mesOffset]);

  const totalActivaciones = vendedoresData.reduce((sum, v) => sum + v.activaciones.length, 0);
  const vendedoresConMeta = vendedoresData.filter(v => v.activaciones.length >= META_MENSUAL).length;

  return (
    <Card className="matte-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-accent" />
            Activaciones por Vendedor
          </CardTitle>
          <Select value={String(mesOffset)} onValueChange={v => setMesOffset(Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Este mes</SelectItem>
              <SelectItem value="-1">Mes anterior</SelectItem>
              <SelectItem value="-2">Hace 2 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Total:</span>{" "}
            <span className="font-bold">{totalActivaciones}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Meta cumplida:</span>{" "}
            <span className="font-bold text-emerald-500">
              {vendedoresConMeta}/{vendedoresData.length}
            </span>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : (
          <div className="space-y-3">
            {vendedoresData.map(v => {
              const progreso = Math.min((v.activaciones.length / META_MENSUAL) * 100, 100);
              const cumple = v.activaciones.length >= META_MENSUAL;
              return (
                <div key={v.vendedor_id} className="p-3 rounded-lg bg-muted/30 border border-border/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{v.nombre}</span>
                    </div>
                    <span className={`text-sm font-bold ${cumple ? 'text-emerald-500' : 'text-foreground'}`}>
                      {v.activaciones.length}/{META_MENSUAL}
                    </span>
                  </div>
                  <Progress value={progreso} className="h-1.5 mb-1.5" />
                  {v.activaciones.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {TIPOS_ACTIVACION.map(t => {
                        const count = v.activaciones.filter(a => a.tipo === t.value).length;
                        if (count === 0) return null;
                        const Icon = t.icon;
                        return (
                          <Badge key={t.value} variant="secondary" className="text-xs gap-0.5">
                            <Icon className="h-2.5 w-2.5" />
                            {count}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ActividadesResumen;
