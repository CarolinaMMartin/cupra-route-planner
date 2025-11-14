import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getGoogleMapsUrl(placeId: string | null | undefined): string | null {
  if (!placeId) return null;
  return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${placeId}`;
}
