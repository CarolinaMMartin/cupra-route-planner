import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wine, LogOut, User, ArrowLeft, Pencil, Filter, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const Profiles = () => {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [filteredProfiles, setFilteredProfiles] = useState<any[]>([]);
  const [filterRole, setFilterRole] = useState<"todos" | "vendedor" | "asignador">("todos");
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<any>(null);
  const [formData, setFormData] = useState<{
    nombre: string;
    email: string;
    rol: "asignador" | "vendedor";
    activo: boolean;
  }>({
    nombre: "",
    email: "",
    rol: "vendedor",
    activo: true,
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (!session) {
          navigate("/auth");
        }
      }
    );

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

  useEffect(() => {
    if (profile?.rol === 'asignador') {
      fetchProfiles();
    }
  }, [profile]);

  useEffect(() => {
    if (filterRole === "todos") {
      setFilteredProfiles(profiles);
    } else {
      setFilteredProfiles(profiles.filter(p => p.rol === filterRole));
    }
  }, [profiles, filterRole]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) throw error;
      setProfile(data);
      
      if (data.rol !== 'asignador') {
        toast({
          variant: "destructive",
          title: "Acceso denegado",
          description: "No tienes permisos para acceder a esta página",
        });
        navigate("/");
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('nombre');

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error('Error fetching profiles:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar perfiles",
      });
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

  const handleOpenDialog = (profileData: any) => {
    setEditingProfile(profileData);
    setFormData({
      nombre: profileData.nombre,
      email: profileData.email,
      rol: profileData.rol,
      activo: profileData.activo ?? true,
    });
    setIsDialogOpen(true);
  };

  const toggleActivo = async (profileData: any) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ activo: !profileData.activo })
        .eq('id', profileData.id);

      if (error) throw error;

      toast({
        title: profileData.activo ? "Perfil desactivado" : "Perfil activado",
        description: `${profileData.nombre} ahora está ${!profileData.activo ? 'activo' : 'inactivo'}`,
      });

      fetchProfiles();
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cambiar estado del perfil",
      });
    }
  };

  const handleDeleteClick = (profileItem: any) => {
    if (profileItem.user_id === session?.user?.id) {
      toast({
        variant: "destructive",
        title: "Acción no permitida",
        description: "No puedes eliminar tu propio perfil",
      });
      return;
    }
    setProfileToDelete(profileItem);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!profileToDelete) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profileToDelete.id);

      if (error) throw error;

      toast({
        title: "Perfil eliminado",
        description: "El perfil se eliminó correctamente",
      });

      setDeleteDialogOpen(false);
      setProfileToDelete(null);
      fetchProfiles();
    } catch (error) {
      console.error('Error deleting profile:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al eliminar el perfil",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          nombre: formData.nombre,
          rol: formData.rol,
          activo: formData.activo,
        })
        .eq('id', editingProfile.id);

      if (error) throw error;

      toast({
        title: "Perfil actualizado",
        description: "Los cambios se guardaron correctamente",
      });

      setIsDialogOpen(false);
      fetchProfiles();
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al guardar perfil",
      });
    }
  };

  if (isLoading || !session || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <div className="text-center">
          <img src={cupraLogo} alt="Cupra Wines" className="w-32 h-auto mx-auto opacity-50 animate-pulse" />
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
              <img src={cupraLogo} alt="Cupra Wines" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">Gestión de Perfiles</h1>
                <p className="text-sm text-muted-foreground mt-1">Administración de usuarios</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
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
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={filterRole} onValueChange={(value: any) => setFilterRole(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="vendedor">Vendedores</SelectItem>
                <SelectItem value="asignador">Asignadores</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow-soft border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha de Registro</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProfiles.map((profileItem) => (
                <TableRow key={profileItem.id}>
                  <TableCell className="font-medium">{profileItem.nombre}</TableCell>
                  <TableCell>{profileItem.email}</TableCell>
                  <TableCell>
                    <Badge variant={profileItem.rol === 'asignador' ? "default" : "secondary"}>
                      {profileItem.rol}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {profileItem.rol === 'vendedor' ? (
                      <Badge variant={profileItem.activo ? "default" : "secondary"}>
                        {profileItem.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {new Date(profileItem.created_at).toLocaleDateString('es-ES')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenDialog(profileItem)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {profileItem.rol === 'vendedor' && (
                        <Switch
                          checked={profileItem.activo}
                          onCheckedChange={() => toggleActivo(profileItem)}
                        />
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteClick(profileItem)}
                        disabled={profileItem.user_id === session?.user?.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Perfil</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input
                  id="nombre"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  disabled
                />
                <p className="text-sm text-muted-foreground">
                  El email no se puede modificar
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rol">Rol</Label>
                <Select
                  value={formData.rol}
                  onValueChange={(value) => setFormData({ ...formData, rol: value as "asignador" | "vendedor" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                    <SelectItem value="asignador">Asignador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.rol === 'vendedor' && (
                <div className="flex items-center justify-between">
                  <Label htmlFor="activo">Activo</Label>
                  <Switch
                    id="activo"
                    checked={formData.activo}
                    onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
                  />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="wine-button">
                  Actualizar
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Dialog de confirmación de eliminación */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción no se puede deshacer. Se eliminará permanentemente el perfil de{" "}
                <span className="font-semibold">{profileToDelete?.nombre}</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
};

export default Profiles;
