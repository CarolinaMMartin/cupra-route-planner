import { useState, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  useSensor,
  useSensors,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Plus, MapPin, Loader2, Minimize2, Trash2, Maximize2, Pencil } from "lucide-react";
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
  places: Place[];
  vendedores: string[];
}

interface Profile {
  id: string;
  nombre: string;
  email: string;
}

interface DraggedPlace {
  place: Place;
  sourceAreaId: string | null;
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
  const [areasRes, placesRes, areasPlacesRes, areasVendedoresRes, profilesRes] =
    await Promise.all([
      supabase.from("areas").select("*").order("nombre"),
      supabase.from("places").select("*"),
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

// Helper para asignar un place a un área (permite múltiples asignaciones)
async function assignPlaceToArea(placeId: string, areaId: string) {
  const profileId = await getCurrentProfileId();

  // Verificar si ya existe esta relación específica
  const { data: existing } = await supabase
    .from("areas_places")
    .select("id")
    .eq("place_id", placeId)
    .eq("area_id", areaId)
    .maybeSingle();

  // Si ya existe, no hacer nada
  if (existing) return;

  // Insertar nueva relación (permite duplicados con diferentes area_id)
  const { error } = await supabase
    .from("areas_places")
    .insert({
      place_id: placeId,
      area_id: areaId,
      created_by: profileId,
    });

  if (error) throw error;
}

// Helper para desasignar un place de un área específica
async function unassignPlace(placeId: string, areaId: string) {
  const { error } = await supabase
    .from("areas_places")
    .delete()
    .eq("place_id", placeId)
    .eq("area_id", areaId);

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

// Components
function PlaceItem({ place }: { place: Place }) {
  return (
    <div className="p-3 bg-card rounded-lg border hover:border-primary/50 cursor-move transition-colors">
      <div className="flex items-start gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {place.barrio_principal && (
            <p className="font-medium text-sm truncate">{place.barrio_principal}</p>
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
    </div>
  );
}

function DroppableArea({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: id,
  });

  return (
    <div ref={setNodeRef} className="flex-1 min-h-[200px]">
      {children}
    </div>
  );
}

function DraggablePlace({ place, id, areaId }: { place: Place; id: string; areaId?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: id,
    data: {
      placeId: place.id,
      areaId: areaId || null, // Guardamos el área de origen
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <PlaceItem place={place} />
    </div>
  );
}

export default function AreasManager() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [areas, setAreas] = useState<Area[]>([]);
  const [unassignedPlaces, setUnassignedPlaces] = useState<Place[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [draggedPlace, setDraggedPlace] = useState<DraggedPlace | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [visibleAreaIds, setVisibleAreaIds] = useState<string[]>([]);
  const [minimizedAreaIds, setMinimizedAreaIds] = useState<string[]>([]);
  const [areaToDelete, setAreaToDelete] = useState<string | null>(null);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [editForm, setEditForm] = useState({ nombre: "", descripcion: "" });
  const [newAreaForm, setNewAreaForm] = useState({
    nombre: "",
    descripcion: "",
    color: "#3b82f6",
  });

  // Verificar acceso de usuario
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadData();
  }, []);

  // Inicializar orden de áreas visibles cuando se cargan los datos
  useEffect(() => {
    if (areas.length > 0 && visibleAreaIds.length === 0) {
      setVisibleAreaIds(areas.map(a => a.id));
    }
  }, [areas]);

  async function loadData() {
    try {
      setLoading(true);
      const data = await getData();
      setAreas(data.areas);
      setUnassignedPlaces(data.unassignedPlaces);
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

  function handleDragStart(event: DragStartEvent) {
    const dragData = event.active.data.current;
    const placeId = dragData?.placeId as string;
    const sourceAreaId = dragData?.areaId as string | null;

    // Buscar el place
    let place: Place | undefined;
    
    if (!sourceAreaId) {
      // Viene de "Sin Área"
      place = unassignedPlaces.find((p) => p.id === placeId);
    } else {
      // Viene de un área específica
      const sourceArea = areas.find((a) => a.id === sourceAreaId);
      place = sourceArea?.places.find((p) => p.id === placeId);
    }

    if (place) {
      setDraggedPlace({ place, sourceAreaId });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || !draggedPlace) {
      setDraggedPlace(null);
      return;
    }

    const dragData = active.data.current;
    const placeId = dragData?.placeId as string;
    const sourceAreaId = dragData?.areaId as string | null;
    const overAreaId = over.id as string;

    // Si se suelta en el mismo lugar, no hacer nada
    if (overAreaId === sourceAreaId || overAreaId === "unassigned" && !sourceAreaId) {
      setDraggedPlace(null);
      return;
    }

    // Persist to database
    try {
      if (overAreaId === "unassigned") {
        // Eliminar solo del área específica de origen
        if (sourceAreaId) {
          await unassignPlace(placeId, sourceAreaId);
          
          // Optimistic update: remover solo del área de origen
          setAreas((prev) =>
            prev.map((area) =>
              area.id === sourceAreaId
                ? {
                    ...area,
                    places: area.places.filter((p) => p.id !== placeId),
                  }
                : area
            )
          );
          
          toast({
            title: "Éxito",
            description: "Lugar removido del área",
          });
        }
      } else {
        // Asignar a nueva área (sin eliminar de otras)
        await assignPlaceToArea(placeId, overAreaId);
        
        // Optimistic update: agregar al área destino si no existe
        setAreas((prev) =>
          prev.map((area) => {
            if (area.id === overAreaId) {
              // Verificar si ya existe para evitar duplicados visuales
              const exists = area.places.some((p) => p.id === placeId);
              if (!exists) {
                return { ...area, places: [...area.places, draggedPlace.place] };
              }
            }
            return area;
          })
        );
        
        toast({
          title: "Éxito",
          description: "Lugar asignado al área",
        });
      }
    } catch (error) {
      console.error("Error updating assignment:", error);
      toast({
        title: "Error",
        description: "No se pudo actualizar la asignación",
        variant: "destructive",
      });
      // Recargar en caso de error
      loadData();
    }
    
    setDraggedPlace(null);
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
      const newArea = await createArea(newAreaForm);
      
      // Agregar nueva área al final de las visibles
      setVisibleAreaIds((prev) => [...prev, newArea.id]);
      
      toast({
        title: "Éxito",
        description: "Área creada correctamente",
      });
      setIsDialogOpen(false);
      setNewAreaForm({ nombre: "", descripcion: "", color: "#3b82f6" });
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
    // Optimistic update
    setAreas((prev) =>
      prev.map((area) =>
        area.id === areaId ? { ...area, vendedores: vendedorIds } : area
      )
    );

    try {
      await setAreaVendedores(areaId, vendedorIds);
      toast({
        title: "Éxito",
        description: "Vendedores actualizados",
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

  function handleMinimizeArea(areaId: string) {
    setVisibleAreaIds((prev) => prev.filter(id => id !== areaId));
    setMinimizedAreaIds((prev) => [...prev, areaId]);
    toast({
      title: "Área minimizada",
      description: "El área se ha ocultado del tablero",
    });
  }

  function handleRestoreArea(areaId: string) {
    setMinimizedAreaIds((prev) => prev.filter(id => id !== areaId));
    setVisibleAreaIds((prev) => [...prev, areaId]); // Agregar al final
    toast({
      title: "Área restaurada",
      description: "El área se ha restaurado al tablero",
    });
  }

  async function handleDeleteArea(areaId: string) {
    try {
      // Delete area relationships first
      await supabase.from("areas_vendedores").delete().eq("area_id", areaId);
      await supabase.from("areas_places").delete().eq("area_id", areaId);
      
      // Delete area
      const { error } = await supabase.from("areas").delete().eq("id", areaId);
      
      if (error) throw error;

      // Update local state
      setAreas((prev) => prev.filter((area) => area.id !== areaId));
      setVisibleAreaIds((prev) => prev.filter(id => id !== areaId));
      setMinimizedAreaIds((prev) => prev.filter(id => id !== areaId));

      toast({
        title: "Área eliminada",
        description: "El área y sus asignaciones se han eliminado correctamente",
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

      // Actualizar estado local
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

  function filterPlaces(places: Place[]) {
    if (!searchFilter.trim()) return places;
    const query = searchFilter.toLowerCase();
    return places.filter(
      (p) =>
        p.barrio_principal?.toLowerCase().includes(query) ||
        p.comuna?.toLowerCase().includes(query) ||
        p.provincia_principal?.toLowerCase().includes(query)
    );
  }

  const vendedorOptions = profiles.map((p) => ({
    label: p.nombre,
    value: p.id,
  }));

  // Ordenar áreas visibles según visibleAreaIds
  const visibleAreas = visibleAreaIds
    .map(id => areas.find(a => a.id === id))
    .filter((area): area is Area => area !== undefined);
  
  const hiddenAreas = minimizedAreaIds
    .map(id => areas.find(a => a.id === id))
    .filter((area): area is Area => area !== undefined);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Gestión de Áreas</h1>
            <p className="text-muted-foreground">
              Organiza lugares por área y asigna vendedores
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Área
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Nueva Área</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateArea} className="space-y-4">
                <div>
                  <Label htmlFor="nombre">Nombre *</Label>
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
                <Button type="submit" className="w-full">
                  Crear Área
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Minimized Areas Bar */}
        {hiddenAreas.length > 0 && (
          <div className="bg-muted/20 rounded-xl p-4 border animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <Minimize2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                Áreas minimizadas ({hiddenAreas.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {hiddenAreas.map((area) => (
                <Button
                  key={area.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => handleRestoreArea(area.id)}
                  className="animate-scale-in hover-scale"
                  style={{
                    borderLeftWidth: "3px",
                    borderLeftColor: area.color || undefined,
                  }}
                >
                  <Maximize2 className="mr-2 h-3 w-3" />
                  {area.nombre}
                  <Badge variant="outline" className="ml-2">
                    {area.places.length}
                  </Badge>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Search Filter */}
        <div className="max-w-md">
          <Input
            placeholder="Buscar por barrio, comuna o provincia..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        {/* Drag and Drop Context */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {/* Unassigned Column */}
            <DroppableArea id="unassigned">
              <Card className="w-80 flex-shrink-0">
                <CardHeader>
                  <CardTitle className="text-lg">Sin Área</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {filterPlaces(unassignedPlaces).length} lugares
                  </p>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-2">
                      {filterPlaces(unassignedPlaces).map((place) => (
                        <DraggablePlace
                          key={`unassigned-${place.id}`}
                          place={place}
                          id={`unassigned-${place.id}`}
                          areaId={undefined}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </DroppableArea>

            {/* Area Columns */}
            {visibleAreas.map((area) => (
              <DroppableArea key={area.id} id={area.id}>
                <Card
                  className="w-80 flex-shrink-0 animate-fade-in"
                  style={{ borderTopColor: area.color || undefined, borderTopWidth: "4px" }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{area.nombre}</CardTitle>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingArea(area);
                              setEditForm({ 
                                nombre: area.nombre, 
                                descripcion: area.descripcion || "" 
                              });
                            }}
                            className="h-6 w-6 hover:bg-muted"
                            title="Editar área"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                        {area.descripcion && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {area.descripcion}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          {filterPlaces(area.places).length} lugares
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleMinimizeArea(area.id)}
                          className="h-8 w-8 hover:bg-muted"
                          title="Minimizar área"
                        >
                          <Minimize2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setAreaToDelete(area.id)}
                          className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                          title="Eliminar área"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2">
                        Vendedores asignados
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
                    <ScrollArea className="h-[500px] pr-4">
                      <div className="space-y-2">
                        {filterPlaces(area.places).map((place) => (
                          <DraggablePlace
                            key={`${area.id}-${place.id}`}
                            place={place}
                            id={`${area.id}-${place.id}`}
                            areaId={area.id}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </DroppableArea>
            ))}
          </div>

          <DragOverlay>
            {draggedPlace ? <PlaceItem place={draggedPlace.place} /> : null}
          </DragOverlay>
        </DndContext>

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
                Los lugares volverán a estar disponibles en "Sin Área".
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
  );
}
