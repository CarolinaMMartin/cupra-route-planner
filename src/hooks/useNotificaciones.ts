import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface Notificacion {
  id: string;
  vendedor_id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  leida: boolean;
  asignacion_id: string | null;
  created_at: string;
}

export const useNotificaciones = () => {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [noLeidas, setNoLeidas] = useState(0);
  const { toast } = useToast();

  const fetchNotificaciones = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Materializar recordatorios vencidos como notificaciones
      try {
        const { data: vencidos } = await supabase
          .from("recordatorios")
          .select("id, titulo, nota, fecha_recordatorio")
          .eq("vendedor_id", user.id)
          .eq("notificado", false)
          .eq("completado", false)
          .lte("fecha_recordatorio", new Date().toISOString());

        if (vencidos && vencidos.length > 0) {
          await supabase.from("notificaciones").insert(
            vencidos.map(r => ({
              vendedor_id: user.id,
              tipo: "recordatorio",
              titulo: r.titulo,
              mensaje: r.nota || "Tenés un seguimiento agendado para hoy.",
            }))
          );
          await supabase
            .from("recordatorios")
            .update({ notificado: true })
            .in("id", vencidos.map(r => r.id));
        }
      } catch (e) {
        console.error("Error procesando recordatorios:", e);
      }

      const { data, error } = await supabase
        .from("notificaciones")
        .select("*")
        .eq("vendedor_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const notifs = (data || []) as Notificacion[];
      setNotificaciones(notifs);
      setNoLeidas(notifs.filter(n => !n.leida).length);
    } catch (error) {
      console.error("Error fetching notificaciones:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotificaciones();

    // Suscripción realtime
    const setupChannel = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = supabase
        .channel("notificaciones-realtime")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notificaciones",
            filter: `vendedor_id=eq.${user.id}`,
          },
          (payload) => {
            console.log("Notificación realtime:", payload);
            
            if (payload.eventType === "INSERT") {
              const newNotif = payload.new as Notificacion;
              setNotificaciones(prev => [newNotif, ...prev]);
              setNoLeidas(prev => prev + 1);
              
              // Mostrar toast para nueva notificación
              toast({
                title: newNotif.titulo,
                description: newNotif.mensaje,
              });
            } else if (payload.eventType === "UPDATE") {
              const updated = payload.new as Notificacion;
              setNotificaciones(prev => 
                prev.map(n => n.id === updated.id ? updated : n)
              );
              // Recalcular no leídas
              setNotificaciones(prev => {
                setNoLeidas(prev.filter(n => !n.leida).length);
                return prev;
              });
            } else if (payload.eventType === "DELETE") {
              const deleted = payload.old as { id: string };
              setNotificaciones(prev => 
                prev.filter(n => n.id !== deleted.id)
              );
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanup = setupChannel();
    return () => {
      cleanup.then(fn => fn?.());
    };
  }, [fetchNotificaciones, toast]);

  const marcarComoLeida = async (id: string) => {
    try {
      const { error } = await supabase
        .from("notificaciones")
        .update({ leida: true })
        .eq("id", id);

      if (error) throw error;

      setNotificaciones(prev => 
        prev.map(n => n.id === id ? { ...n, leida: true } : n)
      );
      setNoLeidas(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Error marcando notificación como leída:", error);
    }
  };

  const marcarTodasLeidas = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("notificaciones")
        .update({ leida: true })
        .eq("vendedor_id", user.id)
        .eq("leida", false);

      if (error) throw error;

      setNotificaciones(prev => prev.map(n => ({ ...n, leida: true })));
      setNoLeidas(0);
      
      toast({
        title: "Notificaciones",
        description: "Todas las notificaciones marcadas como leídas",
      });
    } catch (error) {
      console.error("Error marcando todas como leídas:", error);
    }
  };

  return {
    notificaciones,
    loading,
    noLeidas,
    marcarComoLeida,
    marcarTodasLeidas,
    refetch: fetchNotificaciones,
  };
};
