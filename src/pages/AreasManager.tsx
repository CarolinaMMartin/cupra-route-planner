import { useState, useEffect } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppNav from "@/components/AppNav";
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
import { Plus, MapPin, Loader2, Trash2, Pencil, Save, Search, X, SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GEO_BA } from "@/data/geoBuenosAires";


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

interface CatalogEntry {
  key: string;
  barrio: string;
  comuna: string | null;
  provincia: string;
  placeId: string | null;
}

const normalizeGeo = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const catalogKey = (provincia: string, barrio: string) =>
  `${normalizeGeo(provincia)}||${normalizeGeo(barrio)}`;




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
  const [showFilters, setShowFilters] = useState(false);
  const [provinciaFilter, setProvinciaFilter] = useState("todas");
  const [comunaFilter, setComunaFilter] = useState("todas");
  const [vendedorFilter, setVendedorFilter] = useState("todos");
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
      
      if (!profile || !isAssignorLike(profile.rol)) {
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
      
      // Assign selected places to the area (creando el barrio si no existe)
      if (newAreaForm.selectedPlaces.length > 0) {
        for (const key of newAreaForm.selectedPlaces) {
          const entry = catalogByKey.get(key);
          if (!entry) continue;
          const placeId = await ensurePlaceId(entry);
          await assignPlaceToArea(placeId, newArea.id);
        }
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

  /** Devuelve el id de places para un barrio del catálogo, creándolo si no existe. */
  async function ensurePlaceId(entry: CatalogEntry): Promise<string> {
    if (entry.placeId) return entry.placeId;

    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("barrio_principal", entry.barrio)
      .eq("provincia_principal", entry.provincia)
      .maybeSingle();

    if (existing?.id) {
      setAllPlaces((prev) =>
        prev.some((p) => p.id === existing.id)
          ? prev
          : [
              ...prev,
              {
                id: existing.id,
                barrio_principal: entry.barrio,
                comuna: entry.comuna,
                provincia_principal: entry.provincia,
              },
            ],
      );
      return existing.id;
    }

    const { data: created, error } = await supabase
      .from("places")
      .insert({
        barrio_principal: entry.barrio,
        comuna: entry.comuna,
        provincia_principal: entry.provincia,
      })
      .select("id, barrio_principal, comuna, provincia_principal")
      .single();

    if (error) throw error;
    setAllPlaces((prev) => [...prev, created as Place]);
    return created.id;
  }

  async function handleAddCatalogToArea(key: string, areaId: string) {
    const entry = catalogByKey.get(key);
    if (!entry) return;
    try {
      const placeId = await ensurePlaceId(entry);
      await assignPlaceToArea(placeId, areaId);
      setAreas((prev) =>
        prev.map((area) =>
          area.id === areaId && !area.places.some((p) => p.id === placeId)
            ? {
                ...area,
                places: [
                  ...area.places,
                  {
                    id: placeId,
                    barrio_principal: entry.barrio,
                    comuna: entry.comuna,
                    provincia_principal: entry.provincia,
                  },
                ],
              }
            : area,
        ),
      );
      toast({ title: `${entry.barrio} agregado a la zona` });
    } catch (error) {
      console.error("Error adding place:", error);
      toast({
        title: "Error",
        description: "No se pudo agregar el barrio",
        variant: "destructive",
      });
    }
  }

  const assignedKeys = (area: Area) =>
    new Set(
      area.places
        .filter((p) => p.barrio_principal)
        .map((p) =>
          catalogKey(
            p.provincia_principal || "Ciudad Autónoma de Buenos Aires",
            p.barrio_principal as string,
          ),
        ),
    );


  const vendedorOptions = profiles.map((p) => ({
    label: p.nombre,
    value: p.id,
  }));

  // Catálogo completo de barrios: los que ya existen en la base + el listado
  // territorial oficial (para poder armar zonas aunque todavía no haya clientes).
  const catalog: CatalogEntry[] = (() => {
    const map = new Map<string, CatalogEntry>();
    allPlaces.forEach((p) => {
      if (!p.barrio_principal) return;
      const provincia = p.provincia_principal || "Ciudad Autónoma de Buenos Aires";
      map.set(catalogKey(provincia, p.barrio_principal), {
        key: catalogKey(provincia, p.barrio_principal),
        barrio: p.barrio_principal,
        comuna: p.comuna,
        provincia,
        placeId: p.id,
      });
    });
    Object.entries(GEO_BA).forEach(([provincia, comunas]) => {
      Object.entries(comunas).forEach(([comuna, barrios]) => {
        barrios.forEach((barrio) => {
          const key = catalogKey(provincia, barrio);
          const existing = map.get(key);
          if (existing) {
            if (!existing.comuna) existing.comuna = comuna;
            return;
          }
          map.set(key, { key, barrio, comuna, provincia, placeId: null });
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.barrio.localeCompare(b.barrio, "es"));
  })();

  const catalogByKey = new Map(catalog.map((c) => [c.key, c]));

  const catalogOptions = catalog.map((c) => ({
    label: `${c.barrio}${c.comuna ? ` · ${c.comuna}` : ""} (${c.provincia})`,
    value: c.key,
  }));

  const provinciaOptions = Array.from(new Set(catalog.map((c) => c.provincia))).sort();
  const comunaOptions = Array.from(
    new Set(catalog.filter((c) => c.comuna).map((c) => c.comuna as string))
  ).sort();


  const activeFiltersCount =
    (provinciaFilter !== "todas" ? 1 : 0) +
    (comunaFilter !== "todas" ? 1 : 0) +
    (vendedorFilter !== "todos" ? 1 : 0);

  const filteredAreas = areas.filter((area) => {
    if (!area.nombre.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (provinciaFilter !== "todas" && !area.places.some((p) => p.provincia_principal === provinciaFilter)) return false;
    if (comunaFilter !== "todas" && !area.places.some((p) => p.comuna === comunaFilter)) return false;
    if (vendedorFilter !== "todos" && !area.vendedores.includes(vendedorFilter)) return false;
    return true;
  });

  const vendedorNombre = (id: string) => profiles.find((p) => p.id === id)?.nombre || "—";


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
          <div>
            <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">Gestión de Áreas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Organiza barrios por área
            </p>
          </div>

          {/* Search + filtros colapsables */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Buscar áreas..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="max-w-md"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
              >
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                Filtros
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2">{activeFiltersCount}</Badge>
                )}
                {showFilters ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
              </Button>
              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setProvinciaFilter("todas");
                    setComunaFilter("todas");
                    setVendedorFilter("todos");
                  }}
                >
                  <X className="h-4 w-4 mr-1" /> Limpiar
                </Button>
              )}
            </div>

            {showFilters && (
              <Card>
                <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Provincia</Label>
                    <Select value={provinciaFilter} onValueChange={setProvinciaFilter}>
                      <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        {provinciaOptions.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Comuna</Label>
                    <Select value={comunaFilter} onValueChange={setComunaFilter}>
                      <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        {comunaOptions.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Vendedor</Label>
                    <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                      <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
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
                          <MultiSelect
                            options={catalogOptions.filter(
                              (o) => !assignedKeys(area).has(o.value),
                            )}
                            selected={[]}
                            onChange={(selected) => {
                              selected.forEach((key) => handleAddCatalogToArea(key, area.id));
                            }}
                            placeholder="Buscar y agregar barrios..."
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            {area.places.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-2">
                                Todavía no hay barrios en esta zona. Buscalos arriba y agregalos.
                              </p>
                            ) : (
                              area.places.map((place) => (
                                <Badge
                                  key={place.id}
                                  variant="secondary"
                                  className="pl-2 pr-1 py-1 gap-1 text-xs font-medium"
                                >
                                  <MapPin className="h-3 w-3 text-primary" />
                                  <span>{place.barrio_principal || "Sin nombre"}</span>
                                  {place.comuna && (
                                    <span className="text-muted-foreground">· {place.comuna}</span>
                                  )}
                                  <button
                                    type="button"
                                    aria-label={`Quitar ${place.barrio_principal || "barrio"}`}
                                    onClick={() => handleRemovePlaceFromArea(place.id, area.id)}
                                    className="ml-1 rounded p-0.5 hover:bg-destructive/20"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ))
                            )}
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

        {/* Crear nueva área */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nueva zona</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateArea} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nombre">Nombre *</Label>
                  <Input
                    id="nombre"
                    value={newAreaForm.nombre}
                    onChange={(e) => setNewAreaForm({ ...newAreaForm, nombre: e.target.value })}
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
                      onChange={(e) => setNewAreaForm({ ...newAreaForm, color: e.target.value })}
                      className="w-16 h-10 p-1"
                    />
                    <Input
                      value={newAreaForm.color}
                      onChange={(e) => setNewAreaForm({ ...newAreaForm, color: e.target.value })}
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
                  onChange={(e) => setNewAreaForm({ ...newAreaForm, descripcion: e.target.value })}
                  placeholder="Referencias, avenidas límite, etc."
                  rows={2}
                />
              </div>
              <div>
                <Label>Barrios</Label>
                <MultiSelect
                  options={catalogOptions}
                  selected={newAreaForm.selectedPlaces}
                  onChange={(selected) =>
                    setNewAreaForm({ ...newAreaForm, selectedPlaces: selected })
                  }
                  placeholder="Buscar barrios..."
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {newAreaForm.selectedPlaces.length} barrio(s) seleccionados
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">
                  <Plus className="mr-2 h-4 w-4" />
                  Crear zona
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>



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
