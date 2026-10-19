import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAP_ERROR_EVENT, resetGoogleMaps } from "@/lib/googleMaps";

const MAP_OPTIONS = {
  center: { lat: -34.6037, lng: -58.3816 }, zoom: 12,
  mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
  clickableIcons: false,
};

/**
 * Crea el mapa con Google Maps. Si Google lo rechaza o no responde, cambia
 * automáticamente a un mapa de respaldo con las mismas funciones, para que
 * nunca se bloquee la asignación desde el mapa.
 */
export function useGoogleMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    resetGoogleMaps();
    setError(null);
    setFallbackReason(null);
    setMap(null);
    setLoading(true);
    setAttempt(n => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let instance: google.maps.Map | undefined;
    let switching = false;

    const switchToFallback = async (reason: string) => {
      if (!active || switching) return;
      switching = true;
      console.warn("Google Maps no disponible, se usa el mapa de respaldo:", reason);
      try {
        const { installMapFallback } = await import("@/lib/mapFallback");
        installMapFallback();
        if (!active || !mapRef.current) return;
        if (instance) { try { google.maps.event.clearInstanceListeners(instance); } catch { /* sin efecto */ } }
        instance = new google.maps.Map(mapRef.current, MAP_OPTIONS);
        setMap(instance);
        setFallbackReason(reason);
        setError(null);
      } catch (cause) {
        console.error("Mapa de respaldo falló:", cause);
        if (active) setError(reason);
      } finally {
        if (active) setLoading(false);
      }
    };

    const report = (event: Event) => { void switchToFallback((event as CustomEvent<string>).detail); };
    window.addEventListener(MAP_ERROR_EVENT, report);
    loadGoogleMaps().then(() => {
      if (!active || !mapRef.current || switching) return;
      instance = new google.maps.Map(mapRef.current, MAP_OPTIONS);
      setMap(instance);
      setLoading(false);
    }).catch((cause: unknown) => {
      void switchToFallback(cause instanceof Error ? cause.message : "No se pudo cargar Google Maps");
    });
    return () => {
      active = false;
      window.removeEventListener(MAP_ERROR_EVENT, report);
      if (instance) { try { google.maps.event.clearInstanceListeners(instance); } catch { /* sin efecto */ } }
    };
  }, [attempt]);

  return { mapRef, map, error, loading, retry, fallbackReason };
}
