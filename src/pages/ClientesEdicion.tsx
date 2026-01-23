import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Filter, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ClientesEditTable } from "@/components/clientes/ClientesEditTable";
import { EditClienteSheet } from "@/components/clientes/EditClienteSheet";

export interface ClienteEditable {
  client_id: string;
  razon_social: string | null;
  fantasia: string | null;
  cuit_dni: string | null;
  telefonos: string[] | null;
  emails: string[] | null;
  vendedor_principal: string | null;
  requiere_visita: string | null;
  excluir_recomendaciones: boolean | null;
  motivo_exclusion: string | null;
  provincia_principal: string | null;
  ciudad_principal: string | null;
  barrio_principal: string | null;
  direccion_principal: string | null;
}

const ClientesEdicion = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [clientesData, setClientesData] = useState<ClienteEditable[]>([]);
  
  // Filtros
  const [selectedProvincia, setSelectedProvincia] = useState<string>("all");
  const [selectedVendedor, setSelectedVendedor] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  // Estado para edición
  const [editingCliente, setEditingCliente] = useState<ClienteEditable | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    checkAuthAndFetchData();
  }, []);

  const checkAuthAndFetchData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('rol')
        .eq('user_id', session.user.id)
        .single();

      if (profile?.rol !== 'asignador') {
        toast({
          title: "Acceso denegado",
          description: "No tienes permisos para acceder a esta página",
          variant: "destructive",
        });
        navigate('/');
        return;
      }

      await fetchClientes();
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: "Error al cargar los datos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchClientes = async () => {
    const { data, error } = await supabase
      .from('clientes')
      .select(`
        client_id, razon_social, fantasia, cuit_dni,
        telefonos, emails, vendedor_principal,
        requiere_visita, excluir_recomendaciones, motivo_exclusion,
        provincia_principal, ciudad_principal, barrio_principal, direccion_principal
      `)
      .order('razon_social');

    if (error) {
      console.error('Error fetching clientes:', error);
      return;
    }
    
    setClientesData(data || []);
  };

  // Helper: normalizar strings para comparación case-insensitive
  const normalize = (str: string | null | undefined): string => {
    return str ? str.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  };

  // Opciones únicas para filtros
  const provincias = useMemo(() => {
    const provinciasMap = new Map<string, string>();
    clientesData.forEach(cliente => {
      if (cliente.provincia_principal) {
        const key = normalize(cliente.provincia_principal);
        if (!provinciasMap.has(key)) {
          provinciasMap.set(key, cliente.provincia_principal);
        }
      }
    });
    return Array.from(provinciasMap.values()).sort();
  }, [clientesData]);

  const vendedores = useMemo(() => {
    const uniqueVendedores = new Set<string>();
    clientesData.forEach(cliente => {
      if (cliente.vendedor_principal) uniqueVendedores.add(cliente.vendedor_principal);
    });
    return Array.from(uniqueVendedores).sort();
  }, [clientesData]);

  // Datos filtrados
  const filteredData = useMemo(() => {
    return clientesData.filter(cliente => {
      const matchProvincia = selectedProvincia === "all" || 
        normalize(cliente.provincia_principal) === normalize(selectedProvincia);
      const matchVendedor = selectedVendedor === "all" || 
        cliente.vendedor_principal === selectedVendedor;
      const matchSearch = searchTerm === "" || 
        (cliente.razon_social || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (cliente.fantasia || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (cliente.cuit_dni || "").toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchProvincia && matchVendedor && matchSearch;
    });
  }, [clientesData, selectedProvincia, selectedVendedor, searchTerm]);

  const handleEdit = (cliente: ClienteEditable) => {
    setEditingCliente(cliente);
    setSheetOpen(true);
  };

  const handleSave = async (changes: Partial<ClienteEditable>) => {
    if (!editingCliente) return;
    
    setSaving(true);
    try {
      // SOLO permitir estos campos
      const allowedFields = ['telefonos', 'emails', 'vendedor_principal'];
      const sanitizedChanges = Object.fromEntries(
        Object.entries(changes).filter(([key]) => allowedFields.includes(key))
      );
      
      const { error } = await supabase
        .from('clientes')
        .update(sanitizedChanges)
        .eq('client_id', editingCliente.client_id);
        
      if (error) throw error;
      
      toast({ 
        title: "Guardado", 
        description: "Datos actualizados correctamente" 
      });
      
      setSheetOpen(false);
      setEditingCliente(null);
      await fetchClientes();
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: "Error",
        description: "No se pudieron guardar los cambios",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearFilters = () => {
    setSelectedProvincia("all");
    setSelectedVendedor("all");
    setSearchTerm("");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <img src={cupraLogo} alt="Cupra Logo" className="w-32 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate('/clientes-dashboard')}
              className="border-border/60"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground">
                Editar Datos de Clientes
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Edición de datos comerciales y de contacto
              </p>
            </div>
          </div>
          <img src={cupraLogo} alt="Cupra Logo" className="h-10 md:h-12" />
        </div>

        {/* Panel de Filtros */}
        <Card className="matte-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="h-5 w-5" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Buscar Cliente
                </label>
                <Input
                  placeholder="Razón social, fantasía o CUIT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-background/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Provincia
                </label>
                <Select value={selectedProvincia} onValueChange={setSelectedProvincia}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todas</SelectItem>
                    {provincias.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Vendedor Principal
                </label>
                <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {vendedores.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={handleClearFilters}
                  className="w-full"
                >
                  Limpiar filtros
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contador y Tabla */}
        <Card className="matte-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              Clientes ({filteredData.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ClientesEditTable 
              clientes={filteredData}
              onEdit={handleEdit}
            />
          </CardContent>
        </Card>
      </div>

      {/* Sheet de Edición */}
      {editingCliente && (
        <EditClienteSheet
          cliente={editingCliente}
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
            setEditingCliente(null);
          }}
          onSave={handleSave}
          saving={saving}
          vendedores={vendedores}
        />
      )}
    </div>
  );
};

export default ClientesEdicion;
