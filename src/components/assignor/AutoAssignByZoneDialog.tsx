import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Loader2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface AutoAssignByZoneDialogProps {
  onAssignmentComplete: (count: number) => void;
}

const AutoAssignByZoneDialog = ({ onAssignmentComplete }: AutoAssignByZoneDialogProps) => {
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<any[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const loadAreas = async () => {
    const { data } = await supabase.from('areas').select('*');
    setAreas(data || []);
  };

  const handleAutoAssign = async () => {
    if (!selectedAreaId) return;
    setIsLoading(true);
    
    try {
      const { data } = await supabase.functions.invoke('generate-recommendations', {
        body: { area_id: selectedAreaId, max_recomendaciones: 15 }
      });
      
      if (data?.recomendaciones?.length > 0) {
        const asignaciones = data.recomendaciones.map((rec: any) => ({
          vendedor_id: rec.vendedor_recomendado_id,
          client_id: rec.client_id,
          estado: 'Asignado'
        }));
        
        await supabase.from('asignaciones_vendedores_clientes').insert(asignaciones);
        onAssignmentComplete(asignaciones.length);
        setOpen(false);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Error al auto-asignar" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) loadAreas(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Zap className="w-4 h-4" />
          Auto-Asignar por Zona
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto-Asignación por Zona</DialogTitle>
          <DialogDescription>La IA asignará clientes automáticamente</DialogDescription>
        </DialogHeader>
        <Select value={selectedAreaId} onValueChange={setSelectedAreaId}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar área..." />
          </SelectTrigger>
          <SelectContent>
            {areas.map((area) => (
              <SelectItem key={area.id} value={area.id}>{area.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleAutoAssign} disabled={!selectedAreaId || isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Asignar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default AutoAssignByZoneDialog;