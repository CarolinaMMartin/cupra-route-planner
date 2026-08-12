import { useEffect, useState, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { LogOut, User, BarChart3, Layers, ClipboardList, Store, UserCog, ChevronDown, Upload, Home } from "lucide-react";
import cupraLogo from "@/assets/cupra-logo-new.png";
import angelBlanco from "@/assets/angel-blanco.png";
import AssignorDashboard from "@/components/AssignorDashboard";
import VendedorKanban, { VendedorKanbanRef } from "@/components/vendedor/VendedorKanbanWrapper";
import NotificacionesPanel from "@/components/vendedor/NotificacionesPanel";
import { useToast } from "@/hooks/use-toast";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const kanbanRef = useRef<VendedorKanbanRef>(null);

  const handleNotificacionClick = (asignacionId: string) => {
    kanbanRef.current?.focusAssignment(asignacionId);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (!session) {
        setIsLoading(false);
        navigate("/auth");
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        setIsLoading(false);
        navigate("/auth");
      }
    }).catch((error) => {
      console.error('Error getting session:', error);
      setIsLoading(false);
      navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session?.user) void fetchProfile();
    // La carga del perfil corresponde al cambio de sesion, no a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fetchProfile = async () => {
    const userId = session?.user.id;
    if (!userId) return;
    setLoadError(null);
    setIsLoading(true);
    try {
      // maybeSingle: si el perfil todavia no existe no lanza excepcion.
      const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (!data) {
        setLoadError("No encontramos tu perfil. Pedile a un asignador que habilite tu cuenta.");
        return;
      }
      if (data.activo !== true) {
        toast({
          title: "Cuenta pendiente de habilitación",
          description: "Pedile a un asignador que habilite tu acceso.",
          variant: "destructive",
        });
        await supabase.auth.signOut();
        navigate('/auth');
        return;
      }
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setLoadError("No pudimos cargar tu perfil. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Sesión cerrada", description: "Hasta pronto" });
    navigate("/auth");
  };

  if (!isLoading && loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center space-y-4 max-w-sm">
          <img src={cupraLogo} alt="Cupra Wines" className="w-24 h-auto mx-auto opacity-60" />
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => void fetchProfile()}>Reintentar</Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>Cerrar sesión</Button>
          </div>
        </div>
      </div>);

  }

  if (isLoading || !session || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <img src={cupraLogo} alt="Cupra Wines" className="w-28 h-auto mx-auto opacity-40 animate-pulse" />
          <p className="text-sm text-muted-foreground tracking-wide">Cargando...</p>
        </div>
      </div>);

  }


  return (
    <div className="min-h-screen bg-background overflow-x-hidden relative">
      {/* Centered angel watermark */}
      <img
        src={angelBlanco}
        alt=""
        className="angel-watermark"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '340px',
          height: 'auto'
        }} />
      

      {/* Header */}
      <header className="bg-background/90 backdrop-blur-xl sticky top-0 z-50 border-b border-border/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
          <div className="flex justify-between items-center h-14">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-0.5">
              {profile.rol === 'asignador' &&
              <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-sm"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("cupra:volver-inicio"));
                      navigate("/");
                    }}>
                    <Home className="w-4 h-4" />
                    <span className="hidden sm:inline">Volver al inicio</span>
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                        <BarChart3 className="w-4 h-4" />
                        <span className="hidden sm:inline">Dashboards</span>
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-48">
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
              }

              {profile.rol === 'vendedor' &&
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
              }
            </nav>

            {/* User */}
            <div className="flex items-center gap-1">
              {profile.rol === 'vendedor' &&
              <NotificacionesPanel onNotificacionClick={handleNotificacionClick} />
              }

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="hidden sm:inline text-sm">{profile.nombre}</span>
                    <ChevronDown className="w-3 h-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-3 py-2">
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

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8">
        {profile.rol === 'asignador' ? <AssignorDashboard /> : <VendedorKanban ref={kanbanRef} />}
      </main>
    </div>);

};

export default Index;
