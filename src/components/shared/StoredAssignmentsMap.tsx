import { useEffect, useState, type ReactNode } from "react";
import { useGoogleMap } from "@/hooks/useGoogleMap";
import { loadClientLocations, mapPopup, validMapCoordinates } from "@/lib/mapLocations";
import { classifyClientState, createStateMarkerIcon, getStateLabel, getStateLegend, getVendorColor } from "@/lib/vendorColors";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface MapAssignment {
  id: string;
  clientId?: string;
  prospect: boolean;
  name: string;
  lat?: number;
  lng?: number;
  days?: number;
  address?: string;
  rubro?: string | null;
  vendor?: string;
  details?: string[];
}

export default function StoredAssignmentsMap({ items, filters }: { items: MapAssignment[]; filters?: ReactNode }) {
  const { mapRef, map, error, loading } = useGoogleMap();
  const [dataError, setDataError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  useEffect(() => {
    if (!map) return;
    let active = true;
    const markers: google.maps.Marker[] = [];
    const popup = new google.maps.InfoWindow();
    let zoomListener: google.maps.MapsEventListener | undefined;
    setDataError(null);
    setMissing([]);
    setLoadingLocations(true);
    loadClientLocations(items.filter(i => !i.prospect).map(i => i.clientId || "")).then(locations => {
      if (!active) return;
      const bounds = new google.maps.LatLngBounds();
      const unresolved: string[] = [];
      for (const item of items) {
        const saved = item.clientId ? locations.get(item.clientId) : undefined;
        const lat = item.prospect ? item.lat : saved?.lat;
        const lng = item.prospect ? item.lng : saved?.lng;
        if (!validMapCoordinates(lat, lng)) { unresolved.push(item.name); continue; }
        const position = { lat: lat!, lng: lng! };
        const state = classifyClientState(item.days ?? saved?.days, item.prospect);
        const rubro = item.rubro || saved?.rubro;
        const marker = new google.maps.Marker({
          map, position, title: item.name,
          icon: createStateMarkerIcon(state, item.vendor ? getVendorColor(item.vendor) : undefined),
        });
        marker.addListener("click", () => {
          popup.setContent(mapPopup(item.name, [
            `${item.prospect ? "Prospecto" : "Cliente"} · ${getStateLabel(state)}`,
            item.vendor ? `Vendedor: ${item.vendor}` : "",
            rubro ? `Rubro: ${rubro}` : "",
            item.address || saved?.address || "", ...(item.details || []),
          ], position));
          popup.open(map, marker);
        });
        markers.push(marker);
        bounds.extend(position);
      }
      setMissing(unresolved);
      if (markers.length) {
        map.fitBounds(bounds);
        zoomListener = google.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom() || 0) > 16) map.setZoom(16);
        });
      }
    }).catch((cause: unknown) => {
      if (active) setDataError(cause instanceof Error ? cause.message : "No se pudieron cargar las ubicaciones");
    }).finally(() => { if (active) setLoadingLocations(false); });
    return () => {
      active = false;
      popup.close();
      zoomListener?.remove();
      for (const marker of markers) { google.maps.event.clearInstanceListeners(marker); marker.setMap(null); }
    };
  }, [map, items]);

  return <div className="space-y-3">
    {(error || dataError) && <Alert variant="destructive"><AlertDescription>{error || dataError}</AlertDescription></Alert>}
    {missing.length > 0 && <Alert><AlertDescription>
      {missing.length} asignaciones sin coordenadas válidas: {missing.slice(0, 5).join(", ")}{missing.length > 5 ? "…" : ""}. Revisá sus direcciones en Carga de datos.
    </AlertDescription></Alert>}
    <Card className="relative w-full h-[600px] overflow-hidden">
      <div ref={mapRef} className="h-full w-full" />
      {(loading || loadingLocations) && !error && <div className="absolute top-3 left-3 bg-background/95 rounded p-3 text-sm">Cargando mapa y ubicaciones…</div>}
      <div className="absolute bottom-4 left-4 bg-background/95 p-3 rounded-lg border shadow max-w-[90%]">
        {filters}
        {items.some(i => i.vendor) && <div className="flex gap-3 flex-wrap mb-2">{[...new Set(items.map(i => i.vendor).filter(Boolean))].map(v =>
          <span key={v} className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: getVendorColor(v!) }} />{v}</span>)}</div>}
        <p className="text-xs font-medium mb-2">Estado comercial</p>
        <div className="flex gap-3 flex-wrap">{getStateLegend().map(({ estado, color, label }) =>
          <span key={estado} className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>)}</div>
      </div>
    </Card>
  </div>;
}
