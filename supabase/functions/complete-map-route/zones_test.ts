import { strictEqual as eq, deepStrictEqual as same, ok } from "node:assert/strict";
import { ZONAS_PROSPECCION, zonaDelCatalogo, centroDeZonaGoogle, prospectoEnZona } from "../_shared/map-zones.ts";
import type { GeocodeResult } from "../_shared/geocoding-values.ts";

const palermo = ZONAS_PROSPECCION.find(z => z.barrio === "Palermo")!;
const result = (): GeocodeResult => ({
  types: ["administrative_area_level_2", "political"],
  formatted_address: "Palermo, Buenos Aires, Argentina",
  geometry: { location: { lat: -34.5744943, lng: -58.4230428 }, location_type: "APPROXIMATE" },
  address_components: [
    { long_name: "Palermo", types: ["sublocality_level_1", "sublocality", "political"] },
    { long_name: "Comuna 14", types: ["administrative_area_level_2", "political"] },
    { long_name: "Ciudad Autónoma de Buenos Aires", short_name: "CABA", types: ["administrative_area_level_1", "political"] },
    { long_name: "Argentina", short_name: "AR", types: ["country", "political"] },
  ],
});
Deno.test("sin cartera: catálogo de barrios disponible sin clientes ni coordenadas propias", () => {
  eq(ZONAS_PROSPECCION.filter(z => z.provincia.startsWith("Ciudad")).length, 48);
  eq(new Set(ZONAS_PROSPECCION.map(z => z.key)).size, ZONAS_PROSPECCION.length);
  ok(ZONAS_PROSPECCION.some(z => z.barrio === "Berazategui"));
  same(zonaDelCatalogo(palermo.key), palermo); eq(zonaDelCatalogo("cualquier dirección"), null);
});
Deno.test("sin cartera: centro de Palermo acepta la respuesta territorial real de Google", () => {
  same(centroDeZonaGoogle(result(), palermo), result().geometry.location);
});
Deno.test("sin cartera: geocodificación rechaza países, barrios y provincias incorrectos, comercios y coincidencias parciales", () => {
  for (const mutate of [
    r => { r.partial_match = true; }, r => { r.types = ["establishment"]; },
    r => { r.geometry.location = { lat: 0, lng: 0 }; },
    r => { r.address_components[0].long_name = "Recoleta"; },
    r => { r.address_components[2].long_name = "Buenos Aires"; r.address_components[2].short_name = "BA"; },
    r => { r.address_components[3].short_name = "UY"; },
  ] as ((r: GeocodeResult) => void)[]) {
    const r = result(); mutate(r); eq(centroDeZonaGoogle(r, palermo), null);
  }
});
Deno.test("sin cartera: localidades bonaerenses verifican distrito además del nombre", () => {
  const zona = ZONAS_PROSPECCION.find(z => z.barrio === "Berazategui")!;
  const r = result(); r.types = ["locality", "political"];
  r.address_components[0] = { long_name: "Berazategui", types: ["locality"] };
  r.address_components[1].long_name = "Partido de Berazategui";
  r.address_components[2] = { long_name: "Provincia de Buenos Aires", types: ["administrative_area_level_1"] };
  ok(centroDeZonaGoogle(r, zona)); r.address_components[1].long_name = "Quilmes";
  eq(centroDeZonaGoogle(r, zona), null);
});
Deno.test("sin cartera: no completa Palermo con negocios de Recoleta ni con zona desconocida", () => {
  eq(prospectoEnZona({ barrio: "Palermo Soho", provincia: "CABA" }, palermo), true);
  eq(prospectoEnZona({ barrio: "Recoleta", ciudad: "Buenos Aires", provincia: "CABA" }, palermo), false);
  eq(prospectoEnZona({ ciudad: "Buenos Aires", provincia: "CABA" }, palermo), false);
  eq(prospectoEnZona({ barrio: "Palermo", provincia: "Buenos Aires" }, palermo), false);
});
