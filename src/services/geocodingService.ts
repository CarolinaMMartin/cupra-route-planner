// Servicio de geocodificación via webhook n8n
// El webhook llama a Google Geocoding API y devuelve las coordenadas

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
}

// URL del webhook de n8n para geocodificación
const N8N_GEOCODING_WEBHOOK_URL = import.meta.env.VITE_N8N_GEOCODING_WEBHOOK_URL || "";

/**
 * Llama al webhook de n8n para geocodificar una dirección
 * El webhook internamente usa Google Geocoding API
 */
export async function geocodeAddress(request: GeocodingRequest): Promise<GeocodingResponse> {
  if (!N8N_GEOCODING_WEBHOOK_URL) {
    console.error("N8N_GEOCODING_WEBHOOK_URL no está configurada");
    return {
      status: "ERROR",
      error_code: "CONFIG_ERROR",
      message: "El servicio de geocodificación no está configurado. Contacte al administrador.",
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos timeout

    const response = await fetch(N8N_GEOCODING_WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("Error en respuesta del webhook:", response.status, response.statusText);
      return {
        status: "ERROR",
        error_code: "NETWORK_ERROR",
        message: "Error de conexión con el servicio de geocodificación. Intenta nuevamente.",
      };
    }

    const data = await response.json();
    return data as GeocodingResponse;

  } catch (error: any) {
    console.error("Error al llamar webhook de geocodificación:", error);
    
    if (error.name === 'AbortError') {
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
  // Rango aproximado de Argentina continental + Tierra del Fuego
  const LAT_MIN = -56; // Sur de Tierra del Fuego
  const LAT_MAX = -21; // Norte de Jujuy
  const LNG_MIN = -74; // Oeste de Mendoza/Neuquén
  const LNG_MAX = -53; // Este de Misiones

  return (
    lat >= LAT_MIN && lat <= LAT_MAX &&
    lng >= LNG_MIN && lng <= LNG_MAX
  );
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
