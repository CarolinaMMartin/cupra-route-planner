import { useEffect, useState, useRef } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
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
import AppNav from "@/components/AppNav";
import { useViewMode } from "@/hooks/useViewMode";

import VendedorKanban, { VendedorKanbanRef } from "@/components/vendedor/VendedorKanbanWrapper";
import NotificacionesPanel from "@/components/vendedor/NotificacionesPanel";
import { useToast } from "@/hooks/use-toast";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const STARTUP_TIMEOUT_MS = 12_000;

const withTimeout = <T,>(promise: PromiseLike<T>, message: string): Promise<T> =>
  Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), STARTUP_TIMEOUT_MS);
    }),
  ]);

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const kanbanRef = useRef<VendedorKanbanRef>(null);
  const { mode: viewMode } = useViewMode(profile?.rol, profile?.perfil_ventas);

  const handleNotificacionClick = (asignacionId: string) => {
    kanbanRef.current?.focusAssignment(asignacionId);
  };

  useEffect(() => {
    // Si el enlace de recupero de contraseña cae en la raíz, lo mandamos a la
    // pantalla de nueva contraseña en vez de validar el perfil.
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery")) {
      navigate(`/auth${hash}`, { replace: true });
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/auth", { replace: true });
        return;
      }

      setSession(session);
      if (!session) {
        setProfile(null);
        setIsLoading(false);
        navigate("/auth");
      }
    });
    withTimeout(
      supabase.auth.getSession(),
      "La validación de la sesión demoró demasiado."
    ).then(({ data: { session } }) => {
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
    if (!userId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    setIsLoading(true);
    try {
      // maybeSingle: si el perfil todavia no existe no lanza excepcion.
      const { data, error } = await withTimeout(
        supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
        "La carga del perfil demoró demasiado."
      );
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
      setLoadError("No pudimos iniciar la aplicación. Reintentá; si el problema continúa, cerrá sesión y volvé a ingresar.");
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
      

      {/* Header global */}
      <AppNav
        profile={{ nombre: profile.nombre, rol: profile.rol, perfil_ventas: profile.perfil_ventas }}
        rightSlot={viewMode === 'ventas'
          ? <NotificacionesPanel onNotificacionClick={handleNotificacionClick} />
          : null}
      />


      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8">
        {isAssignorLike(profile.rol) && viewMode === "gestion" ? <AssignorDashboard /> : <VendedorKanban ref={kanbanRef} />}
      </main>
    </div>);

};

export default Index;
