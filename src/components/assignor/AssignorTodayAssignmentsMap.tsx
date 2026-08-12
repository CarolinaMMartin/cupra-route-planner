import { useEffect, useRef, useState, useMemo } from "react";
import { getGoogleMapsUrl, isManualPlaceId, getGoogleMapsUrlFromCoords } from "@/lib/utils";
import { getVendorColor, createColoredMarkerIcon, resetVendorColors, getVendorColorMap } from "@/lib/vendorColors";
import { GOOGLE_MAPS_BROWSER_KEY, loadGoogleMaps } from "@/lib/googleMaps";
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
    latitud?: number;
    longitud?: number;
  };
  created_at: string;
}

interface AssignorTodayAssignmentsMapProps {
  assignments: Assignment[];
  vendedorFilter?: string;
}

const GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_BROWSER_KEY;

const loadGoogleMapsScript = (apiKey: string) => loadGoogleMaps(apiKey);

const AssignorTodayAssignmentsMap = ({ assignments, vendedorFilter }: AssignorTodayAssignmentsMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [vendorLegend, setVendorLegend] = useState<Map<string, string>>(new Map());

  // Filtrar asignaciones si hay filtro de vendedor
  const filteredAssignments = useMemo(() => {
    return vendedorFilter
      ? assignments.filter(a => a.vendedor.nombre === vendedorFilter)
      : assignments;
  }, [assignments, vendedorFilter]);

  // Validar que las coordenadas sean válidas para Argentina
  const isValidClientLatLng = (lat: number | null, lng: number | null): boolean => {
    if (lat === null || lng === null) return false;
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    
    // Rango razonable para Argentina
    // Lat: -55 (Ushuaia) a -22 (Jujuy)
    // Lng: -73 (Mendoza) a -53 (Buenos Aires costa)
    if (lat < -60 || lat > -20) return false;
    if (lng < -80 || lng > -40) return false;
    
    return true;
  };

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
    if (!map || !isMapReady) {
      console.log('[Map] Esperando condiciones:', { 
        map: !!map, 
        isMapReady
      });
      return;
    }

    // Manejo explícito de caso sin asignaciones
    if (filteredAssignments.length === 0) {
      console.log('[Map] ⚠️ No hay asignaciones para mostrar', {
        vendedorFilter,
        totalAssignments: assignments.length
      });
      
      // Limpiar marcadores anteriores
      markers.forEach((marker) => marker.setMap(null));
      setMarkers([]);
      
      // Centrar en CABA como fallback
      map.setCenter({ lat: -34.6037, lng: -58.3816 });
      map.setZoom(12);
      return;
    }

    // Flag para detectar si el effect fue limpiado
    let isCancelled = false;

    const loadMarkers = async () => {
      console.log('[Map] === INICIANDO CARGA DE MARCADORES ===');
      console.log('[Map] Estado del mapa:', { 
        mapExists: !!map, 
        isMapReady,
        filteredCount: filteredAssignments.length 
      });

      // Reset vendor colors for fresh assignment
      resetVendorColors();

      // ========================================
      // 🔄 RESET COMPLETO: NO persistir datos de render anterior
      // ========================================
      console.log('[Map] 🔄 RESET: Limpiando marcadores del mapa');
      markers.forEach((marker) => marker.setMap(null));
      setMarkers([]);

      console.log('[Map] 🔄 RESET: Inicializando estructuras internas desde cero');
      
      // Estructuras que se deben resetear completamente:
      const newMarkers: google.maps.Marker[] = [];                    // Lista de marcadores nuevos
      const bounds = new google.maps.LatLngBounds();                  // Bounds para fitBounds
      const clientPlacesMap = new Map<string, {                       // Mapa de lugares de clientes
        lat: number; 
        lng: number; 
        googleMapsLink: string | null;
      }>();
      
      // Contadores para tracking
      let clientsWithValidCoords = 0;
      let clientsWithInvalidCoords = 0;
      let clientsWithoutPlaceData = 0;
      
      // Pre-assign colors to all vendors so legend is ready
      const uniqueVendors = new Set(filteredAssignments.map(a => a.vendedor.nombre));
      uniqueVendors.forEach(v => getVendorColor(v));

      console.log('[Map] ✅ Reset completo. Iniciando construcción de marcadores...');

      // Crear PlacesService UNA SOLA VEZ
      const placesService = new google.maps.places.PlacesService(map);

      // Obtener coordenadas y links para clientes desde client_places
      const clientIds = filteredAssignments
        .filter(a => !a.es_prospecto && a.client_id)
        .map(a => a.client_id!);
      
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
            // Validar coordenadas con la función isValidClientLatLng
            if (!isValidClientLatLng(p.lat, p.long)) {
              console.warn(`[Map] Cliente con coordenadas inválidas:`, {
                client_id: p.client_id,
                lat: p.lat,
                lng: p.long,
                is_primary: p.is_primary
              });
              clientsWithInvalidCoords++;
              return; // Saltar filas con coordenadas inválidas
            }

            const existing = clientPlacesMap.get(p.client_id);
            
            // Si no hay nada para este client_id, usar esta fila
            if (!existing) {
              clientPlacesMap.set(p.client_id, {
                lat: p.lat!,
                lng: p.long!,
                googleMapsLink: p.google_maps_link,
              });
              clientsWithValidCoords++;
            } 
            // Si esta fila tiene is_primary = true, reemplazar la existente
            else if (p.is_primary === true) {
              clientPlacesMap.set(p.client_id, {
                lat: p.lat!,
                lng: p.long!,
                googleMapsLink: p.google_maps_link,
              });
            }
          });
        }

        // Contar clientes sin place data
        clientsWithoutPlaceData = clientIds.filter(id => !clientPlacesMap.has(id)).length;

        console.log('[Map] 📊 Resumen de clientes:');
        console.log(`  ✅ Con coordenadas válidas: ${clientsWithValidCoords}`);
        console.log(`  ❌ Con coordenadas inválidas: ${clientsWithInvalidCoords}`);
        console.log(`  ⚠️  Sin datos de ubicación: ${clientsWithoutPlaceData}`);
        console.log('[Map] Client places found:', clientPlacesMap.size, 'out of', clientIds.length, 'clients');

        if (clientsWithoutPlaceData > 0) {
          console.log('[Map] Clients without locations:', 
            clientIds.filter(id => !clientPlacesMap.has(id))
          );
        }
      }

      // Función para convertir getDetails en Promise (usando placesService compartido)
      const getPlaceDetails = (placeId: string): Promise<google.maps.places.PlaceResult | null> => {
        return new Promise((resolve) => {
          placesService.getDetails(
            {
              placeId: placeId,
              fields: ["geometry", "name"],
            },
            (place, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                resolve(place);
              } else {
                console.warn(`[Map] Error obteniendo detalles del place_id ${placeId}:`, status);
                resolve(null);
              }
            }
          );
        });
      };

      // Primero, crear todos los marcadores de CLIENTES (síncronos)
      console.log('[Map] Creando marcadores de clientes...');
      for (const assignment of filteredAssignments) {
        if (!assignment.es_prospecto && assignment.client_id) {
          const placeData = clientPlacesMap.get(assignment.client_id);
          
          if (placeData) {
            const position = { lat: placeData.lat, lng: placeData.lng };
            
            const vendorColor = getVendorColor(assignment.vendedor.nombre);
            const marker = new google.maps.Marker({
              position: position,
              map: map,
              title: assignment.cliente?.razon_social || 'Cliente',
              icon: createColoredMarkerIcon(vendorColor),
            });

            console.log(`[Map] ✅ Marcador CLIENTE creado:`, {
              client_id: assignment.client_id,
              razon_social: assignment.cliente?.razon_social,
              coords: position
            });

            bounds.extend(position);

            const mapsUrl = placeData.googleMapsLink || '#';
            
            const infoWindowContent = `
              <div style="padding: 8px; min-width: 200px; color: black;">
                <strong style="font-size: 14px;">
                  ${assignment.cliente?.razon_social || 'Cliente sin nombre'}
                </strong>
                <p style="font-size: 13px; margin: 4px 0; color: #666;">
                  <strong>Vendedor:</strong> ${assignment.vendedor.nombre}
                </p>
                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" 
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
          } else {
            console.warn(`[Map] ⚠️ Cliente sin client_place válido:`, {
              client_id: assignment.client_id,
              razon_social: assignment.cliente?.razon_social,
              tiene_datos: !!assignment.cliente
            });
          }
        }
      }
      
      console.log('[Map] Marcadores de clientes creados:', newMarkers.length);

      // Segundo, procesar PROSPECTOS
      console.log('[Map] Procesando prospectos...');
      const prospectoAssignments = filteredAssignments.filter(
        a => a.es_prospecto && a.prospecto_place_id
      );
      
      // Separar prospectos manuales de prospectos con place_id de Google
      const manualProspectos = prospectoAssignments.filter(a => isManualPlaceId(a.prospecto_place_id));
      const googleProspectos = prospectoAssignments.filter(a => !isManualPlaceId(a.prospecto_place_id));
      
      console.log(`[Map] Prospectos manuales: ${manualProspectos.length}, Google: ${googleProspectos.length}`);

      // Crear marcadores para prospectos MANUALES directamente (tienen lat/lng)
      for (const assignment of manualProspectos) {
        const lat = assignment.prospecto?.latitud;
        const lng = assignment.prospecto?.longitud;
        
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
          const position = { lat, lng };
          
          const vendorColorP = getVendorColor(assignment.vendedor.nombre);
          const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: assignment.prospecto?.nombre || 'Prospecto',
            icon: createColoredMarkerIcon(vendorColorP),
          });

          console.log(`[Map] ✅ Marcador PROSPECTO MANUAL creado:`, {
            place_id: assignment.prospecto_place_id,
            nombre: assignment.prospecto?.nombre,
            coords: position
          });

          bounds.extend(position);

          // Para prospectos manuales, usar URL con coordenadas
          const mapsUrl = getGoogleMapsUrlFromCoords(lat, lng);

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
              <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" 
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
        } else {
          console.warn(`[Map] ⚠️ Prospecto manual sin coordenadas válidas:`, {
            place_id: assignment.prospecto_place_id,
            nombre: assignment.prospecto?.nombre,
            lat, lng
          });
        }
      }

      // Obtener detalles de prospectos con place_id de Google
      const prospectoDetailsPromises = googleProspectos.map(assignment =>
        getPlaceDetails(assignment.prospecto_place_id!).then(place => ({
          assignment,
          place
        }))
      );

      // Esperar a que TODAS las llamadas a Places API terminen
      const prospectoResults = await Promise.all(prospectoDetailsPromises);

      // Verificar si fue cancelado después de operación asíncrona
      if (isCancelled) {
        console.log('[Map] ⚠️ Ejecución cancelada después de obtener prospectos, descartando resultados');
        return;
      }
      
      console.log('[Map] Detalles de prospectos Google obtenidos:', prospectoResults.length);

      // Crear marcadores de PROSPECTOS GOOGLE con los resultados
      prospectoResults.forEach(({ assignment, place }) => {
        if (place?.geometry?.location) {
          const vendorColorG = getVendorColor(assignment.vendedor.nombre);
          const marker = new google.maps.Marker({
            position: place.geometry.location,
            map: map,
            title: assignment.prospecto?.nombre || 'Prospecto',
            icon: createColoredMarkerIcon(vendorColorG),
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
              <a href="${getGoogleMapsUrl(assignment.prospecto_place_id!)}" target="_blank" rel="noopener noreferrer" 
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
        } else {
          console.warn(`[Map] No se pudo obtener ubicación para el prospecto ${assignment.prospecto?.nombre}`);
        }
      });

      console.log('[Map] Marcadores totales creados:', newMarkers.length);
      console.log('[Map] Todos los marcadores listos para fitBounds');

      // Verificar cancelación antes de actualizar estado
      if (isCancelled) {
        console.log('[Map] ⚠️ Ejecución cancelada antes de actualizar estado, descartando resultados');
        // Limpiar los marcadores que ya creamos
        newMarkers.forEach(marker => marker.setMap(null));
        return;
      }

      // Actualizar estado con todos los marcadores
      setMarkers(newMarkers);
      setVendorLegend(getVendorColorMap());

      // FINALMENTE: Ajustar el mapa SOLO cuando TODOS los marcadores estén listos
      if (newMarkers.length > 0) {
        const boundsPointsCount = clientsWithValidCoords + prospectoResults.filter(r => r.place?.geometry?.location).length;
        
        console.log(`[Map] 🗺️ fitBounds con ${newMarkers.length} marcadores`);
        console.log(`[Map] Bounds incluye ${boundsPointsCount} puntos válidos`);
        
        requestAnimationFrame(() => {
          if (!isCancelled) {
            console.log('[Map] Ejecutando fitBounds');
            map.fitBounds(bounds);
            if (newMarkers.length === 1) {
              map.setZoom(15);
            }
          } else {
            console.log('[Map] ⚠️ fitBounds cancelado');
          }
        });
      } else {
        console.warn('[Map] ⚠️ No hay marcadores válidos para mostrar');
        console.log('[Map] 🏙️ Aplicando fallback: Centrando en CABA');
        
        // Fallback: Centrar en CABA si no hay markers
        map.setCenter({ lat: -34.6037, lng: -58.3816 });
        map.setZoom(12);
      }
    };

    loadMarkers();

    // Cleanup function
    return () => {
      console.log('[Map] 🧹 CLEANUP: Cancelando ejecución anterior');
      isCancelled = true;
    };
  }, [map, isMapReady, filteredAssignments]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="w-full h-[70vh] max-h-[600px] relative overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Cargando mapa...</p>
          </div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
      {/* Leyenda de vendedores */}
      {vendorLegend.size > 0 && (
        <div className="absolute bottom-3 left-3 bg-background/90 backdrop-blur-sm border border-border/60 rounded-lg p-2.5 z-10 max-w-[200px]">
          <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Vendedores</p>
          <div className="space-y-1">
            {Array.from(vendorLegend.entries()).map(([name, color]) => (
              <div key={name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0 border border-border/40" style={{ backgroundColor: color }} />
                <span className="text-xs text-foreground truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default AssignorTodayAssignmentsMap;
