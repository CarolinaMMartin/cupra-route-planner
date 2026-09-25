import { useEffect, useRef, useState } from "react";
import { Sucursal } from "@/types/sales";
import { useGoogleMap } from "@/hooks/useGoogleMap";
import { validMapCoordinates } from "@/lib/mapLocations";
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
import { getVendorColor, createStateMarkerIcon, resetVendorColors, getVendorColorMap, classifyClientState, getStateColor, getStateLabel, getStateLegend, calcularDistanciaKmFrontend } from "@/lib/vendorColors";

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
  rubro?: string | null;
}

interface SinUbicacionItem {
  id: string;
  nombre: string;
  direccion: string;
  client_id?: string;
  es_prospecto: boolean;
}


/** Escapa texto que viene de la base antes de meterlo en el HTML del InfoWindow. */
const escHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

const ResultsMap = ({ sucursales, selectedIds, onToggle, onToggleAll, onContinue }: ResultsMapProps) => {
  const { mapRef, map, error } = useGoogleMap();
  const corrections = useRef(new Map<string, { lat: number; lng: number; direccion: string }>());
  const [locationRevision, setLocationRevision] = useState(0);
  const [markers, setMarkers] = useState<Map<string, google.maps.Marker>>(new Map());
  const [locations, setLocations] = useState<ClientLocation[]>([]);
  const [vendorLegend, setVendorLegend] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
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
    if (validMapCoordinates(data?.lat, data?.lng)) {
      corrections.current.set(correccion.id, { lat: data.lat, lng: data.lng, direccion: direccionEditada.trim() });
      setLocationRevision(v => v + 1);
    }
    setCorreccion(null);
  };


  // Display the saved coordinates; no Google lookups or writes on map render.
  useEffect(() => {
    if (!map) return;
    resetVendorColors();
    const fetchedLocations: ClientLocation[] = [];
    for (const sucursal of sucursales) {
      const correction = corrections.current.get(sucursal.id);
      const lat = correction?.lat ?? sucursal.latitud;
      const lng = correction?.lng ?? sucursal.longitud;
      if (!validMapCoordinates(lat, lng)) continue;
      const vendedor = [sucursal.vendedor_actual, sucursal.vendedor_principal]
        .find(v => v && !/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)) || "Sin vendedor";
      if (vendedor !== "Sin vendedor") getVendorColor(vendedor);
      fetchedLocations.push({
        id: sucursal.id, name: sucursal.nombre || sucursal.fantasia || "Sin nombre",
        lat: lat!, lng: lng!, direccion: correction?.direccion || sucursal.direccion || sucursal.direccion_principal || "",
        vendedor, es_prospecto: !!sucursal.es_prospecto, rubro: sucursal.rubro,
        estado_cliente: sucursal.estado_cliente || classifyClientState(sucursal.dias_desde_ultima_compra, sucursal.es_prospecto),
      });
    }

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
  }, [sucursales, map, locationRevision]);

  // Render every resolved location; selection only changes emphasis
  useEffect(() => {
    if (!map) return;

    const nextMarkers = new Map<string, google.maps.Marker>();
    const popups: google.maps.InfoWindow[] = [];
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
          // Relleno = estado comercial (activo/inactivo/perdido/potencial); borde = vendedor.
          icon: createStateMarkerIcon(location.estado_cliente, vendorColor),
        });

        const tipoLabel = location.es_prospecto ? 'Prospecto nuevo' : 'Cliente de cartera';
        const tipoBg = location.es_prospecto ? '#8B5CF6' : '#0F766E';
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px; max-width: 260px; color: #111827; font-family: system-ui, sans-serif;">
              <h3 style="margin: 0 0 6px 0; font-weight: 600; font-size: 14px; color: #111827;">${escHtml(location.name)}</h3>
              <span style="display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #ffffff; background: ${tipoBg};">${tipoLabel}</span>
              ${location.estado_cliente ? `<span style="display:inline-block; margin-left:4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #ffffff; background: ${getStateColor(location.estado_cliente)};">${getStateLabel(location.estado_cliente)}</span>` : ''}
              ${location.rubro ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #111827;"><strong>Rubro:</strong> ${escHtml(location.rubro)}</p>` : ''}
              <p style="margin: 6px 0 0 0; font-size: 12px; color: #4B5563;">${escHtml(location.direccion)}</p>
              ${location.vendedor ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #111827;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${vendorColor};margin-right:6px;vertical-align:middle;"></span>${escHtml(location.vendedor)}</p>` : ''}
            </div>
          `,
        });


        marker.addListener("click", () => {
          infoWindow.open(map, marker!);
        });

        nextMarkers.set(location.id, marker);
        popups.push(infoWindow);
      }

      marker.setOpacity(isSelected ? 1 : 0.4);
      marker.setZIndex(isSelected ? 2 : 1);

      bounds.extend({ lat: location.lat, lng: location.lng });
      hasValidBounds = true;
    });

    setMarkers(nextMarkers);

    if (hasValidBounds) {
      map.fitBounds(bounds);
      if ((map.getZoom() || 0) > 16) map.setZoom(16);
    }
    return () => {
      popups.forEach(p => p.close());
      nextMarkers.forEach(m => { google.maps.event.clearInstanceListeners(m); m.setMap(null); });
    };
  }, [map, locations]);

  useEffect(() => {
    markers.forEach((marker, id) => {
      marker.setOpacity(selectedIds.includes(id) ? 1 : 0.4);
      marker.setZIndex(selectedIds.includes(id) ? 2 : 1);
    });
  }, [markers, selectedIds]);

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

        {/* Leyenda: relleno = estado, borde = vendedor */}
        {!loading && vendorLegend.size > 0 && (
          <div className="absolute bottom-4 left-4 bg-background/95 backdrop-blur-sm p-3 rounded-lg shadow-lg border z-10 max-h-72 overflow-y-auto">
            <p className="text-xs font-medium mb-2 text-foreground">Estado (relleno)</p>
            <div className="space-y-1 mb-3">
              {getStateLegend().map((e) => (
                <div key={e.estado} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                  <span className="text-xs text-muted-foreground">{e.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs font-medium mb-2 text-foreground">Vendedor (borde)</p>
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
