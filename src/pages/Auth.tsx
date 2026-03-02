import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<'asignador' | 'vendedor'>('vendedor');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') setIsRecoveryMode(true);
      }
    );
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('type') === 'recovery') setIsRecoveryMode(true);
    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Error", description: "Las contraseñas no coinciden" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "Error", description: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: "Contraseña actualizada", description: "Ya puedes iniciar sesión." });
      await supabase.auth.signOut();
      setIsRecoveryMode(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "No se pudo actualizar la contraseña" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth` });
      if (error) throw error;
      toast({ title: "Email enviado", description: "Revisa tu bandeja de entrada." });
      setShowResetPassword(false);
      setEmail("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "No se pudo enviar el email" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast({ title: "Bienvenido", description: "Inicio de sesión exitoso" });
      navigate("/");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Error al iniciar sesión" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { nombre, rol }, emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      if (data?.user && !data.session) {
        toast({ variant: "destructive", title: "Usuario ya registrado", description: "Este correo ya está registrado. Iniciá sesión." });
        return;
      }
      toast({ title: "Cuenta creada", description: "Ya puedes iniciar sesión" });
      setEmail(""); setPassword(""); setNombre("");
    } catch (error: any) {
      let msg = "Error al crear cuenta";
      if (error.message?.includes("already registered")) msg = "Este correo ya está registrado.";
      else if (error.message?.includes("Invalid email")) msg = "Email inválido.";
      else if (error.message?.includes("Password")) msg = "Contraseña: mínimo 6 caracteres.";
      else if (error.message) msg = error.message;
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsLoading(false);
    }
  };

  if (isRecoveryMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4 pt-8">
            <div className="flex justify-center">
              <img src={cupraLogo} alt="Cupra Wines" className="h-16 w-auto opacity-80" />
            </div>
            <div>
              <CardTitle className="text-xl font-semibold">Nueva Contraseña</CardTitle>
              <CardDescription className="text-sm mt-1">Ingresa tu nueva contraseña</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-xs text-muted-foreground">Nueva contraseña</Label>
                <Input id="new-password" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} className="bg-secondary/30 border-border/30" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-xs text-muted-foreground">Confirmar contraseña</Label>
                <Input id="confirm-password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} className="bg-secondary/30 border-border/30" />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? "Guardando..." : "Guardar nueva contraseña"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4 pt-8">
          <div className="flex justify-center">
            <img src={cupraLogo} alt="Cupra Wines" className="h-16 w-auto opacity-80" />
          </div>
          <div>
            <CardTitle className="text-xl font-semibold">Sistema de Planificación</CardTitle>
            <CardDescription className="text-sm mt-1">Gestión de Ventas</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Iniciar Sesión</TabsTrigger>
              <TabsTrigger value="signup">Registrarse</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              {showResetPassword ? (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <p className="text-sm text-muted-foreground text-center mb-4">Ingresa tu email para restablecer tu contraseña.</p>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email" className="text-xs text-muted-foreground">Email</Label>
                    <Input id="reset-email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/30 border-border/30" />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                    {isLoading ? "Enviando..." : "Enviar email de recuperación"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setShowResetPassword(false)}>Volver</Button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
                    <Input id="email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/30 border-border/30" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs text-muted-foreground">Contraseña</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="bg-secondary/30 border-border/30" />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                    {isLoading ? "Cargando..." : "Iniciar Sesión"}
                  </Button>
                  <Button type="button" variant="link" className="w-full text-xs text-muted-foreground" onClick={() => setShowResetPassword(true)}>
                    ¿Olvidaste tu contraseña?
                  </Button>
                </form>
              )}
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-nombre" className="text-xs text-muted-foreground">Nombre</Label>
                  <Input id="signup-nombre" type="text" placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required className="bg-secondary/30 border-border/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="signup-email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/30 border-border/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-xs text-muted-foreground">Contraseña</Label>
                  <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="bg-secondary/30 border-border/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rol" className="text-xs text-muted-foreground">Rol</Label>
                  <select id="rol" value={rol} onChange={(e) => setRol(e.target.value as 'asignador' | 'vendedor')}
                    className="flex h-10 w-full rounded-lg border border-border/30 bg-secondary/30 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="vendedor">Vendedor</option>
                    <option value="asignador">Asignador</option>
                  </select>
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? "Cargando..." : "Crear Cuenta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
