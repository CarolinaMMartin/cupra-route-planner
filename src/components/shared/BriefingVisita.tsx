import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BriefingVisitaProps {
  clientId?: string | null;
  prospectoPlaceId?: string | null;
  autoGenerar?: boolean;
}

const BriefingVisita = ({ clientId, prospectoPlaceId, autoGenerar = false }: BriefingVisitaProps) => {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const esProspecto = !!prospectoPlaceId;
  const idValido = esProspecto ? !!prospectoPlaceId : !!clientId;

  const generar = useCallback(
    async (forzar = false) => {
      if (!idValido) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("generate-briefing", {
          body: esProspecto
            ? { prospecto_place_id: prospectoPlaceId, forzar }
            : { client_id: clientId, forzar },
        });
        if (error) throw error;
        if (data?.briefing) setBriefing(data.briefing);
        else if (data?.error) throw new Error(data.error);
      } catch (e) {
        console.error("Error generando briefing", e);
        toast.error("No se pudo generar el briefing de visita");
      } finally {
        setLoading(false);
      }
    },
    [clientId, prospectoPlaceId, esProspecto, idValido],
  );

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      if (!idValido) return;
      setBriefing(null);
      setChecked(false);
      const query = supabase.from("visita_briefings").select("briefing");
      const { data } = esProspecto
        ? await query.eq("prospecto_place_id", prospectoPlaceId!).maybeSingle()
        : await query.eq("client_id", clientId!).maybeSingle();
      if (cancelado) return;
      if (data?.briefing) setBriefing(data.briefing);
      setChecked(true);
      if (!data?.briefing && autoGenerar) generar(false);
    };
    cargar();
    return () => {
      cancelado = true;
    };
  }, [clientId, prospectoPlaceId, esProspecto, idValido, autoGenerar, generar]);

  if (!idValido) return null;

  return (
    <div className="rounded-md border border-primary/30 bg-card/50 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Briefing de visita</p>
        </div>
        {briefing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => generar(true)}
            disabled={loading}
            title="Actualizar briefing"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>

      {loading && !briefing ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Armando el briefing con los números del cliente...
        </p>
      ) : briefing ? (
        <div className="space-y-1">
          {briefing
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((linea, idx) => (
              <p key={idx} className="text-sm text-card-foreground/90">
                {linea}
              </p>
            ))}
        </div>
      ) : (
        checked && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Qué ofrecer y cómo encarar la visita, con los datos del cliente.</p>
            <Button size="sm" variant="outline" onClick={() => generar(false)} disabled={loading}>
              Generar
            </Button>
          </div>
        )
      )}
    </div>
  );
};

export default BriefingVisita;
