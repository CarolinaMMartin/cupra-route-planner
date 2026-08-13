import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calcularDistanciaKm, findDensestHotspot } from "./geo-hotspot.ts";

// Cartera real de Pilar: mayoría en CABA/GBA + dos outliers rurales.
const PILAR = [
  { lat: -34.7442572, lng: -60.9873013 }, // Baigorrita (rural)
  { lat: -37.2017285, lng: -59.8410697 }, // Estancia San Ramón (rural)
  { lat: -34.8182602, lng: -62.3385849 }, // Eduardo Costa (rural)
  { lat: -34.4832460, lng: -58.4951658 }, // Martínez
  { lat: -34.5801253, lng: -58.4753413 }, // Parque Chas
  { lat: -34.6083028, lng: -58.5134373 }, // Villa Devoto
  { lat: -34.5621168, lng: -58.4779244 }, // Villa Urquiza
  { lat: -34.6102285, lng: -58.5283639 }, // Villa Devoto 2
  { lat: -34.6257080, lng: -58.4188585 }, // Boedo
  { lat: -34.5903206, lng: -58.4297553 }, // Palermo
  { lat: -34.6388335, lng: -58.5849922 }, // Morón
];

Deno.test("el núcleo cae en el cluster urbano, no en un cliente rural aislado", () => {
  const hotspot = findDensestHotspot(PILAR, 2.0)!;
  assert(hotspot, "debe devolver un núcleo");
  const distCaba = calcularDistanciaKm(hotspot.lat, hotspot.lng, -34.60, -58.45);
  assert(distCaba < 15, `el núcleo quedó a ${distCaba.toFixed(1)}km de CABA`);
});

Deno.test("con todos los puntos aislados elige el más compacto (no el primero)", () => {
  const puntos = [
    { lat: -34.0, lng: -62.0 }, // aislado
    { lat: -34.60, lng: -58.45 },
    { lat: -34.66, lng: -58.50 },
    { lat: -34.70, lng: -58.55 },
  ];
  const hotspot = findDensestHotspot(puntos, 2.0)!;
  assert(calcularDistanciaKm(hotspot.lat, hotspot.lng, -34.66, -58.50) < 10);
});

Deno.test("un solo punto devuelve ese punto", () => {
  const hotspot = findDensestHotspot([{ lat: -34.6, lng: -58.4 }])!;
  assertEquals(hotspot.lat, -34.6);
});
