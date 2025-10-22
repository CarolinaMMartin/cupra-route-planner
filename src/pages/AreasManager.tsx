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
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Loader2 } from "lucide-react";
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

  // Unassigned places
  const assignedPlaceIds = new Set(areasPlaces.map((ap) => ap.place_id));
  const unassignedPlaces = places.filter((p) => !assignedPlaceIds.has(p.id));

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
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;

  const { data: newArea, error } = await supabase
    .from("areas")
    .insert({
      nombre: data.nombre,
      descripcion: data.descripcion || null,
      color: data.color || null,
      created_by: userId || null,
    })
    .select()
    .single();

  if (error) throw error;
  return newArea;
}

async function assignPlaceToArea(placeId: string, areaId: string) {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;

  const { error } = await supabase.from("areas_places").upsert(
    {
      area_id: areaId,
      place_id: placeId,
      created_by: userId || null,
    },
    { onConflict: "area_id,place_id" }
  );

  if (error) throw error;
}

async function unassignPlace(placeId: string) {
  const { error } = await supabase
    .from("areas_places")
    .delete()
    .eq("place_id", placeId);

  if (error) throw error;
}

async function setAreaVendedores(areaId: string, vendedorIds: string[]) {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;

  // Delete existing
  await supabase.from("areas_vendedores").delete().eq("area_id", areaId);

  // Insert new
  if (vendedorIds.length > 0) {
    const { error } = await supabase.from("areas_vendedores").insert(
      vendedorIds.map((vendedorId) => ({
        area_id: areaId,
        vendedor_id: vendedorId,
        created_by: userId || null,
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
  return (
    <div data-droppable-id={id} className="flex-1 min-h-[200px]">
      {children}
    </div>
  );
}

function DraggablePlace({ place, id }: { place: Place; id: string }) {
  return (
    <div data-draggable-id={id}>
      <PlaceItem place={place} />
    </div>
  );
}

export default function AreasManager() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [unassignedPlaces, setUnassignedPlaces] = useState<Place[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [draggedPlace, setDraggedPlace] = useState<DraggedPlace | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newAreaForm, setNewAreaForm] = useState({
    nombre: "",
    descripcion: "",
    color: "#3b82f6",
  });

  const { toast } = useToast();

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
    const placeId = event.active.id as string;
    let sourceAreaId: string | null = null;
    let place: Place | undefined;

    // Find place in unassigned
    place = unassignedPlaces.find((p) => p.id === placeId);

    // Find place in areas
    if (!place) {
      for (const area of areas) {
        place = area.places.find((p) => p.id === placeId);
        if (place) {
          sourceAreaId = area.id;
          break;
        }
      }
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

    const placeId = active.id as string;
    const overAreaId = over.id as string;
    const sourceAreaId = draggedPlace.sourceAreaId;

    // No change
    if (overAreaId === sourceAreaId) {
      setDraggedPlace(null);
      return;
    }

    // Optimistic update
    const updatedAreas = [...areas];
    let updatedUnassigned = [...unassignedPlaces];

    // Remove from source
    if (sourceAreaId) {
      const sourceArea = updatedAreas.find((a) => a.id === sourceAreaId);
      if (sourceArea) {
        sourceArea.places = sourceArea.places.filter((p) => p.id !== placeId);
      }
    } else {
      updatedUnassigned = updatedUnassigned.filter((p) => p.id !== placeId);
    }

    // Add to destination
    if (overAreaId === "unassigned") {
      updatedUnassigned.push(draggedPlace.place);
    } else {
      const destArea = updatedAreas.find((a) => a.id === overAreaId);
      if (destArea) {
        destArea.places.push(draggedPlace.place);
      }
    }

    setAreas(updatedAreas);
    setUnassignedPlaces(updatedUnassigned);
    setDraggedPlace(null);

    // Persist to database
    try {
      if (overAreaId === "unassigned") {
        await unassignPlace(placeId);
        toast({
          title: "Éxito",
          description: "Lugar movido a sin área",
        });
      } else {
        await assignPlaceToArea(placeId, overAreaId);
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
      // Revert on error
      loadData();
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
      await createArea(newAreaForm);
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
                          key={place.id}
                          place={place}
                          id={place.id}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </DroppableArea>

            {/* Area Columns */}
            {areas.map((area) => (
              <DroppableArea key={area.id} id={area.id}>
                <Card
                  className="w-80 flex-shrink-0"
                  style={{ borderTopColor: area.color || undefined }}
                >
                  <CardHeader>
                    <CardTitle className="text-lg">{area.nombre}</CardTitle>
                    {area.descripcion && (
                      <p className="text-sm text-muted-foreground">
                        {area.descripcion}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {filterPlaces(area.places).length} lugares
                    </p>
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
                            key={place.id}
                            place={place}
                            id={place.id}
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
      </div>
    </div>
  );
}
