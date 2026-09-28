import { GEO_BA } from "./geo-buenos-aires.ts";
import { areaKey } from "./portfolio-ranking.ts";
import { coordenadaMapaValida } from "./map-selection.ts";
import type { Coordenada } from "./ruta.ts";
import type { GeocodeResult } from "./geocoding-values.ts";

export interface ZonaProspeccion {
  key: string; provincia: string; comuna: string; barrio: string; label: string;
}
export interface ZonaProspeccionResuelta extends ZonaProspeccion, Coordenada {}
export const ZONAS_PROSPECCION: ZonaProspeccion[] = Object.entries(GEO_BA).flatMap(([provincia, comunas]) =>
  Object.entries(comunas).flatMap(([comuna, barrios]) => barrios.map(barrio => ({
    key: [provincia, comuna, barrio].map(areaKey).join("|"), provincia, comuna, barrio,
    label: `${barrio} · ${provincia.startsWith("Ciudad") ? "CABA" : `${comuna}, Buenos Aires`}`,
  }))))
  .sort((a, b) => Number(b.provincia.startsWith("Ciudad")) - Number(a.provincia.startsWith("Ciudad")) || a.label.localeCompare(b.label, "es"));
const porKey = new Map(ZONAS_PROSPECCION.map(z => [z.key, z]));
export const zonaDelCatalogo = (key: unknown): ZonaProspeccion | null => typeof key === "string" ? porKey.get(key) || null : null;
const provinciaKey = (s: string) => {
  const key = areaKey(s).replace(/^PROVINCIA DE /, "");
  return ["CABA", "CAPITAL FEDERAL", "CIUDAD AUTONOMA DE BUENOS AIRES"].includes(key) ? "CABA" : key;
};
const distritoKey = (s: string) => areaKey(s).replace(/^(PARTIDO|MUNICIPIO) DE /, "");

/** Acepta un barrio/localidad de Argentina, nunca un comercio o una coincidencia parcial. */
export function centroDeZonaGoogle(r: GeocodeResult, zona: ZonaProspeccion): Coordenada | null {
  const point = r.geometry?.location;
  if (!coordenadaMapaValida(point || { lat: null, lng: null }) || r.partial_match) return null;
  const comp = (t: string) => r.address_components?.find(c => c.types.includes(t));
  if (comp("country")?.short_name !== "AR") return null;
  const provincia = comp("administrative_area_level_1");
  if (!provincia || ![provincia.long_name, provincia.short_name || ""].some(n => provinciaKey(n) === provinciaKey(zona.provincia))) return null;
  const territoriales = ["neighborhood", "sublocality", "sublocality_level_1", "locality", "administrative_area_level_3"];
  if (!r.types?.some(t => [...territoriales, "administrative_area_level_2"].includes(t))) return null;
  if (!r.address_components?.some(c => c.types.some(t => territoriales.includes(t)) && areaKey(c.long_name) === areaKey(zona.barrio))) return null;
  const distrito = comp("administrative_area_level_2");
  if (provinciaKey(zona.provincia) !== "CABA" && (!distrito || distritoKey(distrito.long_name) !== distritoKey(zona.comuna))) return null;
  return { lat: point.lat, lng: point.lng };
}

/** El barrio elegido no se amplía a otros barrios de la misma comuna. */
export function prospectoEnZona(p: { barrio?: string | null; ciudad?: string | null; provincia?: string | null }, zona: ZonaProspeccion): boolean {
  if (p.provincia?.trim() && provinciaKey(p.provincia) !== provinciaKey(zona.provincia)) return false;
  const names = provinciaKey(zona.provincia) === "CABA" ? [p.barrio] : [p.barrio, p.ciudad];
  const target = areaKey(zona.barrio);
  return names.some(n => { const key = areaKey(n); return key === target || key.startsWith(`${target} `); });
}
