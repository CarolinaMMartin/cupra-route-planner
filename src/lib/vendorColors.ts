import { ESTADOS, colorEstado, labelEstado, estadoPorDias, type EstadoComercial } from "@/lib/segmentos";

/**
 * Paleta de colores para diferenciar vendedores en mapas.
 * Cada color tiene buen contraste sobre mapas claros.
 */
const VENDOR_COLORS = [
  '#E53935', // rojo
  '#1E88E5', // azul
  '#43A047', // verde
  '#FB8C00', // naranja
  '#8E24AA', // violeta
  '#00ACC1', // cyan
  '#F4511E', // rojo-naranja
  '#3949AB', // indigo
  '#C0CA33', // lima
  '#D81B60', // rosa
  '#00897B', // teal
  '#6D4C41', // marrón
];

const vendorColorMap = new Map<string, string>();

/**
 * Devuelve un color consistente para un vendedor.
 * La misma persona siempre obtiene el mismo color en la sesión.
 */
export function getVendorColor(vendorName: string): string {
  if (vendorColorMap.has(vendorName)) {
    return vendorColorMap.get(vendorName)!;
  }
  const index = vendorColorMap.size % VENDOR_COLORS.length;
  vendorColorMap.set(vendorName, VENDOR_COLORS[index]);
  return VENDOR_COLORS[index];
}

/**
 * Resetea la asignación de colores (útil al cambiar de dataset).
 */
export function resetVendorColors(): void {
  vendorColorMap.clear();
}

/**
 * Devuelve el mapa actual de vendedor -> color.
 */
export function getVendorColorMap(): Map<string, string> {
  return new Map(vendorColorMap);
}

// ============================================================
// ESTADO COMERCIAL — una sola fuente de verdad en src/lib/segmentos.ts
// ============================================================

/** Color asociado a un estado comercial. */
export function getStateColor(estado: string | undefined | null): string {
  return colorEstado(estado);
}

/** Label legible para un estado comercial. */
export function getStateLabel(estado: string | undefined | null): string {
  return labelEstado(estado);
}

/** Estados y colores para leyendas. */
export function getStateLegend(): Array<{ estado: string; color: string; label: string }> {
  return ESTADOS.map((e) => ({ estado: e.value, color: e.color, label: e.label }));
}

/**
 * Estado comercial por días sin comprar. Sin compras registradas = POTENCIAL
 * (mismo criterio que el motor de recomendaciones).
 */
export function classifyClientState(
  diasDesdeUltimaCompra: number | null | undefined,
  esProspecto: boolean | undefined,
): EstadoComercial {
  if (esProspecto) return 'POTENCIAL';
  return estadoPorDias(diasDesdeUltimaCompra ?? null);
}

/**
 * Genera un SVG de marcador circular con el color dado.
 * Retorna un data URL usable como icono de Google Maps.
 */
export function createColoredMarkerIcon(color: string, scale: number = 1): google.maps.Icon {
  const size = Math.round(28 * scale);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="12" fill="${color}" stroke="white" stroke-width="2.5"/>
      <circle cx="14" cy="14" r="4" fill="white"/>
    </svg>
  `;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

/**
 * Genera un marcador SVG con relleno = color del estado y borde = color del vendedor.
 * - fill: color del estado comercial (semáforo: verde/amarillo/rojo/azul)
 * - stroke: color del vendedor (de la paleta de 12 colores)
 * - Punto blanco central para visibilidad
 */
export function createStateMarkerIcon(
  estado: string | undefined | null,
  vendorColor?: string,
  scale: number = 1,
): google.maps.Icon {
  const size = Math.round(30 * scale);
  const fillColor = getStateColor(estado);
  const strokeColor = vendorColor || '#ffffff';
  const strokeWidth = vendorColor ? 3.5 : 2.5;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="12" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
      <circle cx="15" cy="15" r="3.5" fill="white" opacity="0.9"/>
    </svg>
  `;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

/**
 * Calcula la distancia en km entre dos puntos (Haversine).
 */
export function calcularDistanciaKmFrontend(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
