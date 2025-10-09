import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wine, LogOut, User, UserCog } from "lucide-react";
import AssignorDashboard from "@/components/AssignorDashboard";
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <div className="text-center">
          <Wine className="w-16 h-16 text-primary mx-auto animate-pulse" />
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card shadow-soft border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-primary rounded-full">
                <Wine className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-serif font-bold">Cupra Wines</h1>
                <p className="text-sm text-muted-foreground">Sales Planner</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {profile.rol === 'asignador' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/profiles")}
                  className="flex items-center gap-2"
                >
                  <UserCog className="w-4 h-4" />
                  Perfiles
                </Button>
              )}
              <div className="text-right">
                <p className="font-medium flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {profile.nombre}
                </p>
                <p className="text-sm text-muted-foreground capitalize">{profile.rol}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Salir
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {profile.rol === 'asignador' ? (
          <AssignorDashboard />
        ) : (
          <div className="text-center py-12">
            <h2 className="text-2xl font-serif mb-4">Panel de Vendedor</h2>
            <p className="text-muted-foreground">En desarrollo</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;