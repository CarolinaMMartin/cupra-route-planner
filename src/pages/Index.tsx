import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, BarChart3, Layers, ClipboardList, Store, UserCog, ChevronDown } from "lucide-react";
import cupraLogo from "@/assets/cupra-logo-new.png";
import AssignorDashboard from "@/components/AssignorDashboard";
import VendedorKanban, { VendedorKanbanRef } from "@/components/vendedor/VendedorKanbanWrapper";
import NotificacionesPanel from "@/components/vendedor/NotificacionesPanel";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const kanbanRef = useRef<VendedorKanbanRef>(null);

  const handleNotificacionClick = (asignacionId: string) => {
    kanbanRef.current?.focusAssignment(asignacionId);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (!session) navigate("/auth");
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session?.user) fetchProfile();
  }, [session]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single();
      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Sesión cerrada", description: "Hasta pronto" });
    navigate("/auth");
  };

  if (isLoading || !session || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-6">
          <img src={cupraLogo} alt="Cupra Wines" className="w-32 h-auto mx-auto opacity-50 animate-pulse" />
          <p className="text-muted-foreground tracking-wide">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="matte-card border-b border-border/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-12">
          <div className="flex justify-between items-center h-14">
            {/* Left: Logo / Brand */}
            <div className="flex items-center gap-3">
              <img src={cupraLogo} alt="Cupra Wines" className="h-7 w-auto" />
            </div>

            {/* Center: Navigation */}
            <nav className="flex items-center gap-1">
              {profile.rol === 'asignador' && (
                <>
                  {/* Dashboards dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground text-sm">
                        <BarChart3 className="w-4 h-4" />
                        <span className="hidden sm:inline">Dashboards</span>
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-52">
                      <DropdownMenuItem onClick={() => navigate("/clientes-dashboard")} className="gap-2 cursor-pointer">
                        <BarChart3 className="w-4 h-4" />
                        Clientes
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/prospectos-dashboard")} className="gap-2 cursor-pointer">
                        <Store className="w-4 h-4" />
                        Prospectos
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Gestión dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground text-sm">
                        <Layers className="w-4 h-4" />
                        <span className="hidden sm:inline">Gestión</span>
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-52">
                      <DropdownMenuItem onClick={() => navigate("/areas")} className="gap-2 cursor-pointer">
                        <Layers className="w-4 h-4" />
                        Áreas
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/supervision-vendedores")} className="gap-2 cursor-pointer">
                        <ClipboardList className="w-4 h-4" />
                        Supervisión Vendedores
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

              {profile.rol === 'vendedor' && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/vendedor-dashboard")} className="gap-1.5 text-muted-foreground hover:text-foreground text-sm">
                    <BarChart3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Dashboard</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5 text-muted-foreground hover:text-foreground text-sm">
                    <Layers className="w-4 h-4" />
                    <span className="hidden sm:inline">Asignaciones</span>
                  </Button>
                </>
              )}
            </nav>

            {/* Right: User + Actions */}
            <div className="flex items-center gap-2">
              {profile.rol === 'vendedor' && (
                <NotificacionesPanel onNotificacionClick={handleNotificacionClick} />
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                    <User className="w-4 h-4" />
                    <span className="hidden sm:inline text-sm">{profile.nombre}</span>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{profile.nombre}</p>
                    <p className="text-xs text-muted-foreground capitalize">{profile.rol}</p>
                  </div>
                  <DropdownMenuSeparator />
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

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-12 py-6 md:py-12">
        {profile.rol === 'asignador' ? <AssignorDashboard /> : <VendedorKanban ref={kanbanRef} />}
      </main>
    </div>
  );
};

export default Index;