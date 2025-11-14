import { useEffect, useRef, useState } from "react";
import { Sucursal } from "@/types/sales";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { MapPin, Loader2 } from "lucide-react";

interface ResultsMapProps {
  sucursales: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

interface ClientLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  direccion: string;
}

// Load Google Maps Script
const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof window.google !== "undefined") {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });
};

const ResultsMap = ({ sucursales, selectedIds, onToggle }: ResultsMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<Map<string, google.maps.Marker>>(new Map());
  const [locations, setLocations] = useState<ClientLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize Google Maps
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey || apiKey === "your_google_maps_api_key_here") {
      setError("Por favor, configura VITE_GOOGLE_MAPS_API_KEY en tu archivo .env");
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
      const service = new google.maps.places.PlacesService(map);
      const fetchedLocations: ClientLocation[] = [];

      const promises = sucursales.map(async (sucursal) => {
        try {
          // If we have lat/lng, use them directly
          if (sucursal.latitud && sucursal.longitud) {
            return {
              id: sucursal.id,
              name: sucursal.nombre || sucursal.fantasia || "Sin nombre",
              lat: sucursal.latitud,
              lng: sucursal.longitud,
              direccion: sucursal.direccion || sucursal.direccion_principal || "",
            };
          }

          // If we have place_id, fetch from Places API
          if (sucursal.prospecto_place_id) {
            return new Promise<ClientLocation>((resolve, reject) => {
              service.getDetails({ placeId: sucursal.prospecto_place_id! }, (place, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                  resolve({
                    id: sucursal.id,
                    name: place.name || sucursal.nombre || "Sin nombre",
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    direccion: place.formatted_address || sucursal.direccion || "",
                  });
                } else {
                  reject(new Error(`No se pudo obtener ubicación para ${sucursal.nombre}`));
                }
              });
            });
          }

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

      setLocations(fetchedLocations);
      setLoading(false);
    };

    fetchLocations();
  }, [sucursales, map]);

  // Update markers based on selected clients
  useEffect(() => {
    if (!map || locations.length === 0) return;

    // Remove markers that are no longer selected
    markers.forEach((marker, id) => {
      if (!selectedIds.includes(id)) {
        marker.setMap(null);
        markers.delete(id);
      }
    });

    // Add markers for selected clients
    const bounds = new google.maps.LatLngBounds();
    let hasValidBounds = false;

    locations.forEach((location) => {
      if (selectedIds.includes(location.id)) {
        if (!markers.has(location.id)) {
          const marker = new google.maps.Marker({
            position: { lat: location.lat, lng: location.lng },
            map,
            title: location.name,
            animation: google.maps.Animation.DROP,
          });

          // Add info window
          const infoWindow = new google.maps.InfoWindow({
            content: `
              <div style="padding: 8px;">
                <h3 style="margin: 0 0 4px 0; font-weight: 600;">${location.name}</h3>
                <p style="margin: 0; font-size: 12px; color: #666;">${location.direccion}</p>
              </div>
            `,
          });

          marker.addListener("click", () => {
            infoWindow.open(map, marker);
          });

          markers.set(location.id, marker);
        }

        bounds.extend({ lat: location.lat, lng: location.lng });
        hasValidBounds = true;
      }
    });

    setMarkers(new Map(markers));

    // Fit map to show all markers
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
    <div className="flex h-[600px] w-full rounded-lg overflow-hidden border border-border bg-card">
      {/* Sidebar */}
      <div className="w-[300px] border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Clientes ({selectedIds.length}/{sucursales.length})
          </h3>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {locations.map((location) => {
              const sucursal = sucursales.find((s) => s.id === location.id);
              const isSelected = selectedIds.includes(location.id);

              return (
                <div
                  key={location.id}
                  className="flex items-start gap-2 p-3 rounded-md hover:bg-accent/50 transition-colors mb-1"
                >
                  <Checkbox
                    id={location.id}
                    checked={isSelected}
                    onCheckedChange={() => handleToggle(location.id)}
                    className="mt-1"
                  />
                  <label htmlFor={location.id} className="flex-1 cursor-pointer text-sm">
                    <div className="font-medium text-foreground">{location.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{location.direccion}</div>
                    {sucursal?.score && (
                      <div className="text-xs text-muted-foreground mt-1">Score: {sucursal.score}</div>
                    )}
                  </label>
                </div>
              );
            })}

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
      </div>
    </div>
  );
};

export default ResultsMap;
