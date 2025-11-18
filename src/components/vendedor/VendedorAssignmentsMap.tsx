import { useEffect, useRef, useState } from "react";
import { ClienteAsignado } from "./VendedorKanban";
import { getGoogleMapsUrl } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MapPin } from "lucide-react";

interface VendedorAssignmentsMapProps {
  assignments: Record<string, ClienteAsignado[]>;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

// Función para cargar el script de Google Maps
const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Error al cargar Google Maps'));
    document.head.appendChild(script);
  });
};

const VendedorAssignmentsMap = ({ assignments }: VendedorAssignmentsMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPorVisitar, setShowPorVisitar] = useState(true);
  const [showVisitado, setShowVisitado] = useState(true);

  // Inicializar el mapa
  useEffect(() => {
    if (!mapRef.current || map) return;

    loadGoogleMapsScript(GOOGLE_MAPS_API_KEY)
      .then(() => {
        const mapInstance = new google.maps.Map(mapRef.current!, {
          center: { lat: -34.6037, lng: -58.3816 }, // Buenos Aires
          zoom: 12,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });
        setMap(mapInstance);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading Google Maps:", err);
        setError("Error al cargar Google Maps. Verifica tu conexión.");
        setIsLoading(false);
      });
  }, [map]);

  // Actualizar marcadores cuando cambien las asignaciones o los filtros
  useEffect(() => {
    if (!map || !assignments) return;

    // Limpiar marcadores anteriores
    markers.forEach((marker) => marker.setMap(null));
    setMarkers([]);

    const newMarkers: google.maps.Marker[] = [];
    const bounds = new google.maps.LatLngBounds();
    let markersCount = 0;

    // Filtrar clientes según los checkboxes activos
    const filteredAssignments: Record<string, ClienteAsignado[]> = {};
    
    if (showPorVisitar && assignments["Por visitar"]) {
      filteredAssignments["Por visitar"] = assignments["Por visitar"];
    }
    
    if (showVisitado && assignments["Visitado"]) {
      filteredAssignments["Visitado"] = assignments["Visitado"];
    }

    // Procesar clientes filtrados
    Object.entries(filteredAssignments).forEach(([estado, clientes]) => {
      clientes.forEach((cliente) => {
        // Solo procesar si tiene place_id (para obtener ubicación)
        const placeId = cliente.prospecto_place_id || cliente.google_maps_link?.match(/place_id[:=]([^&]+)/)?.[1];
        
        if (placeId) {
          const placesService = new google.maps.places.PlacesService(map);
          
          placesService.getDetails(
            {
              placeId: placeId,
              fields: ["geometry", "name"],
            },
            (place, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                // Usar marcador default de Google Maps (sin especificar icon)
                const marker = new google.maps.Marker({
                  position: place.geometry.location,
                  map: map,
                  title: cliente.razon_social,
                });

                // InfoWindow con información del cliente
                const infoWindow = new google.maps.InfoWindow({
                  content: `
                    <div style="padding: 8px; max-width: 250px;">
                      <h3 style="margin: 0 0 8px 0; font-weight: 600; font-size: 14px; color: #000;">
                        ${cliente.razon_social}
                      </h3>
                      <div style="margin-bottom: 8px;">
                        <span style="display: inline-block; padding: 2px 8px; background: ${
                          estado === "Visitado" ? "#22c55e" : "#ef4444"
                        }; color: white; border-radius: 4px; font-size: 12px;">
                          ${estado}
                        </span>
                      </div>
                      ${cliente.ciudad_principal ? `<p style="margin: 4px 0; font-size: 13px; color: #000;">📍 ${cliente.ciudad_principal}</p>` : ""}
                      ${cliente.barrio_principal ? `<p style="margin: 4px 0; font-size: 13px; color: #000;">🏘️ ${cliente.barrio_principal}</p>` : ""}
                      ${cliente.telefonos && cliente.telefonos.length > 0 ? `<p style="margin: 4px 0; font-size: 13px; color: #000;">📞 ${cliente.telefonos[0]}</p>` : ""}
                      <button 
                        onclick="window.open('${getGoogleMapsUrl(placeId)}', '_blank')"
                        style="
                          margin-top: 8px;
                          padding: 6px 12px;
                          background: #4285f4;
                          color: white;
                          border: none;
                          border-radius: 4px;
                          cursor: pointer;
                          font-size: 13px;
                          width: 100%;
                        "
                      >
                        Abrir en Google Maps
                      </button>
                    </div>
                  `,
                });

                marker.addListener("click", () => {
                  infoWindow.open(map, marker);
                });

                newMarkers.push(marker);
                bounds.extend(place.geometry.location);
                markersCount++;

                // Ajustar bounds cuando se hayan cargado todos los marcadores
                if (markersCount > 0) {
                  map.fitBounds(bounds);
                  // Evitar zoom excesivo si solo hay un marcador
                  const listener = google.maps.event.addListener(map, "idle", () => {
                    if (map.getZoom()! > 16) map.setZoom(16);
                    google.maps.event.removeListener(listener);
                  });
                }
              }
            }
          );
        }
      });
    });

    setMarkers(newMarkers);
  }, [map, assignments, showPorVisitar, showVisitado]);

  if (error) {
    return (
      <Alert variant="destructive">
        <MapPin className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="w-full h-[calc(100vh-12rem)]">
      <div className="relative w-full h-full">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="text-center">
              <MapPin className="h-8 w-8 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Cargando mapa...</p>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full rounded-lg" />
        
        {/* Filtros con checkboxes */}
        <div className="absolute bottom-4 left-4 bg-background/95 backdrop-blur-sm p-4 rounded-lg shadow-lg border z-10">
          <p className="text-sm font-medium mb-3">Filtrar clientes</p>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="por_visitar" 
                checked={showPorVisitar}
                onCheckedChange={(checked) => setShowPorVisitar(checked as boolean)}
              />
              <Label htmlFor="por_visitar" className="text-sm cursor-pointer">Por visitar</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="visitado" 
                checked={showVisitado}
                onCheckedChange={(checked) => setShowVisitado(checked as boolean)}
              />
              <Label htmlFor="visitado" className="text-sm cursor-pointer">Visitados</Label>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default VendedorAssignmentsMap;
