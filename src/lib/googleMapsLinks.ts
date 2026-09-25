/** IDs imported from Excel or entered manually are internal, not Google Place IDs. */
export function isManualPlaceId(placeId: string | null | undefined): boolean {
  return /^(manual[-_]|excel-)/i.test(placeId || "");
}

export function getGoogleMapsUrl(placeId?: string | null, lat?: number | null, lng?: number | null, address?: string): string | null {
  const params = new URLSearchParams({ api: "1" });
  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53) {
    params.set("query", `${lat},${lng}`);
  } else if (placeId && !isManualPlaceId(placeId)) {
    params.set("query", "Google"); params.set("query_place_id", placeId);
  } else if (address?.trim()) {
    params.set("query", address.trim());
  } else return null;
  return `https://www.google.com/maps/search/?${params}`;
}

export function getGoogleMapsUrlFromCoords(lat: number, lng: number): string {
  return getGoogleMapsUrl(null, lat, lng) || "https://www.google.com/maps";
}
