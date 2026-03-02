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
          <div className="flex justify-between items-center py-5">
            <div className="flex items-center gap-4">
              <img src={cupraLogo} alt="Cupra Wines" className="h-8 w-auto opacity-90" />
            </div>

            <div className="flex items-center gap-3">
              {profile.rol === 'asignador' && (
                <>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('/clientes')}>
                    <Store className="w-4 h-4 mr-2" />
                    Clientes
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('/prospectos')}>
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Prospectos
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('/supervision')}>
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Supervisión
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('/areas')}>
                    <Layers className="w-4 h-4 mr-2" />
                    Áreas
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('/profiles')}>
                    <UserCog className="w-4 h-4 mr-2" />
                    Perfiles
                  </Button>
                </>
              )}
              {profile.rol === 'vendedor' && (
                <NotificacionesPanel vendedorId={profile.user_id} onNotificacionClick={handleNotificacionClick} />
              )}
              <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border/30">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{profile.nombre}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4" />
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