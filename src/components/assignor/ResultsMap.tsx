import { useEffect, useRef, useState } from "react";
import { Sucursal } from "@/types/sales";
import { isManualPlaceId } from "@/lib/utils";
import { GOOGLE_MAPS_BROWSER_KEY, loadGoogleMaps } from "@/lib/googleMaps";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, Loader2, ArrowRight, AlertTriangle, Pencil } from "lucide-react";
import { getVendorColor, createColoredMarkerIcon, resetVendorColors, getVendorColorMap, classifyClientState, getStateColor, calcularDistanciaKmFrontend } from "@/lib/vendorColors";

interface ResultsMapProps {
  sucursales: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll?: () => void;
  onContinue?: () => void;
}

interface ClientLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  direccion: string;
  vendedor?: string;
  estado_cliente?: string;
  es_prospecto?: boolean;
  hasOverlap?: boolean;
}

interface SinUbicacionItem {
  id: string;
  nombre: string;
  direccion: string;
  client_id?: string;
  es_prospecto: boolean;
}


// Carga centralizada del script de Google Maps
const loadGoogleMapsScript = (apiKey: string) => loadGoogleMaps(apiKey);

const ResultsMap = ({ sucursales, selectedIds, onToggle, onToggleAll, onContinue }: ResultsMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<Map<string, google.maps.Marker>>(new Map());
  const [locations, setLocations] = useState<ClientLocation[]>([]);
  const [vendorLegend, setVendorLegend] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinUbicacion, setSinUbicacion] = useState<SinUbicacionItem[]>([]);
  const [correccion, setCorreccion] = useState<SinUbicacionItem | null>(null);
  const [direccionEditada, setDireccionEditada] = useState("");
  const [guardandoDireccion, setGuardandoDireccion] = useState(false);
  const { toast } = useToast();

  const guardarCorreccion = async () => {
    if (!correccion?.client_id || !direccionEditada.trim()) return;
    setGuardandoDireccion(true);
    const { data, error } = await supabase.functions.invoke("resolve-client-location", {
      body: {
        client_id: correccion.client_id,
        direccion: direccionEditada.trim(),
        manual: true,
      },
    });
    setGuardandoDireccion(false);
    if (error || (data as any)?.error) {
      toast({
        title: "No se pudo guardar",
        description: (data as any)?.error || error?.message || "Revisá la dirección ingresada.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Dirección corregida",
      description: "Queda verificada y no se pisa con las próximas cargas de Excel.",
    });
    setSinUbicacion((prev) => prev.filter((s) => s.id !== correccion.id));
    setCorreccion(null);
  };


  // Initialize Google Maps
  useEffect(() => {
    const apiKey = GOOGLE_MAPS_BROWSER_KEY;

    if (!apiKey) {
      setError("El mapa no está configurado. Contactá al administrador.");
      setLoading(false);
      return;
    }

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (!mapRef.current) return;

        const mapInstance = new google.maps.Map(mapRef.current, {
          zoom: 12,
          center: { lat: -34.6037, lng: -58.3816 }, // Buenos Aires default
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });

        setMap(mapInstance);
      })
      .catch((err) => {
        setError("Error al cargar Google Maps: " + err.message);
        setLoading(false);
      });
  }, []);

  // Fetch locations from sucursales
  useEffect(() => {
    if (!map) return;

    const fetchLocations = async () => {
      setLoading(true);
      resetVendorColors();
      const service = new google.maps.places.PlacesService(map);
      const geocoder = new google.maps.Geocoder();
      const fetchedLocations: ClientLocation[] = [];

      const resolveRecommendedVendor = (sucursal: Sucursal) => {
        // Prefer vendedor_actual (already resolved to name in AssignorDashboard)
        // Never show a UUID — skip vendedor_recomendado_id (it's a UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
        const candidates = [
          sucursal.vendedor_actual,
          sucursal.vendedor_principal,
        ].filter(Boolean).filter(v => !uuidRegex.test(v!));
        return candidates[0] || "Sin vendedor";
      };

      const promises = sucursales.map(async (sucursal) => {
        try {
          // If we have lat/lng, validate and use them directly
          if (sucursal.latitud && sucursal.longitud) {
            const lat = sucursal.latitud;
            const lng = sucursal.longitud;
            
            // Validate coordinates are within Argentina's range
            const isValidLat = lat >= -60 && lat <= -20;
            const isValidLng = lng >= -80 && lng <= -40;
            
            if (isValidLat && isValidLng) {
              const vendedor = resolveRecommendedVendor(sucursal);
              if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
              const estado_cliente = sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto);
              return {
                id: sucursal.id,
                name: sucursal.nombre || sucursal.fantasia || "Sin nombre",
                lat: lat,
                lng: lng,
                direccion: sucursal.direccion || sucursal.direccion_principal || "",
                vendedor,
                es_prospecto: !!sucursal.es_prospecto,
                estado_cliente,
              };
            } else {
              console.warn(`[ResultsMap] Coordenadas fuera de rango Argentina:`, { id: sucursal.id, lat, lng });
            }
          }

          // If we have place_id, check if it's manual or Google
          if (sucursal.prospecto_place_id) {
            // Si es un place_id manual, ya tenemos las coordenadas en latitud/longitud
            if (isManualPlaceId(sucursal.prospecto_place_id)) {
              const lat = sucursal.latitud;
              const lng = sucursal.longitud;
              
              if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                const isValidLat = lat >= -60 && lat <= -20;
                const isValidLng = lng >= -80 && lng <= -40;
                
                if (isValidLat && isValidLng) {
                  const vendedor = resolveRecommendedVendor(sucursal);
                  if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
                  const estado_cliente = sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto);
                  return {
                    id: sucursal.id,
                    name: sucursal.nombre || sucursal.fantasia || "Sin nombre",
                    lat: lat,
                    lng: lng,
                    direccion: sucursal.direccion || sucursal.direccion_principal || "",
                    vendedor,
                    es_prospecto: !!sucursal.es_prospecto,
                    estado_cliente,
                  };
                }
              }
              console.warn(`[ResultsMap] Prospecto manual sin coordenadas válidas:`, {
                id: sucursal.id,
                place_id: sucursal.prospecto_place_id
              });
              return null;
            }
            
            // Para place_id de Google, usar Places API
            return new Promise<ClientLocation>((resolve, reject) => {
              service.getDetails({ placeId: sucursal.prospecto_place_id! }, (place, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                  const vendedor = resolveRecommendedVendor(sucursal);
                  if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
                  const estado_cliente = sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto);
                  resolve({
                    id: sucursal.id,
                    name: place.name || sucursal.nombre || "Sin nombre",
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    direccion: place.formatted_address || sucursal.direccion || "",
                    vendedor,
                    es_prospecto: !!sucursal.es_prospecto,
                    estado_cliente,
                  });
                } else {
                  reject(new Error(`No se pudo obtener ubicación para ${sucursal.nombre}`));
                }
              });
            });
          }

          // Fallback 1: place_id extraído del link de Google Maps
          const linkPlaceId = (sucursal as any).place_id as string | undefined;
          if (linkPlaceId && !isManualPlaceId(linkPlaceId)) {
            const fromPlace = await new Promise<ClientLocation | null>((resolve) => {
              service.getDetails({ placeId: linkPlaceId }, (place, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                  const vendedor = resolveRecommendedVendor(sucursal);
                  if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
                  resolve({
                    id: sucursal.id,
                    name: sucursal.nombre || place.name || "Sin nombre",
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    direccion: place.formatted_address || sucursal.direccion_principal || sucursal.direccion || "",
                    vendedor,
                    es_prospecto: !!sucursal.es_prospecto,
                    estado_cliente: sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto),
                  });
                } else {
                  resolve(null);
                }
              });
            });
            if (fromPlace) return fromPlace;
          }

          // Fallback 2: geocodificar la dirección textual
          const direccionTexto = [
            sucursal.direccion_principal || sucursal.direccion,
            sucursal.barrio_principal,
            (sucursal as any).ciudad_principa || sucursal.todas_ciudades?.[0],
            sucursal.provincia_principal,
            "Argentina",
          ].filter(Boolean).join(", ");

          if (direccionTexto && direccionTexto !== "Argentina") {
            const geocoded = await new Promise<ClientLocation | null>((resolve) => {
              geocoder.geocode({ address: direccionTexto }, (res, status) => {
                if (status === "OK" && res?.[0]?.geometry?.location) {
                  const loc = res[0].geometry.location;
                  const vendedor = resolveRecommendedVendor(sucursal);
                  if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
                  resolve({
                    id: sucursal.id,
                    name: sucursal.nombre || sucursal.fantasia || "Sin nombre",
                    lat: loc.lat(),
                    lng: loc.lng(),
                    direccion: res[0].formatted_address,
                    vendedor,
                    es_prospecto: !!sucursal.es_prospecto,
                    estado_cliente: sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto),
                  });
                } else {
                  resolve(null);
                }
              });
            });
            if (geocoded) {
              // Persistimos la geocodificación para que el cliente quede ubicado a futuro
              const clientId = (sucursal as any).client_id as string | undefined;
              if (clientId && !sucursal.es_prospecto) {
                supabase.functions
                  .invoke("resolve-client-location", {
                    body: {
                      client_id: clientId,
                      lat: geocoded.lat,
                      lng: geocoded.lng,
                      direccion: geocoded.direccion,
                    },
                  })
                  .catch(() => undefined);
              }
              return geocoded;
            }
          }


          console.warn(`[ResultsMap] Sin ubicación resoluble:`, sucursal.nombre);
          return null;
        } catch (err) {
          console.error(`Error fetching location for ${sucursal.nombre}:`, err);
          return null;
        }
      });

      const results = await Promise.allSettled(promises);

      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          fetchedLocations.push(result.value);
        }
      });

      // Detect overlaps: markers from different vendors within 200m
      for (let i = 0; i < fetchedLocations.length; i++) {
        for (let j = i + 1; j < fetchedLocations.length; j++) {
          const a = fetchedLocations[i];
          const b = fetchedLocations[j];
          if (a.vendedor && b.vendedor && a.vendedor !== b.vendedor) {
            const dist = calcularDistanciaKmFrontend(a.lat, a.lng, b.lat, b.lng);
            if (dist < 0.2) {
              a.hasOverlap = true;
              b.hasOverlap = true;
            }
          }
        }
      }

      const resueltos = new Set(fetchedLocations.map((l) => l.id));
      setSinUbicacion(
        sucursales
          .filter((s) => !resueltos.has(s.id))
          .map((s) => ({
            id: s.id,
            nombre: s.nombre || s.fantasia || "Sin nombre",
            direccion: [s.direccion_principal || s.direccion, s.barrio_principal, s.provincia_principal]
              .filter(Boolean)
              .join(", "),
            client_id: (s as any).client_id as string | undefined,
            es_prospecto: !!s.es_prospecto,
          })),
      );


      setLocations(fetchedLocations);
      setVendorLegend(getVendorColorMap());
      setLoading(false);
    };

    fetchLocations();
  }, [sucursales, map]);

  // Render every resolved location; selection only changes emphasis
  useEffect(() => {
    if (!map || locations.length === 0) return;

    const nextMarkers = new Map(markers);
    const validIds = new Set(locations.map((l) => l.id));

    nextMarkers.forEach((marker, id) => {
      if (!validIds.has(id)) {
        marker.setMap(null);
        nextMarkers.delete(id);
      }
    });

    const bounds = new google.maps.LatLngBounds();
    let hasValidBounds = false;

    locations.forEach((location) => {
      const isSelected = selectedIds.includes(location.id);
      const vendorColor = location.vendedor ? getVendorColor(location.vendedor) : '#999999';
      let marker = nextMarkers.get(location.id);

      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: location.lat, lng: location.lng },
          map,
          title: location.name,
          icon: createColoredMarkerIcon(vendorColor),
        });

        const tipoLabel = location.es_prospecto ? 'Prospecto nuevo' : 'Cliente de cartera';
        const tipoBg = location.es_prospecto ? '#8B5CF6' : '#0F766E';
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px; max-width: 260px; color: #111827; font-family: system-ui, sans-serif;">
              <h3 style="margin: 0 0 6px 0; font-weight: 600; font-size: 14px; color: #111827;">${location.name}</h3>
              <span style="display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #ffffff; background: ${tipoBg};">${tipoLabel}</span>
              ${location.estado_cliente ? `<span style="display:inline-block; margin-left:4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; color: #111827; background: #E5E7EB;">${location.estado_cliente}</span>` : ''}
              <p style="margin: 6px 0 0 0; font-size: 12px; color: #4B5563;">${location.direccion}</p>
              ${location.vendedor ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #111827;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${vendorColor};margin-right:6px;vertical-align:middle;"></span>${location.vendedor}</p>` : ''}
            </div>
          `,
        });


        marker.addListener("click", () => {
          infoWindow.open(map, marker!);
        });

        nextMarkers.set(location.id, marker);
      }

      marker.setOpacity(isSelected ? 1 : 0.4);
      marker.setZIndex(isSelected ? 2 : 1);

      bounds.extend({ lat: location.lat, lng: location.lng });
      hasValidBounds = true;
    });

    setMarkers(nextMarkers);

    if (hasValidBounds) {
      map.fitBounds(bounds);
    }
  }, [map, locations, selectedIds]);

  const handleToggle = (id: string) => {
    onToggle(id);
  };

  if (error) {
    return (
      <Card className="h-[600px] w-full flex items-center justify-center bg-card">
        <div className="text-center text-destructive p-4">
          <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {onContinue && (
        <div className="flex items-center justify-end">
          <Button 
            onClick={onContinue} 
            disabled={selectedIds.length === 0}
            size="lg"
            className="gap-2"
          >
            Continuar a la Asignación
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
      
      <div className="flex flex-col md:flex-row h-[600px] w-full rounded-lg overflow-hidden border border-border bg-card">
        {/* Sidebar */}
        <div className="w-full md:w-1/4 md:border-r border-border bg-card flex flex-col md:max-h-[600px]">
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Clientes
              </h3>
              <Badge variant="secondary">
                {selectedIds.length} de {sucursales.length}
              </Badge>
            </div>
            {!loading && locations.length < sucursales.length && (
              <p className="flex items-start gap-1.5 text-xs text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                {sucursales.length - locations.length} sin ubicación georreferenciada
              </p>
            )}
            {onToggleAll && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={onToggleAll}
              >
                {selectedIds.length === sucursales.length && sucursales.length > 0
                  ? 'Deseleccionar todos'
                  : 'Seleccionar todos'}
              </Button>
            )}
          </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {locations.map((location, idx) => {
              const sucursal = sucursales.find((s) => s.id === location.id);
              const isSelected = selectedIds.includes(location.id);
              const vendorColor = location.vendedor ? getVendorColor(location.vendedor) : '#999999';

              return (
                <div
                  key={`${location.id}-${idx}`}
                  className="flex items-start gap-2 p-3 rounded-md hover:bg-accent/50 transition-colors mb-1"
                >
                  <Checkbox
                    id={`loc-${location.id}-${idx}`}
                    checked={isSelected}
                    onCheckedChange={() => handleToggle(location.id)}
                    className="mt-1"
                  />
                  <label htmlFor={`loc-${location.id}-${idx}`} className="flex-1 cursor-pointer text-sm">
                    <div className="font-medium text-foreground flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: vendorColor }} />
                      {location.name}
                      {location.hasOverlap && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{location.direccion}</div>
                    {sucursal?.score && (
                      <div className="text-xs text-muted-foreground mt-1">Score: {sucursal.score}</div>
                    )}
                  </label>
                </div>
              );
            })}

            {!loading && sinUbicacion.length > 0 && (
              <div className="m-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  {sinUbicacion.length} de {sucursales.length} sin dirección válida
                </div>
                <p className="text-xs text-muted-foreground">
                  Están en la ruta por su historial comercial, pero no se pudo ubicar su dirección.
                  Corregila una vez y queda guardada aunque se recargue el Excel.
                </p>
                <div className="space-y-1.5">
                  {sinUbicacion.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-2 rounded border border-border/60 bg-background/60 p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{item.nombre}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {item.direccion || "Sin dirección cargada"}
                        </p>
                      </div>
                      {item.client_id && !item.es_prospecto && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-shrink-0 gap-1 text-[11px]"
                          onClick={() => {
                            setCorreccion(item);
                            setDireccionEditada(item.direccion || "");
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          Corregir
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}



            {locations.length === 0 && !loading && (
              <div className="text-center text-muted-foreground p-4">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No hay ubicaciones disponibles</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
              <p className="text-sm text-muted-foreground">Cargando ubicaciones...</p>
            </div>
          </div>
        )}

        {/* Vendor color legend */}
        {!loading && vendorLegend.size > 0 && (
          <div className="absolute bottom-4 left-4 bg-background/95 backdrop-blur-sm p-3 rounded-lg shadow-lg border z-10 max-h-64 overflow-y-auto">
            <p className="text-xs font-medium mb-2 text-foreground">Vendedores</p>
            <div className="space-y-1">
              {Array.from(vendorLegend.entries()).map(([name, color]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-muted-foreground truncate max-w-[140px]">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      <Dialog open={!!correccion} onOpenChange={(open) => !open && setCorreccion(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Corregir dirección</DialogTitle>
            <DialogDescription>
              {correccion?.nombre}. La dirección corregida se verifica en el mapa y queda fija:
              las próximas cargas de Excel no la sobrescriben.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="direccion-correccion">Dirección completa</Label>
            <Input
              id="direccion-correccion"
              value={direccionEditada}
              onChange={(e) => setDireccionEditada(e.target.value)}
              placeholder="Av. Corrientes 1234, Balvanera, CABA"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorreccion(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarCorreccion} disabled={guardandoDireccion || !direccionEditada.trim()}>
              {guardandoDireccion && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verificar y guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
};

export default ResultsMap;
