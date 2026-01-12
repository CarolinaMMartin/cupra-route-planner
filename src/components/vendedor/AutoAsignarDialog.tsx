import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Search, UserPlus, Building, MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AutoAsignarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface SearchResult {
  id: string;
  nombre: string;
  direccion: string;
  barrio?: string | null;
  entityType: "cliente" | "prospecto";
  client_id?: string;
  place_id?: string;
}

const sanitizeSearchQuery = (query: string): string => {
  return query
    .trim()
    .replace(/[%_]/g, "") // Eliminar caracteres especiales de LIKE
    .replace(/,/g, " ") // Reemplazar comas por espacio
    .slice(0, 100); // Limitar longitud
};

const AutoAsignarDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: AutoAsignarDialogProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [tipo, setTipo] = useState<"clientes" | "prospectos" | "ambos">("ambos");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAssigning, setIsAssigning] = useState<string | null>(null);
  const { toast } = useToast();

  // Debounce search
  useEffect(() => {
    const sanitized = sanitizeSearchQuery(searchQuery);
    if (sanitized.length < 2) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      searchItems(sanitized, tipo);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, tipo]);

  const searchItems = async (
    query: string,
    tipoFiltro: "clientes" | "prospectos" | "ambos"
  ) => {
    setIsSearching(true);
    const searchResults: SearchResult[] = [];

    try {
      if (tipoFiltro === "clientes" || tipoFiltro === "ambos") {
        const { data: clientes, error } = await supabase
          .from("clientes")
          .select("client_id, razon_social, direccion_principal, barrio_principal")
          .or(`razon_social.ilike.%${query}%,direccion_principal.ilike.%${query}%`)
          .limit(15);

        if (error) throw error;

        clientes?.forEach((c) =>
          searchResults.push({
            id: c.client_id,
            nombre: c.razon_social || "Sin nombre",
            direccion: c.direccion_principal || "",
            barrio: c.barrio_principal,
            entityType: "cliente",
            client_id: c.client_id,
          })
        );
      }

      if (tipoFiltro === "prospectos" || tipoFiltro === "ambos") {
        const { data: prospectos, error } = await supabase
          .from("prospectos")
          .select("place_id, nombre, direccion, barrio")
          .or(`nombre.ilike.%${query}%,direccion.ilike.%${query}%`)
          .limit(15);

        if (error) throw error;

        prospectos?.forEach((p) =>
          searchResults.push({
            id: p.place_id,
            nombre: p.nombre,
            direccion: p.direccion,
            barrio: p.barrio,
            entityType: "prospecto",
            place_id: p.place_id,
          })
        );
      }

      setResults(searchResults);
    } catch (error) {
      console.error("Error searching:", error);
      toast({
        variant: "destructive",
        title: "Error de búsqueda",
        description: "No se pudieron cargar los resultados",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleAsignar = async (item: SearchResult) => {
    // Validar IDs antes de insertar
    if (item.entityType === "cliente" && !item.client_id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Cliente sin ID válido",
      });
      return;
    }
    if (item.entityType === "prospecto" && !item.place_id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Prospecto sin place_id válido",
      });
      return;
    }

    setIsAssigning(item.id);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Usuario no autenticado",
        });
        return;
      }

      const insertData = {
        vendedor_id: user.id,
        estado: "Por visitar" as const,
        es_prospecto: item.entityType === "prospecto",
        // Usar null explícito, NUNCA string vacío
        client_id: item.entityType === "cliente" ? item.client_id : null,
        prospecto_place_id: item.entityType === "prospecto" ? item.place_id : null,
        origen_asignacion: 'auto' as const, // Marca que fue auto-asignado por el vendedor
      };

      const { error } = await supabase
        .from("asignaciones_vendedores_clientes")
        .insert(insertData);

      if (error) {
        // Error 23505 = violación de unique constraint
        if (error.code === "23505") {
          toast({
            title: "Ya lo tenés asignado",
            description: `"${item.nombre}" ya está en tu lista de visitas`,
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      toast({
        title: "Asignación creada",
        description: `"${item.nombre}" fue agregado a "Por visitar"`,
      });

      // Cerrar modal y refrescar Kanban
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Error creating assignment:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo crear la asignación",
      });
    } finally {
      setIsAssigning(null);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setSearchQuery("");
      setResults([]);
      setTipo("ambos");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Auto-asignar Cliente o Prospecto</DialogTitle>
          <DialogDescription>
            Buscá por nombre o dirección y agregalo a tu lista de visitas
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Campo de búsqueda */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o dirección..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>

          {/* Filtro de tipo */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Tipo:</span>
            <ToggleGroup
              type="single"
              value={tipo}
              onValueChange={(value) => {
                if (value) setTipo(value as "clientes" | "prospectos" | "ambos");
              }}
            >
              <ToggleGroupItem value="ambos" size="sm">
                Ambos
              </ToggleGroupItem>
              <ToggleGroupItem value="clientes" size="sm">
                Clientes
              </ToggleGroupItem>
              <ToggleGroupItem value="prospectos" size="sm">
                Prospectos
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Resultados */}
          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] border rounded-md">
            {isSearching ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Buscando...
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                {searchQuery.length < 2 ? (
                  <>
                    <Search className="h-8 w-8 mb-2" />
                    <p>Escribí al menos 2 caracteres para buscar</p>
                  </>
                ) : (
                  <>
                    <Building className="h-8 w-8 mb-2" />
                    <p>No se encontraron resultados</p>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {results.map((item) => (
                  <div
                    key={`${item.entityType}-${item.id}`}
                    className="flex items-center justify-between p-3 hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{item.nombre}</span>
                        <Badge
                          variant={
                            item.entityType === "cliente" ? "default" : "secondary"
                          }
                          className="text-xs shrink-0"
                        >
                          {item.entityType === "cliente" ? "Cliente" : "Prospecto"}
                        </Badge>
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 mr-1 shrink-0" />
                        <span className="truncate">
                          {item.direccion}
                          {item.barrio && `, ${item.barrio}`}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAsignar(item)}
                      disabled={isAssigning !== null}
                      className="ml-3 shrink-0"
                    >
                      {isAssigning === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-1" />
                          Asignarme
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutoAsignarDialog;
