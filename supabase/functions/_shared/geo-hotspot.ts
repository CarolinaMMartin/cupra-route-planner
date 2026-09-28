export interface AnchorPoint {
  lat: number;
  lng: number;
}

export function calcularDistanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateCentroid(points: AnchorPoint[]): AnchorPoint | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

/**
 * Núcleo operativo del vendedor: el punto con más vecinos dentro de `clusterRadius`.
 * Desempate por COMPACIDAD (suma de distancias a los K vecinos más cercanos), para que
 * un cliente aislado a cientos de km nunca se convierta en el núcleo de la ruta.
 */
export function findDensestHotspot(
  points: AnchorPoint[],
  clusterRadius: number = 2.0,
): AnchorPoint | null {
  if (points.length === 0) return null;
  if (points.length <= 2) return calculateCentroid(points);

  const K = Math.min(4, points.length - 1);
  let bestPoint: AnchorPoint | null = null;
  let bestCount = -1;
  let bestCompactness = Number.POSITIVE_INFINITY;
  let bestNeighbors: AnchorPoint[] = [];

  for (const p of points) {
    const distances = points
      .filter((q) => q !== p)
      .map((q) => calcularDistanciaKm(p.lat, p.lng, q.lat, q.lng))
      .sort((a, b) => a - b);
    const compactness = distances.slice(0, K).reduce((s, d) => s + d, 0);
    const neighbors = points.filter((q) =>
      calcularDistanciaKm(p.lat, p.lng, q.lat, q.lng) <= clusterRadius
    );
    const isBetter = neighbors.length > bestCount ||
      (neighbors.length === bestCount && compactness < bestCompactness);
    if (isBetter) {
      bestCount = neighbors.length;
      bestCompactness = compactness;
      bestPoint = p;
      bestNeighbors = neighbors;
    }
  }

  return bestNeighbors.length > 0 ? calculateCentroid(bestNeighbors) : bestPoint;
}
