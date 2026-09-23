// Cliente único de Google Maps para todas las edge functions.
//
// Llama DIRECTO a Google con GOOGLE_MAPS_API_KEY (clave de servidor, sin
// restricción por dominio). El gateway de Lovable queda solo como respaldo
// durante la migración: si Google rechaza la clave (401/403/400 por clave inválida) y existe
// LOVABLE_API_KEY, se reintenta por el gateway. Al dar de baja Lovable basta
// con configurar GOOGLE_MAPS_API_KEY.
//
// `path` usa la misma forma que el gateway:
//   /places/v1/places:searchText        → https://places.googleapis.com/v1/places:searchText
//   /places/v1/places/{id}              → https://places.googleapis.com/v1/places/{id}
//   /maps/api/geocode/json?address=...  → https://maps.googleapis.com/maps/api/geocode/json?...&key=

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export function googleMapsKey(): string {
  return Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";
}

export function hayGoogleMaps(): boolean {
  return Boolean(googleMapsKey());
}

function directUrl(path: string, key: string): { url: string; headers: Record<string, string> } {
  if (path.startsWith("/places/")) {
    return { url: `https://places.googleapis.com${path.slice("/places".length)}`, headers: { "X-Goog-Api-Key": key } };
  }
  const sep = path.includes("?") ? "&" : "?";
  return { url: `https://maps.googleapis.com${path}${sep}key=${encodeURIComponent(key)}`, headers: {} };
}

/** 400 de Places (New) por clave inválida o vencida. */
export function esClaveInvalida(status: number, body: any): boolean {
  if (status !== 400) return false;
  const texto = JSON.stringify(body?.error || body || "");
  return /API_KEY_INVALID|API key not valid|API key expired/i.test(texto);
}

export async function googleMapsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = googleMapsKey();
  if (!key) throw new Error("Falta GOOGLE_MAPS_API_KEY en los secretos de Supabase.");
  const baseHeaders = Object.fromEntries(new Headers(init.headers).entries());
  const signal = init.signal ?? AbortSignal.timeout(12_000);

  const direct = directUrl(path, key);
  const res = await fetch(direct.url, { ...init, signal, headers: { ...baseHeaders, ...direct.headers } });

  const gatewayKey = Deno.env.get("LOVABLE_API_KEY") || "";
  let rechazada = res.status === 401 || res.status === 403;
  if (!rechazada && gatewayKey && (res.status === 400 || path.startsWith("/maps/api/"))) {
    // Places (New) rechaza una clave inválida con 400 API_KEY_INVALID; los web services
    // clásicos (Geocoding) con HTTP 200 + REQUEST_DENIED.
    const peek = await res.clone().json().catch(() => null);
    rechazada = peek?.status === "REQUEST_DENIED" || esClaveInvalida(res.status, peek);
  }
  if (rechazada && gatewayKey) {
    // Clave del conector de Lovable (no es una clave de Google válida para llamada directa).
    await res.body?.cancel();
    return fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      signal,
      headers: { ...baseHeaders, Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": key },
    });
  }
  return res;
}

// ------------------------------------------------------------
// Búsqueda de lugares cercanos (Places API New · searchNearby)
// ------------------------------------------------------------

export interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  editorialSummary?: { text?: string };
}

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.editorialSummary",
].join(",");

/**
 * Puntos de búsqueda que cubren un círculo: el centro y 6 alrededor.
 * searchNearby devuelve como máximo 20 lugares por pedido; varios círculos
 * chicos traen lugares distintos en vez de repetir siempre los mismos 20.
 */
export function circulosDeCobertura(lat: number, lng: number, radioKm: number): { lat: number; lng: number; radioM: number }[] {
  const out = [{ lat, lng, radioM: Math.round(radioKm * 1000 * 0.6) }];
  const d = radioKm * 0.55;
  const dLat = d / 111.32;
  const dLng = d / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push({ lat: lat + dLat * Math.sin(a), lng: lng + dLng * Math.cos(a), radioM: Math.round(radioKm * 1000 * 0.5) });
  }
  return out;
}

export interface NearbyOptions {
  lat: number;
  lng: number;
  radioKm: number;
  tipos: string[];
  /** Cortar cuando se juntaron tantos lugares nuevos. */
  objetivo: number;
  /** IDs a ignorar (ya conocidos). */
  excluir?: Set<string>;
  /** Presupuesto compartido de búsquedas de una generación completa. */
  consumirConsulta?: () => void;
}

export async function buscarLugaresCercanos(opts: NearbyOptions): Promise<GooglePlace[]> {
  const encontrados = new Map<string, GooglePlace>();
  const excluir = opts.excluir || new Set<string>();
  const errores: string[] = [];
  let respuestasOk = 0;

  for (const circulo of circulosDeCobertura(opts.lat, opts.lng, opts.radioKm)) {
    for (const tipo of opts.tipos) {
      if (encontrados.size >= opts.objetivo) break;
      try {
        opts.consumirConsulta?.();
      } catch (error) {
        if (encontrados.size > 0) return [...encontrados.values()];
        throw error;
      }
      const res = await googleMapsFetch("/places/v1/places:searchNearby", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-FieldMask": PLACES_FIELD_MASK },
        body: JSON.stringify({
          includedTypes: [tipo],
          maxResultCount: 20,
          rankPreference: "POPULARITY",
          languageCode: "es",
          regionCode: "AR",
          locationRestriction: {
            circle: { center: { latitude: circulo.lat, longitude: circulo.lng }, radius: circulo.radioM },
          },
        }),
      });
      const payload = await res.json().catch(() => ({})) as { places?: GooglePlace[]; error?: { message?: string } };
      if (!res.ok) {
        errores.push(`${res.status} ${payload.error?.message || ""}`.trim());
        // Clave inválida o sin cuota: no tiene sentido seguir pidiendo.
        if (res.status === 401 || res.status === 403 || res.status === 429 || esClaveInvalida(res.status, payload)) {
          throw new Error(`Google Places rechazó la búsqueda (${errores[errores.length - 1]})`);
        }
        continue;
      }
      respuestasOk++;
      for (const place of payload.places || []) {
        if (!place.id || excluir.has(place.id) || encontrados.has(place.id)) continue;
        if (place.businessStatus === "CLOSED_PERMANENTLY") continue;
        encontrados.set(place.id, place);
      }
    }
    if (encontrados.size >= opts.objetivo) break;
  }
  // Si ningún pedido funcionó no es "zona vacía": es un error que el asignador tiene que ver.
  if (respuestasOk === 0 && errores.length > 0) {
    throw new Error(`Google Places no respondió (${[...new Set(errores)].slice(0, 2).join(" | ")})`);
  }
  return [...encontrados.values()];
}
