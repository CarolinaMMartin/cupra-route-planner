import { useEffect, useState, type ReactNode } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3,
  ChevronDown,
  ClipboardList,
  Home,
  Layers,
  LogOut,
  Store,
  Upload,
  User,
  UserCog,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toTitleCase } from "@/lib/format";

interface AppNavProps {
  /** Perfil ya cargado por la página (evita una consulta extra). */
  profile?: { nombre: string; rol: string } | null;
  /** Contenido extra a la derecha (por ejemplo, notificaciones). */
  rightSlot?: ReactNode;
}

/**
 * Barra de navegación global. Se muestra en todas las pantallas para poder
 * volver al inicio o saltar entre Dashboards y Gestión sin perder contexto.
 */
export default function AppNav({ profile: profileProp, rightSlot }: AppNavProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [profile, setProfile] = useState<{ nombre: string; rol: string } | null>(profileProp ?? null);

  useEffect(() => {
    if (profileProp) {
      setProfile(profileProp);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from("profiles")
        .select("nombre, rol")
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled && data) setProfile({ nombre: data.nombre, rol: data.rol });
    })();
    return () => { cancelled = true; };
  }, [profileProp]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Sesión cerrada", description: "Hasta pronto" });
    navigate("/auth");
  };

  const goHome = () => {
    window.dispatchEvent(new CustomEvent("cupra:volver-inicio"));
    navigate("/");
  };

  return (
    <header className="bg-background/90 backdrop-blur-xl sticky top-0 z-50 border-b border-border/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
        <div className="flex justify-between items-center h-14">
          <div className="w-10" />

          <nav className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="gap-1.5 text-sm" onClick={goHome}>
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">Volver al inicio</span>
            </Button>

            {isAssignorLike(profile?.rol) && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                      <BarChart3 className="w-4 h-4" />
                      <span className="hidden sm:inline">Dashboards</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-48">
                    {canViewSalesDashboard(profile?.rol) && (
                      <DropdownMenuItem onClick={() => navigate("/clientes-dashboard")} className="gap-2 cursor-pointer">
                        <BarChart3 className="w-4 h-4" />
                        Clientes
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => navigate("/prospectos-dashboard")} className="gap-2 cursor-pointer">
                      <Store className="w-4 h-4" />
                      Prospectos
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                      <Layers className="w-4 h-4" />
                      <span className="hidden sm:inline">Gestión</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-48">
                    <DropdownMenuItem onClick={() => navigate("/areas")} className="gap-2 cursor-pointer">
                      <Layers className="w-4 h-4" />
                      Áreas
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/supervision-vendedores")} className="gap-2 cursor-pointer">
                      <ClipboardList className="w-4 h-4" />
                      Supervisión
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/carga-datos")} className="gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Carga de Datos
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/profiles")} className="gap-2 cursor-pointer">
                      <UserCog className="w-4 h-4" />
                      Perfiles
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {profile?.rol === "vendedor" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate("/vendedor-dashboard")} className="gap-1.5 text-sm">
                  <BarChart3 className="w-4 h-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5 text-sm">
                  <Layers className="w-4 h-4" />
                  <span className="hidden sm:inline">Asignaciones</span>
                </Button>
              </>
            )}
          </nav>

          <div className="flex items-center gap-1">
            {rightSlot}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="hidden sm:inline text-sm">{profile?.nombre || "Cuenta"}</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {profile && (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium">{toTitleCase(profile.nombre)}</p>
                      <p className="text-xs text-muted-foreground capitalize">{profile.rol}</p>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="w-4 h-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
