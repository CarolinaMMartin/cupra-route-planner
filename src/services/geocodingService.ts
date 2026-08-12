// Servicio de geocodificación directo vía Google Geocoding API.
// La clave usada en el navegador debe estar restringida por dominio y por API
// desde Google Cloud Console.

import { GOOGLE_MAPS_BROWSER_KEY, loadGoogleMaps } from "@/lib/googleMaps";

export interface GeocodingRequest {
  direccion: string;
  barrio?: string;
  ciudad: string;
  provincia: string;
  pais: string; // Siempre "Argentina"
}

export interface GeocodingResponse {
  status: "OK" | "ERROR";
  lat?: number;
  lng?: number;
  formatted_address?: string;
  location_type?: string;
  error_code?: string;
  message?: string;
  barrio?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  postal_code?: string | null;
  admin_area_level_2?: string | null;
  barrio_fallback_admin2?: string | null;
  place_id?: string;
}

const GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_BROWSER_KEY;

function extractComponent(components: any[], type: string): string | null {
  const c = components.find((comp: any) => comp.types?.includes(type));
  return c?.long_name || null;
}

/**
 * Geocodifica una dirección usando el SDK de Google Maps.
 * (La clave de navegador está restringida por dominio y no puede usarse
 * contra la API REST de Geocoding.)
 */
export async function geocodeAddress(request: GeocodingRequest): Promise<GeocodingResponse> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("No hay clave de Google Maps configurada");
    return {
      status: "ERROR",
      error_code: "CONFIG_ERROR",
      message: "El servicio de geocodificación no está configurado. Contacte al administrador.",
    };
  }

  const parts = [request.direccion, request.barrio, request.ciudad, request.provincia, request.pais].filter(Boolean);
  const fullAddress = parts.join(", ");

  try {
    await loadGoogleMaps();

    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({
      address: fullAddress,
      region: "ar",
    });

    if (!results?.length) {
      return {
        status: "ERROR",
        error_code: "NO_RESULTS",
        message: "No se encontraron resultados para esa dirección.",
      };
    }

    const result = results[0];
    const lat = result.geometry.location.lat();
    const lng = result.geometry.location.lng();
    const components: any[] = result.address_components || [];

    const barrio =
      extractComponent(components, "sublocality_level_1") ||
      extractComponent(components, "sublocality") ||
      extractComponent(components, "neighborhood");
    const adminArea2 = extractComponent(components, "administrative_area_level_2");
    const ciudad = extractComponent(components, "locality");
    const provincia = extractComponent(components, "administrative_area_level_1");
    const postalCode = extractComponent(components, "postal_code");

    return {
      status: "OK",
      lat,
      lng,
      formatted_address: result.formatted_address,
      location_type: String(result.geometry.location_type),
      barrio,
      comuna: adminArea2?.toLowerCase().startsWith("comuna") ? adminArea2 : null,
      ciudad,
      provincia,
      postal_code: postalCode,
      admin_area_level_2: adminArea2,
      barrio_fallback_admin2: barrio || adminArea2,
      place_id: result.place_id,
    };
  } catch (error: any) {
    console.error("Error al llamar Google Geocoding API:", error);

    if (error.name === "AbortError") {
      return {
        status: "ERROR",
        error_code: "TIMEOUT",
        message: "El servicio tardó demasiado en responder. Intenta nuevamente.",
      };
    }

    return {
      status: "ERROR",
      error_code: "NETWORK_ERROR",
      message: "Error de conexión. Verifica tu conexión a internet e intenta nuevamente.",
    };
  }
}

/**
 * Valida que las coordenadas estén dentro del rango de Argentina
 */
export function isValidArgentinaCoordinate(lat: number, lng: number): boolean {
  const LAT_MIN = -56;
  const LAT_MAX = -21;
  const LNG_MIN = -74;
  const LNG_MAX = -53;
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
}

/**
 * Genera un place_id único para prospectos manuales
 */
export function generateManualPlaceId(): string {
  return `manual-${crypto.randomUUID()}`;
}

/**
 * Lista de provincias argentinas para el selector
 */
export const PROVINCIAS_ARGENTINA = [
  "Buenos Aires",
  "Ciudad Autónoma de Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];
