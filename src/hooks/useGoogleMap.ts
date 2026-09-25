import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAP_ERROR_EVENT } from "@/lib/googleMaps";

export function useGoogleMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let instance: google.maps.Map | undefined;
    const report = (event: Event) => {
      if (active) { setError((event as CustomEvent<string>).detail); setLoading(false); }
    };
    window.addEventListener(MAP_ERROR_EVENT, report);
    loadGoogleMaps().then(() => {
      if (!active || !mapRef.current) return;
      instance = new google.maps.Map(mapRef.current, {
        center: { lat: -34.6037, lng: -58.3816 }, zoom: 12,
        mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
      });
      setMap(instance);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (active) { setError(cause instanceof Error ? cause.message : "No se pudo cargar Google Maps"); setLoading(false); }
    });
    return () => {
      active = false;
      window.removeEventListener(MAP_ERROR_EVENT, report);
      if (instance) google.maps.event.clearInstanceListeners(instance);
    };
  }, []);
  return { mapRef, map, error, loading };
}
