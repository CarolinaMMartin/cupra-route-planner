import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Wine, GraduationCap, Calendar, Sparkles, Trash2 } from "lucide-react";

const TIPOS_ACTIVACION = [
  { value: 'degustacion', label: 'Degustación', icon: Wine },
  { value: 'capacitacion', label: 'Capacitación', icon: GraduationCap },
  { value: 'evento', label: 'Evento', icon: Calendar },
  { value: 'otro', label: 'Otro', icon: Sparkles },
];

const META_MENSUAL = 4;

interface Activacion {
  id: string;
  tipo: string;
  descripcion: string | null;
  fecha: string;
  client_id: string | null;
  prospecto_place_id: string | null;
  created_at: string;
}

const ActividadesPanel = () => {
  const [activaciones, setActivaciones] = useState<Activacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Form state
  const [tipo, setTipo] = useState('degustacion');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchActivaciones();
  }, []);

  const fetchActivaciones = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get current month range
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('activaciones')
        .select('*')
        .eq('vendedor_id', user.id)
        .gte('fecha', startOfMonth)
        .lte('fecha', endOfMonth)
        .order('fecha', { ascending: false });

      if (error) throw error;
      setActivaciones(data || []);
    } catch (error) {
      console.error('Error fetching activaciones:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const { error } = await supabase
        .from('activaciones')
        .insert({
          vendedor_id: user.id,
          tipo,
          descripcion: descripcion || null,
          fecha,
        });

      if (error) throw error;

      toast({ title: "✅ Activación registrada" });
      setShowDialog(false);
      setDescripcion('');
      setTipo('degustacion');
      setFecha(new Date().toISOString().split('T')[0]);
      fetchActivaciones();
    } catch (error) {
      console.error('Error:', error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo guardar" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('activaciones').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Activación eliminada" });
      fetchActivaciones();
    } catch (error) {
      toast({ variant: "destructive", title: "Error al eliminar" });
    }
  };

  const progreso = activaciones.length;
  const porcentaje = Math.min((progreso / META_MENSUAL) * 100, 100);
  const mesActual = new Date().toLocaleString('es-AR', { month: 'long' });

  const tipoCount = useMemo(() => {
    const counts: Record<string, number> = {};
    activaciones.forEach(a => {
      counts[a.tipo] = (counts[a.tipo] || 0) + 1;
    });
    return counts;
  }, [activaciones]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Activaciones de {mesActual}
          </CardTitle>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-3 w-3" />
                Registrar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Registrar Activación</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tipo</label>
                  <Select value={tipo} onValueChange={setTipo}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_ACTIVACION.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fecha</label>
                  <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Descripción (opcional)</label>
                  <Textarea 
                    value={descripcion} 
                    onChange={e => setDescripcion(e.target.value)}
                    placeholder="Ej: Degustación de Malbec en vinoteca..."
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progreso mensual</span>
            <span className={`font-bold ${progreso >= META_MENSUAL ? 'text-emerald-500' : 'text-foreground'}`}>
              {progreso}/{META_MENSUAL}
            </span>
          </div>
          <Progress value={porcentaje} className="h-2" />
          {progreso >= META_MENSUAL && (
            <p className="text-xs text-emerald-500 font-medium">🎉 ¡Meta alcanzada!</p>
          )}
        </div>

        {/* Type badges */}
        <div className="flex flex-wrap gap-1.5">
          {TIPOS_ACTIVACION.map(t => {
            const count = tipoCount[t.value] || 0;
            if (count === 0) return null;
            const Icon = t.icon;
            return (
              <Badge key={t.value} variant="secondary" className="gap-1 text-xs">
                <Icon className="h-3 w-3" />
                {t.label}: {count}
              </Badge>
            );
          })}
        </div>

        {/* List */}
        {!loading && activaciones.length > 0 && (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {activaciones.map(a => {
              const tipoInfo = TIPOS_ACTIVACION.find(t => t.value === a.tipo);
              const Icon = tipoInfo?.icon || Sparkles;
              return (
                <div key={a.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 border border-border/40">
                  <Icon className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{tipoInfo?.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.fecha).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                    {a.descripcion && (
                      <p className="text-xs text-muted-foreground truncate">{a.descripcion}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleDelete(a.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && activaciones.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Sin activaciones registradas este mes
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ActividadesPanel;
