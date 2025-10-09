import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wine, LogOut, User, ArrowLeft, Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const Vendedores = () => {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendedor, setEditingVendedor] = useState<any>(null);
  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    zona: "",
    activo: false,
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
      fetchVendedores();
    }
  }, [profile]);

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

  const fetchVendedores = async () => {
    try {
      const { data, error } = await supabase
        .from('vendedores')
        .select('*')
        .order('nombre');

      if (error) throw error;
      setVendedores(data || []);
    } catch (error) {
      console.error('Error fetching vendedores:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar vendedores",
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

  const handleOpenDialog = (vendedor?: any) => {
    if (vendedor) {
      setEditingVendedor(vendedor);
      setFormData({
        nombre: vendedor.nombre,
        email: vendedor.email,
        zona: vendedor.zona,
        activo: vendedor.activo,
      });
    } else {
      setEditingVendedor(null);
      setFormData({
        nombre: "",
        email: "",
        zona: "",
        activo: false,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingVendedor) {
        const { error } = await supabase
          .from('vendedores')
          .update(formData)
          .eq('id', editingVendedor.id);

        if (error) throw error;

        toast({
          title: "Vendedor actualizado",
          description: "Los cambios se guardaron correctamente",
        });
      } else {
        const { error } = await supabase
          .from('vendedores')
          .insert([formData]);

        if (error) throw error;

        toast({
          title: "Vendedor creado",
          description: "El vendedor se creó correctamente",
        });
      }

      setIsDialogOpen(false);
      fetchVendedores();
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al guardar vendedor",
      });
    }
  };

  const toggleActivo = async (vendedor: any) => {
    try {
      const { error } = await supabase
        .from('vendedores')
        .update({ activo: !vendedor.activo })
        .eq('id', vendedor.id);

      if (error) throw error;

      toast({
        title: vendedor.activo ? "Vendedor desactivado" : "Vendedor activado",
        description: `${vendedor.nombre} ahora está ${!vendedor.activo ? 'activo' : 'inactivo'}`,
      });

      fetchVendedores();
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cambiar estado del vendedor",
      });
    }
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
                <p className="text-sm text-muted-foreground">Gestión de Vendedores</p>
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

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()} className="wine-button">
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Vendedor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingVendedor ? "Editar Vendedor" : "Nuevo Vendedor"}
                </DialogTitle>
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
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zona">Zona</Label>
                  <Input
                    id="zona"
                    value={formData.zona}
                    onChange={(e) => setFormData({ ...formData, zona: e.target.value })}
                    required
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="activo">Activo</Label>
                  <Switch
                    id="activo"
                    checked={formData.activo}
                    onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" className="wine-button">
                    {editingVendedor ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="bg-card rounded-lg shadow-soft border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendedores.map((vendedor) => (
                <TableRow key={vendedor.id}>
                  <TableCell className="font-medium">{vendedor.nombre}</TableCell>
                  <TableCell>{vendedor.email}</TableCell>
                  <TableCell>{vendedor.zona}</TableCell>
                  <TableCell>
                    <Badge variant={vendedor.activo ? "default" : "secondary"}>
                      {vendedor.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenDialog(vendedor)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Switch
                        checked={vendedor.activo}
                        onCheckedChange={() => toggleActivo(vendedor)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
};

export default Vendedores;