import { argentinaCoordinates } from "./import-values.ts";

type Component = { long_name: string; short_name?: string; types: string[] };
export interface GeocodeResult {
  geometry: { location: { lat: number; lng: number }; location_type?: string };
  address_components: Component[];
  formatted_address: string;
  place_id?: string;
  partial_match?: boolean;
  types?: string[];
}
export function preciseArgentinaResult(r: GeocodeResult, hasNumber: boolean): boolean {
  const loc = r.geometry?.location;
  const country = r.address_components?.find(c => c.types.includes("country"))?.short_name;
  if (!argentinaCoordinates(loc?.lat, loc?.lng) || country !== "AR" || r.partial_match) return false;
  if (!["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry.location_type || "")) return false;
  if (!(r.types || []).some(t => ["street_address", "premise", "subpremise", "establishment", "point_of_interest"].includes(t))) return false;
  return !hasNumber || r.address_components.some(c => c.types.includes("street_number"));
}
export function locationFields(r: GeocodeResult) {
  const comp = (type: string) => r.address_components?.find(c => c.types.includes(type))?.long_name || null;
  const admin2 = comp("administrative_area_level_2");
  const local = comp("locality");
  const neighborhood = comp("sublocality_level_1") || comp("sublocality") || comp("neighborhood");
  const barrio = neighborhood || (local && !/^(Buenos Aires|Ciudad Aut[oó]noma de Buenos Aires|CABA|Capital Federal)$/i.test(local) ? local : null);
  return {
    lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted_address: r.formatted_address,
    location_type: r.geometry.location_type, barrio, comuna: admin2?.toLowerCase().startsWith("comuna") ? admin2 : null,
    ciudad: local, provincia: comp("administrative_area_level_1"), postal_code: comp("postal_code"),
    admin_area_level_2: admin2, barrio_fallback_admin2: barrio, place_id: r.place_id || null,
  };
}
