import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAP_ERROR_EVENT, resetGoogleMaps } from "@/lib/googleMaps";

export function useGoogleMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const autoRetried = useRef(false);

  const retry = useCallback(() => {
    resetGoogleMaps();
    setError(null);
    setMap(null);
    setLoading(true);
    setAttempt(n => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let instance: google.maps.Map | undefined;
    const fail = (message: string) => {
      if (!active) return;
      // Un reintento automático para fallos momentáneos de Google.
      if (!autoRetried.current) { autoRetried.current = true; window.setTimeout(retry, 1500); return; }
      setError(message); setLoading(false);
    };
    const report = (event: Event) => fail((event as CustomEvent<string>).detail);
    window.addEventListener(MAP_ERROR_EVENT, report);
    loadGoogleMaps().then(() => {
      if (!active || !mapRef.current) return;
      instance = new google.maps.Map(mapRef.current, {
        center: { lat: -34.6037, lng: -58.3816 }, zoom: 12,
        mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
        clickableIcons: false,
      });
      setMap(instance);
      setLoading(false);
    }).catch((cause: unknown) => fail(cause instanceof Error ? cause.message : "No se pudo cargar Google Maps"));
    return () => {
      active = false;
      window.removeEventListener(MAP_ERROR_EVENT, report);
      if (instance) google.maps.event.clearInstanceListeners(instance);
    };
  }, [attempt, retry]);
  return { mapRef, map, error, loading, retry };
}
