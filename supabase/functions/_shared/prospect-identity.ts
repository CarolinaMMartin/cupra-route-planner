import { evaluarProspectoContraCartera, normalizeFantasyName } from "./portfolio-ranking.ts";
import { distanciaKm } from "./ruta.ts";

export interface IdentityProspect {
  place_id: string; google_place_id?: string | null; nombre: string; telefono?: string | null;
  direccion?: string | null; barrio?: string | null; ciudad?: string | null; provincia?: string | null;
  latitud?: number | null; longitud?: number | null; client_id?: string | null;
  rating?: number | null; total_ratings?: number | null; tipo_principal?: string | null; tipos?: string[] | null;
  es_cliente_cupra?: boolean | null; huella?: string; informacion_encontrada?: Record<string, unknown> | null; [key: string]: unknown;
}
export interface IdentityClient {
  client_id: string; razon_social?: string | null; fantasia?: string | null; telefonos?: string[] | null;
  direccion_principal?: string | null; todas_direcciones?: string[] | null; ciudad_principal?: string | null;
  provincia_principal?: string | null; vendedor_actual?: string | null; huella: string; [key: string]: unknown;
}
export interface IdentityPlace {
  client_id: string; lat?: number | null; long?: number | null; google_maps_link?: string | null;
  direccion_principal?: string | null; [key: string]: unknown;
}
export interface IdentityDecision {
  prospecto_place_id: string; client_id: string; decision: string; prospecto_huella: string; cliente_huella: string;
}
export interface IdentityContext {
  clientes: IdentityClient[]; lugares: IdentityPlace[]; prospectos: IdentityProspect[]; decisiones: IdentityDecision[];
}
export interface IdentityMatch {
  client_id: string; nombre: string; vendedor: string | null; motivos: string[];
  nivel: "coincidencia" | "posible"; distancia_m: number | null; huella: string;
  direccion: string | null; telefonos: string[]; emails: string[];
}
const textKey = (s: unknown) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Argentine international / mobile prefixes; never match a short suffix. */
export function phoneKey(value: unknown): string {
  let s = String(value || "").replace(/\D/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("54") && s.length >= 12) s = s.slice(2);
  if (s.startsWith("9") && s.length === 11) s = s.slice(1);
  if (s.startsWith("0")) s = s.slice(1);
  if (s.startsWith("1115") && s.length === 12) s = "11" + s.slice(4);
  return s.length >= 8 && s.length <= 13 ? s : "";
}
/** Street + number only. A shared address is evidence for review, never an automatic merge. */
export function addressKey(value: unknown): string {
  const s = textKey(String(value || "").split(",")[0]).replace(/\b(AVENIDA|AVDA|AV)\b/g, "AV").replace(/\b(CALLE)\b/g, "").replace(/\s+/g, " ").trim();
  return /\d/.test(s) && /[A-Z]/.test(s) ? s : "";
}
const coord = (lat: unknown, lng: unknown): boolean => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53;
export function googlePlaceId(link: unknown): string {
  const id = String(link || "").match(/(?:[?&]query_place_id=|place_id:)([^&]+)/)?.[1];
  try { return id ? decodeURIComponent(id) : ""; } catch { return ""; }
}

export function createIdentityMatcher(context: IdentityContext) {
  const byProspect = new Map(context.prospectos.map(p => [p.place_id, p]));
  const locations = new Map<string, IdentityPlace[]>();
  context.lugares.forEach(p => locations.set(p.client_id, [...(locations.get(p.client_id) || []), p]));
  const decisions = new Map(context.decisiones.map(d => [`${d.prospecto_place_id}\n${d.client_id}`, d]));
  const refs = context.clientes.map(c => {
    const places = locations.get(c.client_id) || [];
    return { c, places, names: [...new Set([c.fantasia, c.razon_social].map(normalizeFantasyName).filter(Boolean))],
      phones: new Set((c.telefonos || []).map(phoneKey).filter(Boolean)),
      addresses: new Set([c.direccion_principal, ...(c.todas_direcciones || []), ...places.map(p => p.direccion_principal)].map(addressKey).filter(Boolean)),
      ids: new Set(places.map(p => googlePlaceId(p.google_maps_link)).filter(Boolean)) };
  });
  const remember = (rows: IdentityProspect[]) => rows.forEach(p => byProspect.set(p.place_id, p));
  const matches = (input: IdentityProspect, includeReviewed = false): IdentityMatch[] => {
    const p = { ...byProspect.get(input.place_id), ...input };
    const found = p.informacion_encontrada || {};
    const prospectNames = [p.nombre, typeof found.nombre === "string" ? found.nombre : null].map(normalizeFantasyName).filter(Boolean);
    const prospectPhones = [p.telefono, found.telefono].map(phoneKey).filter(Boolean);
    const prospectAddresses = [p.direccion, found.direccion].map(addressKey).filter(Boolean);
    const result: IdentityMatch[] = [];
    for (const { c, places, names, phones, addresses, ids } of refs) {
      const decision = decisions.get(`${p.place_id}\n${c.client_id}`);
      if (!includeReviewed && decision?.decision === "distinto" && decision.prospecto_huella === p.huella && decision.cliente_huella === c.huella) continue;
      const motivos: string[] = [];
      const sameId = ids.has(p.google_place_id || p.place_id) || p.client_id === c.client_id;
      if (sameId) motivos.push("Mismo identificador de Google o vínculo existente");
      if (prospectPhones.some(phone => phones.has(phone))) motivos.push("Mismo teléfono");
      const sameCity = !p.ciudad || !c.ciudad_principal || textKey(p.ciudad) === textKey(c.ciudad_principal) || [textKey(p.ciudad), textKey(c.ciudad_principal)].every(v => ["CABA", "BUENOS AIRES", "CAPITAL FEDERAL", "CIUDAD AUTONOMA DE BUENOS AIRES"].includes(v));
      const distances = coord(p.latitud, p.longitud) ? places.filter(x => coord(x.lat, x.long)).map(x => distanciaKm({ lat: p.latitud!, lng: p.longitud! }, { lat: x.lat!, lng: x.long! }) * 1000) : [];
      const distance = distances.length ? Math.min(...distances) : null;
      if (prospectAddresses.some(address => addresses.has(address)) && (sameCity || distance !== null && distance < 200)) motivos.push("Misma dirección");
      const sameName = prospectNames.some(pn => pn.length >= 4 && names.some(n => n === pn));
      if (sameName && (distance === null ? sameCity : distance <= 800)) motivos.push("Mismo nombre");
      else if (coord(p.latitud, p.longitud) && places.some(place => coord(place.lat, place.long) && names.some(name => evaluarProspectoContraCartera(p, [{name,lat:place.lat!,lng:place.long!}]).estado !== "nuevo"))) motivos.push("Nombre similar y ubicación cercana");
      if (motivos.length && distance !== null && distance <= 30) motivos.push("Ubicación a menos de 30 m");
      if (!motivos.length) continue;
      result.push({ client_id: c.client_id, nombre: c.fantasia || c.razon_social || c.client_id, vendedor: c.vendedor_actual || null,
        motivos, nivel: sameId ? "coincidencia" : "posible", distancia_m: distance === null ? null : Math.round(distance), huella: c.huella,
        direccion: c.direccion_principal || null, telefonos: c.telefonos || [], emails: Array.isArray(c.emails) ? c.emails as string[] : [] });
    }
    return result.sort((a, b) => Number(b.nivel === "coincidencia") - Number(a.nivel === "coincidencia") || b.motivos.length - a.motivos.length || (a.distancia_m ?? Infinity) - (b.distancia_m ?? Infinity) || a.client_id.localeCompare(b.client_id));
  };
  return { matches, remember, get: (id: string) => byProspect.get(id) };
}
