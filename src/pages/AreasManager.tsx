import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import cupraLogo from "@/assets/cupra-logo-new.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Loader2, Trash2, Pencil, Save, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// Types
interface Place {
  id: string;
  comuna: string | null;
  barrio_principal: string | null;
  provincia_principal: string | null;
}

interface Area {
  id: string;
  nombre: string;
  descripcion: string | null;
  color: string | null;
  comentarios: string | null;
  places: Place[];
  vendedores: string[];
}

interface Profile {
  id: string;
  nombre: string;
  email: string;
}


// Supabase helpers
async function getCurrentProfileId() {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  
  if (!userId) return null;
  
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  
  return profile?.id || null;
}

async function getData() {
  // Mantiene el catálogo de barrios al día con clientes y prospectos cargados.
  const { error: syncError } = await supabase.rpc("sync_places_catalog");
  if (syncError) console.warn("No se pudo sincronizar el catálogo de barrios:", syncError.message);

  const [areasRes, placesRes, areasPlacesRes, areasVendedoresRes, profilesRes] =
    await Promise.all([
      supabase.from("areas").select("*").order("nombre"),
      supabase.from("places").select("*").order("barrio_principal"),

      supabase.from("areas_places").select("*"),
      supabase.from("areas_vendedores").select("*"),
      supabase.from("profiles").select("id, nombre, email").eq("activo", true),
    ]);

  if (areasRes.error) throw areasRes.error;
  if (placesRes.error) throw placesRes.error;
  if (areasPlacesRes.error) throw areasPlacesRes.error;
  if (areasVendedoresRes.error) throw areasVendedoresRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const areas = areasRes.data || [];
  const places = placesRes.data || [];
  const areasPlaces = areasPlacesRes.data || [];
  const areasVendedores = areasVendedoresRes.data || [];
  const profiles = profilesRes.data || [];

  // Map places to areas
  const areasMap = new Map<string, Area>();
  areas.forEach((area) => {
    areasMap.set(area.id, {
      ...area,
      places: [],
      vendedores: [],
    });
  });

  // Assign places to areas
  areasPlaces.forEach((ap) => {
    const area = areasMap.get(ap.area_id);
    const place = places.find((p) => p.id === ap.place_id);
    if (area && place) {
      area.places.push(place);
    }
  });

  // Assign vendedores to areas
  areasVendedores.forEach((av) => {
    const area = areasMap.get(av.area_id);
    if (area) {
      area.vendedores.push(av.vendedor_id);
    }
  });

  // TODOS los places están disponibles en "Sin Área" para permitir múltiples asignaciones
  const unassignedPlaces = places;

  return {
    areas: Array.from(areasMap.values()),
    unassignedPlaces,
    profiles,
  };
}

async function createArea(data: {
  nombre: string;
  descripcion?: string;
  color?: string;
}) {
  const profileId = await getCurrentProfileId();

  const { data: newArea, error } = await supabase
    .from("areas")
    .insert({
      nombre: data.nombre,
      descripcion: data.descripcion || null,
      color: data.color || null,
      created_by: profileId,
    })
    .select()
    .single();

  if (error) throw error;
  return newArea;
}

async function assignPlaceToArea(placeId: string, areaId: string) {
  const profileId = await getCurrentProfileId();

  const { data: existing } = await supabase
    .from("areas_places")
    .select("id")
    .eq("place_id", placeId)
    .eq("area_id", areaId)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase
    .from("areas_places")
    .insert({
      place_id: placeId,
      area_id: areaId,
      created_by: profileId,
    });

  if (error) throw error;
}

async function unassignPlace(placeId: string, areaId: string) {
  const { error } = await supabase
    .from("areas_places")
    .delete()
    .eq("place_id", placeId)
    .eq("area_id", areaId);

  if (error) throw error;
}

async function updateAreaComments(areaId: string, comentarios: string) {
  const { error } = await supabase
    .from("areas")
    .update({ comentarios })
    .eq("id", areaId);

  if (error) throw error;
}

async function setAreaVendedores(areaId: string, vendedorIds: string[]) {
  const profileId = await getCurrentProfileId();

  // Delete existing
  await supabase.from("areas_vendedores").delete().eq("area_id", areaId);

  // Insert new
  if (vendedorIds.length > 0) {
    const { error } = await supabase.from("areas_vendedores").insert(
      vendedorIds.map((vendedorId) => ({
        area_id: areaId,
        vendedor_id: vendedorId,
        created_by: profileId,
      }))
    );

    if (error) throw error;
  }
}


export default function AreasManager() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [areas, setAreas] = useState<Area[]>([]);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [placeSearchFilter, setPlaceSearchFilter] = useState("");
  const [areaToDelete, setAreaToDelete] = useState<string | null>(null);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [editForm, setEditForm] = useState({ nombre: "", descripcion: "" });
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newAreaForm, setNewAreaForm] = useState({
    nombre: "",
    descripcion: "",
    color: "#3b82f6",
    selectedPlaces: [] as string[],
  });

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess() {
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;
      
      if (!userId) {
        navigate("/auth");
        return;
      }
      
      const { data: profile } = await supabase
        .from("profiles")
        .select("rol")
        .eq("user_id", userId)
        .maybeSingle();
      
      if (!profile || profile.rol !== "asignador") {
        toast({
          title: "Acceso restringido",
          description: "No tienes permisos para acceder a esta página",
          variant: "destructive",
        });
        navigate("/");
      }
    } catch (error) {
      console.error("Error checking access:", error);
      navigate("/");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const data = await getData();
      setAreas(data.areas);
      setAllPlaces(data.unassignedPlaces);
      setProfiles(data.profiles);
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateArea(e: React.FormEvent) {
    e.preventDefault();
    if (!newAreaForm.nombre.trim()) {
      toast({
        title: "Error",
        description: "El nombre del área es requerido",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create the area
      const newArea = await createArea(newAreaForm);
      
      // Assign selected places to the area
      if (newAreaForm.selectedPlaces.length > 0) {
        await Promise.all(
          newAreaForm.selectedPlaces.map((placeId) =>
            assignPlaceToArea(placeId, newArea.id)
          )
        );
      }
      
      toast({
        title: "Éxito",
        description: `Área creada con ${newAreaForm.selectedPlaces.length} barrio(s)`,
      });
      setIsCreateDialogOpen(false);
      setNewAreaForm({ nombre: "", descripcion: "", color: "#3b82f6", selectedPlaces: [] });
      loadData();
    } catch (error) {
      console.error("Error creating area:", error);
      toast({
        title: "Error",
        description: "No se pudo crear el área",
        variant: "destructive",
      });
    }
  }

  async function handleVendedoresChange(areaId: string, vendedorIds: string[]) {
    setAreas((prev) =>
      prev.map((area) =>
        area.id === areaId ? { ...area, vendedores: vendedorIds } : area
      )
    );

    try {
      await setAreaVendedores(areaId, vendedorIds);
      toast({
        title: "Vendedores actualizados",
      });
    } catch (error) {
      console.error("Error updating vendedores:", error);
      toast({
        title: "Error",
        description: "No se pudieron actualizar los vendedores",
        variant: "destructive",
      });
      loadData();
    }
  }

  async function handleDeleteArea(areaId: string) {
    try {
      await supabase.from("areas_vendedores").delete().eq("area_id", areaId);
      await supabase.from("areas_places").delete().eq("area_id", areaId);
      
      const { error } = await supabase.from("areas").delete().eq("id", areaId);
      
      if (error) throw error;

      setAreas((prev) => prev.filter((area) => area.id !== areaId));

      toast({
        title: "Área eliminada correctamente",
      });
      
      setAreaToDelete(null);
    } catch (error) {
      console.error("Error deleting area:", error);
      toast({
        title: "Error",
        description: "No se pudo eliminar el área",
        variant: "destructive",
      });
    }
  }

  async function handleUpdateArea() {
    if (!editingArea) return;

    const trimmedNombre = editForm.nombre.trim();
    if (!trimmedNombre) {
      toast({
        title: "Error",
        description: "El nombre del área no puede estar vacío",
        variant: "destructive",
      });
      return;
    }

    if (trimmedNombre.length > 50) {
      toast({
        title: "Error",
        description: "El nombre no puede tener más de 50 caracteres",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("areas")
        .update({
          nombre: trimmedNombre,
          descripcion: editForm.descripcion.trim() || null,
        })
        .eq("id", editingArea.id);

      if (error) throw error;

      setAreas((prev) =>
        prev.map((area) =>
          area.id === editingArea.id
            ? { ...area, nombre: trimmedNombre, descripcion: editForm.descripcion.trim() || null }
            : area
        )
      );

      toast({
        title: "Área actualizada correctamente",
      });

      setEditingArea(null);
      setEditForm({ nombre: "", descripcion: "" });
    } catch (error) {
      console.error("Error updating area:", error);
      toast({
        title: "Error",
        description: "No se pudo actualizar el área",
        variant: "destructive",
      });
    }
  }

  async function handleCommentsChange(areaId: string, comentarios: string) {
    try {
      await updateAreaComments(areaId, comentarios);
      
      setAreas((prev) =>
        prev.map((area) =>
          area.id === areaId ? { ...area, comentarios } : area
        )
      );

      toast({
        title: "Comentarios guardados",
      });
    } catch (error) {
      console.error("Error updating comments:", error);
      toast({
        title: "Error",
        description: "No se pudieron guardar los comentarios",
        variant: "destructive",
      });
    }
  }

  async function handleAddPlaceToArea(placeId: string, areaId: string) {
    try {
      await assignPlaceToArea(placeId, areaId);
      
      const place = allPlaces.find((p) => p.id === placeId);
      if (place) {
        setAreas((prev) =>
          prev.map((area) => {
            if (area.id === areaId) {
              const exists = area.places.some((p) => p.id === placeId);
              if (!exists) {
                return { ...area, places: [...area.places, place] };
              }
            }
            return area;
          })
        );
      }

      toast({
        title: "Barrio agregado al área",
      });
    } catch (error) {
      console.error("Error adding place:", error);
      toast({
        title: "Error",
        description: "No se pudo agregar el barrio",
        variant: "destructive",
      });
    }
  }

  async function handleRemovePlaceFromArea(placeId: string, areaId: string) {
    try {
      await unassignPlace(placeId, areaId);
      
      setAreas((prev) =>
        prev.map((area) =>
          area.id === areaId
            ? { ...area, places: area.places.filter((p) => p.id !== placeId) }
            : area
        )
      );

      toast({
        title: "Barrio removido del área",
      });
    } catch (error) {
      console.error("Error removing place:", error);
      toast({
        title: "Error",
        description: "No se pudo remover el barrio",
        variant: "destructive",
      });
    }
  }

  const vendedorOptions = profiles.map((p) => ({
    label: p.nombre,
    value: p.id,
  }));

  const placeOptions = allPlaces.map((p) => ({
    label: `${p.barrio_principal || "Sin nombre"} - ${p.comuna || ""} (${p.provincia_principal || ""})`.trim(),
    value: p.id,
  }));

  const filteredAreas = areas.filter((area) =>
    area.nombre.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const filteredPlaces = allPlaces.filter((place) => {
    const query = placeSearchFilter.toLowerCase();
    return (
      place.barrio_principal?.toLowerCase().includes(query) ||
      place.comuna?.toLowerCase().includes(query) ||
      place.provincia_principal?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="p-4 md:p-6">

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={cupraLogo} alt="Cupra Wines" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">Gestión de Áreas</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Organiza barrios por área
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate("/")}
            >
              Volver al Inicio
            </Button>
          </div>

          {/* Search */}
          <Input
            placeholder="Buscar áreas..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Areas List */}
        <Card>
          <CardHeader>
            <CardTitle>Áreas Definidas ({filteredAreas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredAreas.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No hay áreas definidas aún
              </p>
            ) : (
              <Accordion type="multiple" className="w-full">
                {filteredAreas.map((area) => (
                  <AccordionItem key={area.id} value={area.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: area.color || "#3b82f6" }}
                        />
                        <div className="flex-1 text-left">
                          <p className="font-semibold">{area.nombre}</p>
                          {area.descripcion && (
                            <p className="text-sm text-muted-foreground">
                              {area.descripcion}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary">
                          {area.places.length} barrios
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-6 pt-4">
                        {/* Actions */}
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingArea(area);
                              setEditForm({
                                nombre: area.nombre,
                                descripcion: area.descripcion || "",
                              });
                            }}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAreaToDelete(area.id)}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </Button>
                        </div>

                        {/* Vendedores */}
                        <div>
                          <Label className="text-sm font-medium mb-2 block">
                            Vendedores Asignados
                          </Label>
                          <MultiSelect
                            options={vendedorOptions}
                            selected={area.vendedores}
                            onChange={(selected) =>
                              handleVendedoresChange(area.id, selected)
                            }
                            placeholder="Seleccionar vendedores"
                          />
                        </div>

                        {/* Places/Barrios */}
                        <div>
                          <Label className="text-sm font-medium mb-2 block">
                            Barrios Asignados ({area.places.length})
                          </Label>
                          <div className="border rounded-lg p-4 bg-muted/20 space-y-2 max-h-[300px] overflow-y-auto">
                            {area.places.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">
                                No hay barrios asignados
                              </p>
                            ) : (
                              area.places.map((place) => (
                                <div
                                  key={place.id}
                                  className="flex items-start justify-between gap-2 p-3 bg-card rounded-lg border"
                                >
                                  <div className="flex items-start gap-2 flex-1 min-w-0">
                                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      {place.barrio_principal && (
                                        <p className="font-medium text-sm truncate">
                                          {place.barrio_principal}
                                        </p>
                                      )}
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {place.comuna && (
                                          <Badge variant="secondary" className="text-xs">
                                            {place.comuna}
                                          </Badge>
                                        )}
                                        {place.provincia_principal && (
                                          <Badge variant="outline" className="text-xs">
                                            {place.provincia_principal}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleRemovePlaceFromArea(place.id, area.id)
                                    }
                                    className="flex-shrink-0"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>

                          {/* Agregar Nuevos Barrios */}
                          <div className="mt-4 pt-4 border-t">
                            <Label className="text-sm font-medium mb-2 block">
                              Agregar Barrios
                            </Label>
                            <MultiSelect
                              options={allPlaces
                                .filter((p) => !area.places.some((ap) => ap.id === p.id))
                                .map((p) => ({
                                  label: `${p.barrio_principal || "Sin nombre"}${p.comuna ? ` - ${p.comuna}` : ""}${p.provincia_principal ? ` (${p.provincia_principal})` : ""}`,
                                  value: p.id,
                                }))}
                              selected={[]}
                              onChange={(selected) => {
                                selected.forEach((placeId) => {
                                  handleAddPlaceToArea(placeId, area.id);
                                });
                              }}
                              placeholder="Buscar y agregar barrios..."
                            />
                          </div>
                        </div>

                        {/* Comentarios */}
                        <div>
                          <Label className="text-sm font-medium mb-2 block">
                            Comentarios del Asignador
                          </Label>
                          <Textarea
                            placeholder="Agregar notas o comentarios sobre esta área..."
                            value={area.comentarios || ""}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setAreas((prev) =>
                                prev.map((a) =>
                                  a.id === area.id
                                    ? { ...a, comentarios: newValue }
                                    : a
                                )
                              );
                            }}
                            onBlur={(e) =>
                              handleCommentsChange(area.id, e.target.value)
                            }
                            rows={4}
                            className="resize-none"
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>

        {/* Create New Area Section */}
        <Card>
          <CardHeader>
            <CardTitle>Crear Nueva Área</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateArea} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="nombre">Nombre del Área *</Label>
                  <Input
                    id="nombre"
                    value={newAreaForm.nombre}
                    onChange={(e) =>
                      setNewAreaForm({ ...newAreaForm, nombre: e.target.value })
                    }
                    placeholder="Ej: Zona Norte"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="color">Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="color"
                      type="color"
                      value={newAreaForm.color}
                      onChange={(e) =>
                        setNewAreaForm({ ...newAreaForm, color: e.target.value })
                      }
                      className="w-20 h-10"
                    />
                    <Input
                      value={newAreaForm.color}
                      onChange={(e) =>
                        setNewAreaForm({ ...newAreaForm, color: e.target.value })
                      }
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label htmlFor="descripcion">Descripción</Label>
                <Textarea
                  id="descripcion"
                  value={newAreaForm.descripcion}
                  onChange={(e) =>
                    setNewAreaForm({
                      ...newAreaForm,
                      descripcion: e.target.value,
                    })
                  }
                  placeholder="Descripción del área"
                  rows={3}
                />
              </div>
              
              {/* Barrios Selection */}
              <div>
                <Label htmlFor="barrios">Barrios</Label>
                <MultiSelect
                  options={placeOptions}
                  selected={newAreaForm.selectedPlaces}
                  onChange={(selected) =>
                    setNewAreaForm({ ...newAreaForm, selectedPlaces: selected })
                  }
                  placeholder="Seleccionar barrios"
                  className="w-full"
                />
              </div>

              <Button type="submit" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Crear Área
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Quick Add Places to Existing Areas */}
        <Card>
          <CardHeader>
            <CardTitle>Agregar Barrios a Áreas Existentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar barrios, comunas o provincias..."
                  value={placeSearchFilter}
                  onChange={(e) => setPlaceSearchFilter(e.target.value)}
                  className="pl-9 pr-9"
                />
                {placeSearchFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPlaceSearchFilter("")}
                    className="absolute right-1 top-1 h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {placeSearchFilter && (
                <ScrollArea className="h-[200px] border rounded-lg p-2">
                  <div className="space-y-2">
                    {filteredPlaces.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No se encontraron barrios
                      </p>
                    ) : (
                      filteredPlaces.map((place) => (
                        <div
                          key={place.id}
                          className="flex items-center justify-between p-2 hover:bg-muted rounded"
                        >
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              {place.barrio_principal && (
                                <p className="font-medium text-sm truncate">
                                  {place.barrio_principal}
                                </p>
                              )}
                              <div className="flex flex-wrap gap-1 mt-1">
                                {place.comuna && (
                                  <Badge variant="secondary" className="text-xs">
                                    {place.comuna}
                                  </Badge>
                                )}
                                {place.provincia_principal && (
                                  <Badge variant="outline" className="text-xs">
                                    {place.provincia_principal}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>
                                  Agregar a Área
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-2">
                                {areas.map((area) => (
                                  <Button
                                    key={area.id}
                                    variant="outline"
                                    className="w-full justify-start"
                                    onClick={() =>
                                      handleAddPlaceToArea(place.id, area.id)
                                    }
                                  >
                                    <div
                                      className="w-3 h-3 rounded-full mr-2"
                                      style={{
                                        backgroundColor: area.color || "#3b82f6",
                                      }}
                                    />
                                    {area.nombre}
                                  </Button>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Edit Area Dialog */}
        <Dialog open={!!editingArea} onOpenChange={(open) => !open && setEditingArea(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Área</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-nombre">Nombre *</Label>
                <Input
                  id="edit-nombre"
                  value={editForm.nombre}
                  onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })}
                  placeholder="Nombre del área"
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {editForm.nombre.length}/50 caracteres
                </p>
              </div>
              <div>
                <Label htmlFor="edit-descripcion">Descripción</Label>
                <Textarea
                  id="edit-descripcion"
                  value={editForm.descripcion}
                  onChange={(e) => setEditForm({ ...editForm, descripcion: e.target.value })}
                  placeholder="Descripción del área"
                  rows={3}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingArea(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleUpdateArea}>
                  Guardar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!areaToDelete} onOpenChange={() => setAreaToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar área?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará el área y todas sus asignaciones de lugares y vendedores.
                Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => areaToDelete && handleDeleteArea(areaToDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </div>
    </div>
  );

}
