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
import angelLogo from "@/assets/angel-blanco.png";

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

  // Detectar evento PASSWORD_RECOVERY cuando el usuario llega desde el enlace de email
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoveryMode(true);
        }
      }
    );

    // También verificar hash de la URL al cargar
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('type') === 'recovery') {
      setIsRecoveryMode(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Las contraseñas no coinciden",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast({
        title: "Contraseña actualizada",
        description: "Tu contraseña ha sido cambiada exitosamente. Ya puedes iniciar sesión.",
      });

      // Cerrar sesión temporal y volver al login
      await supabase.auth.signOut();
      setIsRecoveryMode(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "No se pudo actualizar la contraseña",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });

      if (error) throw error;

      toast({
        title: "Email enviado",
        description: "Revisa tu bandeja de entrada para restablecer tu contraseña.",
      });
      
      setShowResetPassword(false);
      setEmail("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "No se pudo enviar el email de recuperación",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: "Bienvenido",
        description: "Inicio de sesión exitoso",
      });

      navigate("/");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Error al iniciar sesión",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            nombre,
            rol,
          },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      // Verificar si el usuario ya existe
      if (data?.user && !data.session) {
        toast({
          variant: "destructive",
          title: "Usuario ya registrado",
          description: "Este correo electrónico ya está registrado en el sistema. Por favor inicia sesión.",
        });
        return;
      }

      toast({
        title: "Cuenta creada exitosamente",
        description: "Ya puedes iniciar sesión con tus credenciales",
      });

      setEmail("");
      setPassword("");
      setNombre("");
    } catch (error: any) {
      let errorMessage = "Error al crear cuenta";
      
      // Mensajes de error específicos
      if (error.message?.includes("already registered") || error.message?.includes("User already registered")) {
        errorMessage = "Este correo electrónico ya está registrado. Por favor inicia sesión.";
      } else if (error.message?.includes("Invalid email")) {
        errorMessage = "El formato del correo electrónico no es válido.";
      } else if (error.message?.includes("Password")) {
        errorMessage = "La contraseña debe tener al menos 6 caracteres.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        variant: "destructive",
        title: "Error al registrarse",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Si está en modo recuperación, mostrar formulario de nueva contraseña
  if (isRecoveryMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
        {/* Marca de agua del ángel */}
        <div 
          className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `url(${angelLogo})`,
            backgroundSize: '50%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        
        <Card className="w-full max-w-md matte-card shadow-large relative z-10">
          <CardHeader className="text-center space-y-6 pt-8">
            <div className="flex justify-center">
              <img src={cupraLogo} alt="Cupra Wines" className="h-20 w-auto" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl font-serif tracking-wide">Nueva Contraseña</CardTitle>
              <CardDescription className="text-sm tracking-wider">
                Ingresa tu nueva contraseña
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nueva contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button
                type="submit"
                className="w-full wine-button"
                disabled={isLoading}
              >
                {isLoading ? "Guardando..." : "Guardar nueva contraseña"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Marca de agua del ángel */}
      <div 
        className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `url(${angelLogo})`,
          backgroundSize: '50%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      
      <Card className="w-full max-w-md matte-card shadow-large relative z-10">
        <CardHeader className="text-center space-y-6 pt-8">
          <div className="flex justify-center">
            <img src={cupraLogo} alt="Cupra Wines" className="h-20 w-auto" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-serif tracking-wide">Sistema de Planificación</CardTitle>
            <CardDescription className="text-sm tracking-wider">Gestión de Ventas</CardDescription>
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
                  <div className="text-center space-y-2 mb-4">
                    <p className="text-sm text-muted-foreground">
                      Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="tu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full wine-button"
                    disabled={isLoading}
                  >
                    {isLoading ? "Enviando..." : "Enviar email de recuperación"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setShowResetPassword(false)}
                  >
                    Volver al login
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full wine-button"
                    disabled={isLoading}
                  >
                    {isLoading ? "Cargando..." : "Iniciar Sesión"}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-sm text-muted-foreground hover:text-primary"
                    onClick={() => setShowResetPassword(true)}
                  >
                    ¿Olvidaste tu contraseña?
                  </Button>
                </form>
              )}
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-nombre">Nombre</Label>
                  <Input
                    id="signup-nombre"
                    type="text"
                    placeholder="Tu nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Contraseña</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rol">Rol</Label>
                  <select
                    id="rol"
                    value={rol}
                    onChange={(e) => setRol(e.target.value as 'asignador' | 'vendedor')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="vendedor">Vendedor</option>
                    <option value="asignador">Asignador</option>
                  </select>
                </div>
                <Button
                  type="submit"
                  className="w-full wine-button"
                  disabled={isLoading}
                >
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