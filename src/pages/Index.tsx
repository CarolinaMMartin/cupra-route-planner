import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, User, UserCog, BarChart3, Layers } from "lucide-react";
import cupraLogo from "@/assets/cupra-logo-new.png";
import AssignorDashboard from "@/components/AssignorDashboard";
import VendedorKanban from "@/components/vendedor/VendedorKanban";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (!session) {
          navigate("/auth");
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

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
      description: "Hasta pronto",
    });
    navigate("/auth");
  };

  if (isLoading || !session || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-6">
          <img src={cupraLogo} alt="Cupra Wines" className="w-64 h-auto mx-auto opacity-50 animate-pulse" />
          <p className="text-muted-foreground tracking-wide">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="matte-card border-b border-border/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
          <div className="flex justify-between items-center py-5">
            <div className="flex items-center gap-4">
              <img src={cupraLogo} alt="Cupra Wines" className="h-32 w-auto" />
              <div className="h-8 w-px bg-border/50" />
              <div>
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-light">Sales Planner</p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              {profile.rol === 'asignador' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/clientes-dashboard")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Dashboard de Consultas</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/areas")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Asignaciones de Áreas</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/profiles")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <UserCog className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Perfiles</span>
                  </Button>
                </>
              )}
              {profile.rol === 'vendedor' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/vendedor-dashboard")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Mi Dashboard</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-sm tracking-wide">Mis Asignaciones</span>
                  </Button>
                </>
              )}
              <div className="text-right">
                <p className="font-medium flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-accent" />
                  <span className="tracking-wide">{profile.nombre}</span>
                </p>
                <p className="text-xs text-muted-foreground capitalize tracking-wider">{profile.rol}</p>
              </div>
              <div className="h-8 w-px bg-border/50" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="flex items-center gap-2 text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm tracking-wide">Salir</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
        {profile.rol === 'asignador' ? (
          <AssignorDashboard />
        ) : (
          <VendedorKanban />
        )}
      </main>
    </div>
  );
};

export default Index;