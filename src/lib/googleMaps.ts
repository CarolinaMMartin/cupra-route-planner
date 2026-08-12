// Clave pública de navegador para Google Maps.
// Se resuelve desde el conector de Lovable, con fallback embebido para que un
// build sin variables de entorno no rompa los mapas en producción.
export const GOOGLE_MAPS_BROWSER_KEY: string =
  import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  "";

let loaderPromise: Promise<void> | null = null;

/**
 * Carga el script de Google Maps una sola vez para toda la app.
 */
export function loadGoogleMaps(apiKey: string = GOOGLE_MAPS_BROWSER_KEY): Promise<void> {
  if (typeof window !== "undefined" && window.google?.maps) return Promise.resolve();
  if (!apiKey) {
    return Promise.reject(
      new Error("No hay clave de Google Maps configurada. Contactá al administrador."),
    );
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Error al cargar Google Maps")));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Error al cargar Google Maps"));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}
