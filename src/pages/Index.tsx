import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, User, UserCog, BarChart3, Layers, ClipboardList, Store } from "lucide-react";
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
  const {
    toast
  } = useToast();
  const kanbanRef = useRef<VendedorKanbanRef>(null);
  const handleNotificacionClick = (asignacionId: string) => {
    kanbanRef.current?.focusAssignment(asignacionId);
  };
  useEffect(() => {
    // Set up auth state listener
    const {
      data: {
        subscription
      }
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (!session) {
        navigate("/auth");
      }
    });

    // Check for existing session
    supabase.auth.getSession().then(({
      data: {
        session
      }
    }) => {
      setSession(session);
      if (!session) {
        navigate("/auth");
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);
  useEffect(() => {
    if (session?.user) {
      fetchProfile();
    }
  }, [session]);
  const fetchProfile = async () => {
    try {
      const {
        data,
        error
      } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single();
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
    toast({
      title: "Sesión cerrada",
      description: "Hasta pronto"
    });
    navigate("/auth");
  };
  if (isLoading || !session || !profile) {
    return <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-6">
          <img src={cupraLogo} alt="Cupra Wines" className="w-32 h-auto mx-auto opacity-50 animate-pulse" />
          <p className="text-muted-foreground tracking-wide">Cargando...</p>
        </div>
      </div>;
  }
  return <div className="min-h-screen overflow-x-hidden">
      <header className="matte-card border-b border-border/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-12">
          <div className="flex flex-wrap justify-between items-center gap-2 py-3 md:py-5">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold tracking-wide">
            </h1>
            </div>

            <div className="flex items-center gap-2 md:gap-5 flex-wrap">
              {profile.rol === 'asignador' && <>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/clientes-dashboard")} className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Dashboard Clientes</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/prospectos-dashboard")} className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <Store className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Dashboard Prospectos</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/areas")} className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <Layers className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Asignaciones de Áreas</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/supervision-vendedores")} className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <ClipboardList className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Supervisión Vendedores</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/profiles")} className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <UserCog className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Perfiles</span>
                  </Button>
                </>}
              {profile.rol === 'vendedor' && <>
                  {/* Desktop: botones con texto */}
                  <Button variant="ghost" size="sm" onClick={() => navigate("/vendedor-dashboard")} className="hidden md:flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Mi Dashboard</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="hidden md:flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors">
                    <Layers className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Mis Asignaciones</span>
                  </Button>
                  {/* Mobile: solo iconos */}
                  <Button variant="ghost" size="icon" onClick={() => navigate("/vendedor-dashboard")} className="md:hidden text-muted-foreground hover:text-accent transition-colors h-8 w-8">
                    <BarChart3 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="md:hidden text-muted-foreground hover:text-accent transition-colors h-8 w-8">
                    <Layers className="w-4 h-4" />
                  </Button>
                </>}
              {/* Info usuario - oculta en mobile para vendedor */}
              <div className={`text-right ${profile.rol === 'vendedor' ? 'hidden md:block' : ''}`}>
                <p className="font-medium flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-accent" />
                  <span className="tracking-wide">{profile.nombre}</span>
                </p>
                <p className="text-xs text-muted-foreground capitalize tracking-wider">{profile.rol}</p>
              </div>
              {profile.rol === 'vendedor' && <NotificacionesPanel onNotificacionClick={handleNotificacionClick} />}
              <div className="h-8 w-px bg-border/50 hidden md:block" />
              {/* Botón salir - solo icono en mobile */}
              <Button variant="ghost" size="sm" onClick={handleLogout} className="flex items-center gap-2 text-muted-foreground hover:text-destructive transition-colors">
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline text-sm tracking-wide">Salir</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-12 py-6 md:py-12">
        {profile.rol === 'asignador' ? <AssignorDashboard /> : <VendedorKanban ref={kanbanRef} />}
      </main>
    </div>;
};
export default Index;