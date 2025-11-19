import { useEffect, useRef, useState, useMemo } from "react";
import { getGoogleMapsUrl } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Assignment {
  id: string;
  es_prospecto: boolean;
  client_id?: string;
  prospecto_place_id?: string;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente?: {
    razon_social: string;
    cuit_dni: string;
  };
  prospecto?: {
    nombre: string;
    telefono: string;
    direccion: string;
    barrio: string;
  };
  created_at: string;
}

interface AssignorTodayAssignmentsMapProps {
  assignments: Assignment[];
  vendedorFilter?: string;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

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

const AssignorTodayAssignmentsMap = ({ assignments, vendedorFilter }: AssignorTodayAssignmentsMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);

  // Filtrar asignaciones si hay filtro de vendedor
  const filteredAssignments = useMemo(() => {
    return vendedorFilter
      ? assignments.filter(a => a.vendedor.nombre === vendedorFilter)
      : assignments;
  }, [assignments, vendedorFilter]);

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

        // Esperar a que el mapa termine de cargar completamente
        google.maps.event.addListenerOnce(mapInstance, 'idle', () => {
          console.log('[Map] Google Maps completamente cargado');
          setIsMapReady(true);
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

  // Actualizar marcadores cuando cambien las asignaciones
  useEffect(() => {
    if (!map || !isMapReady || filteredAssignments.length === 0) {
      console.log('[Map] Esperando condiciones:', { 
        map: !!map, 
        isMapReady, 
        assignments: filteredAssignments.length 
      });
      return;
    }

    const loadMarkers = async () => {
      console.log('[Map] === INICIANDO CARGA DE MARCADORES ===');
      console.log('[Map] Estado del mapa:', { 
        mapExists: !!map, 
        isMapReady,
        filteredCount: filteredAssignments.length 
      });

      // Limpiar marcadores anteriores
      markers.forEach((marker) => marker.setMap(null));
      setMarkers([]);

      const newMarkers: google.maps.Marker[] = [];
      const bounds = new google.maps.LatLngBounds();

      // Obtener coordenadas y links para clientes desde client_places
      const clientIds = filteredAssignments
        .filter(a => !a.es_prospecto && a.client_id)
        .map(a => a.client_id!);

      let clientPlacesMap = new Map<string, { lat: number; lng: number; googleMapsLink: string | null }>();
      
      console.log('[Map] Total assignments:', filteredAssignments.length);
      console.log('[Map] Client IDs to fetch:', clientIds.length, clientIds);
      
      if (clientIds.length > 0) {
        const { data: placesData } = await supabase
          .from('client_places')
          .select('client_id, lat, long, google_maps_link, is_primary')
          .in('client_id', clientIds);

        if (placesData) {
          // Agrupar por client_id y priorizar is_primary = true
          placesData.forEach(p => {
            // Validar que tenga coordenadas válidas
            if (p.lat == null || p.long == null) {
              return; // Saltar filas sin coordenadas
            }

            const existing = clientPlacesMap.get(p.client_id);
            
            // Si no hay nada para este client_id, usar esta fila
            if (!existing) {
              clientPlacesMap.set(p.client_id, {
                lat: p.lat,
                lng: p.long,
                googleMapsLink: p.google_maps_link,
              });
            } 
            // Si esta fila tiene is_primary = true, reemplazar la existente
            else if (p.is_primary === true) {
              clientPlacesMap.set(p.client_id, {
                lat: p.lat,
                lng: p.long,
                googleMapsLink: p.google_maps_link,
              });
            }
            // Si la fila existente no es primary y esta tampoco, mantener la primera
          });
        }
        
        console.log('[Map] Client places found:', clientPlacesMap.size, 'out of', clientIds.length, 'clients');
        console.log('[Map] Clients without locations:', 
          clientIds.filter(id => !clientPlacesMap.has(id))
        );
      }

      // Crear marcadores para cada asignación usando Places API solo para prospectos
      const placesService = new google.maps.places.PlacesService(map);

      for (const assignment of filteredAssignments) {
        if (assignment.es_prospecto && assignment.prospecto_place_id) {
          // Para prospectos, usar Places API
          placesService.getDetails(
            {
              placeId: assignment.prospecto_place_id,
              fields: ["geometry", "name"],
            },
            (place, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                const marker = new google.maps.Marker({
                  position: place.geometry.location,
                  map: map,
                  title: assignment.prospecto?.nombre || 'Prospecto',
                });

                bounds.extend(place.geometry.location);

                const infoWindowContent = `
                  <div style="padding: 8px; min-width: 200px; color: black;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                      <strong style="font-size: 14px;">
                        ${assignment.prospecto?.nombre || 'Prospecto sin nombre'}
                      </strong>
                      <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">NUEVO</span>
                    </div>
                    <p style="font-size: 13px; margin: 4px 0; color: #666;">
                      <strong>Vendedor:</strong> ${assignment.vendedor.nombre}
                    </p>
                    <a href="${getGoogleMapsUrl(assignment.prospecto_place_id)}" target="_blank" rel="noopener noreferrer" 
                       style="display: inline-block; margin-top: 8px; padding: 6px 12px; 
                              background-color: #1a73e8; color: white; text-decoration: none; 
                              border-radius: 4px; font-size: 12px; font-weight: 500;">
                      Abrir en Google Maps
                    </a>
                  </div>
                `;

                const infoWindow = new google.maps.InfoWindow({
                  content: infoWindowContent,
                });

                marker.addListener("click", () => {
                  infoWindow.open(map, marker);
                });

                newMarkers.push(marker);
              }
            }
          );
        } else if (!assignment.es_prospecto && assignment.client_id) {
          // Para clientes, usar coordenadas directas de client_places
          const clientPlace = clientPlacesMap.get(assignment.client_id);
          
          if (clientPlace) {
            const position = { lat: clientPlace.lat, lng: clientPlace.lng };
            
            const marker = new google.maps.Marker({
              position: position,
              map: map,
              title: assignment.cliente?.razon_social || 'Cliente',
            });

            bounds.extend(position);

            const infoWindowContent = `
              <div style="padding: 8px; min-width: 200px; color: black;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                  <strong style="font-size: 14px;">
                    ${assignment.cliente?.razon_social || 'Cliente desconocido'}
                  </strong>
                </div>
                <p style="font-size: 13px; margin: 4px 0; color: #666;">
                  <strong>Vendedor:</strong> ${assignment.vendedor.nombre}
                </p>
                ${clientPlace.googleMapsLink 
                  ? `<a href="${clientPlace.googleMapsLink}" target="_blank" rel="noopener noreferrer" 
                       style="display: inline-block; margin-top: 8px; padding: 6px 12px; 
                              background-color: #1a73e8; color: white; text-decoration: none; 
                              border-radius: 4px; font-size: 12px; font-weight: 500;">
                      Abrir en Google Maps
                    </a>`
                  : ''
                }
              </div>
            `;

            const infoWindow = new google.maps.InfoWindow({
              content: infoWindowContent,
            });

            marker.addListener("click", () => {
              infoWindow.open(map, marker);
            });

            newMarkers.push(marker);
          }
        }
      }

      setMarkers(newMarkers);

      // Ajustar el mapa para mostrar todos los marcadores
      if (newMarkers.length > 0) {
        requestAnimationFrame(() => {
          map.fitBounds(bounds);
          if (newMarkers.length === 1) {
            map.setZoom(15);
          }
        });
      }
    };

    loadMarkers();
  }, [map, isMapReady, filteredAssignments]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="relative h-[600px] w-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <p className="text-muted-foreground">Cargando mapa...</p>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full rounded-lg" />
    </div>
  );
};

export default AssignorTodayAssignmentsMap;
