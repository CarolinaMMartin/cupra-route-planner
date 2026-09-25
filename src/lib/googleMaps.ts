// Clave pública de navegador para Google Maps.
// Solo claves de navegador, restringidas por dominio en Google Cloud.
export const GOOGLE_MAPS_BROWSER_KEY: string =
  import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  "";

let loaderPromise: Promise<void> | null = null;
export const MAP_ERROR_EVENT = "cupra-google-maps-error";
let authenticationError: Error | null = null;

const CALLBACK_NAME = "__cupraGoogleMapsReady";
const SCRIPT_SELECTOR = 'script[data-google-maps="true"]';
const LOAD_TIMEOUT_MS = 15_000;

function isGoogleMapsReady(): boolean {
  return typeof window !== "undefined" && typeof window.google?.maps?.Map === "function";
}

/**
 * Carga el script de Google Maps una sola vez para toda la app.
 */
export function loadGoogleMaps(apiKey: string = GOOGLE_MAPS_BROWSER_KEY): Promise<void> {
  if (authenticationError) return Promise.reject(authenticationError);
  if (isGoogleMapsReady()) return Promise.resolve();
  if (!apiKey) {
    return Promise.reject(
      new Error("No hay clave de Google Maps configurada. Contactá al administrador."),
    );
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      delete (window as unknown as Record<string, unknown>)[CALLBACK_NAME];
      if (error) {
        document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR)?.remove();
        loaderPromise = null;
        reject(error);
        return;
      }
      resolve();
    };

    const timeoutId = window.setTimeout(() => {
      finish(new Error("Google Maps demoró demasiado en responder"));
    }, LOAD_TIMEOUT_MS);

    // Google can report authentication failure after its ready callback.
    (window as unknown as Record<string, unknown>).gm_authFailure = () => {
      authenticationError = new Error("Google Maps rechazó la configuración del mapa. Contactá al administrador.");
      window.dispatchEvent(new CustomEvent(MAP_ERROR_EVENT, { detail: authenticationError.message }));
      finish(authenticationError);
    };

    (window as unknown as Record<string, unknown>)[CALLBACK_NAME] = () => {
      if (isGoogleMapsReady()) {
        finish();
      } else {
        finish(new Error("Google Maps respondió sin inicializar el mapa"));
      }
    };

    // loading=async no garantiza que la API esté lista durante script.onload.
    // El callback de Google es la única señal fiable de inicialización completa.
    const existing = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    if (existing) existing.remove();

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      language: "es",
      region: "AR",
      loading: "async",
      callback: CALLBACK_NAME,
      v: "weekly",
    });
    const trackingId = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
    if (trackingId) params.set("channel", trackingId);
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.dataset.googleMaps = "true";
    script.onerror = () => finish(new Error("No se pudo descargar Google Maps"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}
