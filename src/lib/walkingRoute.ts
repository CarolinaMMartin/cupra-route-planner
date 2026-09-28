import { distanciaKm, type Coordenada } from "../../supabase/functions/_shared/ruta";

/** Orders a short route by nearest next stop. Google resolves actual pedestrian access. */
export function walkingRouteUrl(points: Coordenada[]): string | null {
  if (points.length < 2 || points.length > 8 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return null;
  const remaining = [...points], ordered = [remaining.shift()!];
  while (remaining.length) {
    remaining.sort((a,b) => distanciaKm(ordered[ordered.length - 1],a) - distanciaKm(ordered[ordered.length - 1],b));
    ordered.push(remaining.shift()!);
  }
  const coords = (p: Coordenada) => `${p.lat},${p.lng}`;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api:"1", origin:coords(ordered[0]), destination:coords(ordered[ordered.length - 1]), travelmode:"walking", waypoints:ordered.slice(1,-1).map(coords).join("|") })}`;
}
