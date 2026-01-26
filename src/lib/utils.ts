import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getGoogleMapsUrl(placeId: string | null | undefined): string | null {
  if (!placeId) return null;
  return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${placeId}`;
}

/**
 * Detectar si un place_id es manual (no válido para Google Places API)
 */
export function isManualPlaceId(placeId: string | null | undefined): boolean {
  return placeId?.startsWith('manual-') ?? false;
}

/**
 * Generar URL de Google Maps desde coordenadas
 */
export function getGoogleMapsUrlFromCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
