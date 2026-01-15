import { Bell, Check, CheckCheck, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNotificaciones, Notificacion } from "@/hooks/useNotificaciones";
import { cn } from "@/lib/utils";

interface NotificacionesPanelProps {
  onNotificacionClick?: (asignacionId: string) => void;
}

const NotificacionesPanel = ({ onNotificacionClick }: NotificacionesPanelProps) => {
  const { notificaciones, noLeidas, marcarComoLeida, marcarTodasLeidas } = useNotificaciones();

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Ahora";
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  };

  const getIconForTipo = (tipo: string) => {
    switch (tipo) {
      case "asignacion_pendiente":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "recordatorio":
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleNotificacionClick = (notif: Notificacion) => {
    if (!notif.leida) {
      marcarComoLeida(notif.id);
    }
    if (notif.asignacion_id && onNotificacionClick) {
      onNotificacionClick(notif.asignacion_id);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {noLeidas > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {noLeidas > 9 ? "9+" : noLeidas}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <h4 className="font-semibold">Notificaciones</h4>
          {noLeidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={marcarTodasLeidas}
              className="h-8 text-xs gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todas
            </Button>
          )}
        </div>

        <ScrollArea className="h-[300px]">
          {notificaciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Sin notificaciones</p>
            </div>
          ) : (
            <div className="divide-y">
              {notificaciones.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificacionClick(notif)}
                  className={cn(
                    "flex gap-3 p-4 cursor-pointer transition-colors hover:bg-muted/50",
                    !notif.leida && "bg-accent/10"
                  )}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {getIconForTipo(notif.tipo)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn(
                        "text-sm line-clamp-1",
                        !notif.leida && "font-medium"
                      )}>
                        {notif.titulo}
                      </p>
                      {!notif.leida && (
                        <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {notif.mensaje}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(notif.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {notificaciones.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <p className="text-xs text-center text-muted-foreground">
                {noLeidas > 0 
                  ? `${noLeidas} sin leer de ${notificaciones.length} total`
                  : `${notificaciones.length} notificaciones`
                }
              </p>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default NotificacionesPanel;
