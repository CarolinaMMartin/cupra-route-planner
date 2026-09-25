/** Contrato comercial compartido por el servidor y la interfaz. */
export const VISITAS_POR_DIA = 8;
export const RADIO_RUTA_KM = 1.5;
export interface Coordenada { lat: number; lng: number }

export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function errorRuta(puntos: (Coordenada & { id: string })[], centro: Coordenada | null, completa = true): string | null {
  if (completa && puntos.length !== VISITAS_POR_DIA) return `La ruta debe tener ${VISITAS_POR_DIA} visitas.`;
  if (!centro || !Number.isFinite(centro.lat) || !Number.isFinite(centro.lng)) return "Falta el centro de la ruta.";
  if (new Set(puntos.map(p => p.id)).size !== puntos.length) return "La ruta contiene destinos repetidos.";
  if (puntos.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || distanciaKm(centro, p) > RADIO_RUTA_KM)) {
    return "Hay destinos fuera del radio máximo de 1,5 km.";
  }
  return null;
}
