import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import angelBlanco from "@/assets/angel-blanco.png";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "";

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
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
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Error", description: getErrorMessage(error) || "No se pudo actualizar la contraseña" });
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
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Error", description: getErrorMessage(error) || "No se pudo enviar el email" });
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
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Error", description: getErrorMessage(error) || "Error al iniciar sesión" });
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
        options: { data: { nombre, rol: "vendedor" }, emailRedirectTo: `${window.location.origin}/` }
      });
      if (error) throw error;
      if (data.session) await supabase.auth.signOut();
      toast({
        title: "Solicitud recibida",
        description: "Revisá tu email si requiere confirmación. Un asignador debe habilitar la cuenta antes del primer ingreso.",
      });
      setEmail("");setPassword("");setNombre("");
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      let msg = "Error al crear cuenta";
      if (errorMessage.includes("already registered")) msg = "Este correo ya está registrado.";else
      if (errorMessage.includes("Invalid email")) msg = "Email inválido.";else
      if (errorMessage.includes("Password")) msg = "Contraseña: mínimo 6 caracteres.";else
      if (errorMessage) msg = errorMessage;
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsLoading(false);
    }
  };

  if (isRecoveryMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background relative">
        <img src={angelBlanco} alt="" aria-hidden="true" className="angel-watermark fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-auto select-none" />
        <Card className="w-full max-w-md relative z-10">
          <CardHeader className="text-center space-y-6 pt-10">
            <div className="flex flex-col items-center gap-4">
              <img src={angelBlanco} alt="" className="h-12 w-auto opacity-40" />
              <img src={cupraLogo} alt="Cupra Wines" className="h-10 w-auto opacity-70" />
            </div>
            <div>
              <CardTitle className="text-2xl font-sans">Nueva Contraseña</CardTitle>
              <CardDescription className="text-sm mt-2">Ingresa tu nueva contraseña</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8">
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-xs text-muted-foreground uppercase tracking-wider">Nueva contraseña</Label>
                <Input id="new-password" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} className="bg-secondary/50 border-border/30" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-xs text-muted-foreground uppercase tracking-wider">Confirmar contraseña</Label>
                <Input id="confirm-password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} className="bg-secondary/50 border-border/30" />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? "Guardando..." : "Guardar nueva contraseña"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>);

  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background relative">
      <img src={angelBlanco} alt="" aria-hidden="true" className="angel-watermark fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-auto select-none" />
      
      <Card className="w-full max-w-md relative z-10">
        <CardHeader className="text-center space-y-6 pt-10">
          <div className="flex flex-col items-center gap-4">
            
            <img src={cupraLogo} alt="Cupra Wines" className="h-10 w-auto opacity-70" />
          </div>
          <div>
            <CardTitle className="text-2xl font-sans">Sistema de Planificación</CardTitle>
            <CardDescription className="text-sm mt-2 tracking-wide">Gestión Estratégica de Ventas</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-8">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Iniciar Sesión</TabsTrigger>
              <TabsTrigger value="signup">Registrarse</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              {showResetPassword ?
              <form onSubmit={handleResetPassword} className="space-y-5">
                  <p className="text-sm text-muted-foreground text-center mb-4">Ingresa tu email para restablecer tu contraseña.</p>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email" className="text-xs text-muted-foreground uppercase tracking-wider">Email</Label>
                    <Input id="reset-email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/50 border-border/30" />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                    {isLoading ? "Enviando..." : "Enviar email de recuperación"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setShowResetPassword(false)}>Volver</Button>
                </form> :

              <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs text-muted-foreground uppercase tracking-wider">Email</Label>
                    <Input id="email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/50 border-border/30" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs text-muted-foreground uppercase tracking-wider">Contraseña</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="bg-secondary/50 border-border/30" />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                    {isLoading ? "Cargando..." : "Iniciar Sesión"}
                  </Button>
                  <Button type="button" variant="link" className="w-full text-xs text-muted-foreground" onClick={() => setShowResetPassword(true)}>
                    ¿Olvidaste tu contraseña?
                  </Button>
                </form>
              }
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signup-nombre" className="text-xs text-muted-foreground uppercase tracking-wider">Nombre</Label>
                  <Input id="signup-nombre" type="text" placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required className="bg-secondary/50 border-border/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-xs text-muted-foreground uppercase tracking-wider">Email</Label>
                  <Input id="signup-email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/50 border-border/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-xs text-muted-foreground uppercase tracking-wider">Contraseña</Label>
                  <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="bg-secondary/50 border-border/30" />
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? "Cargando..." : "Crear Cuenta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          <div className="flex justify-center gap-3 mt-6 text-xs text-muted-foreground">
            <Link to="/privacidad" className="hover:text-foreground hover:underline">Privacidad</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terminos" className="hover:text-foreground hover:underline">Términos</Link>
          </div>
        </CardContent>
      </Card>
    </div>);

};

export default Auth;
