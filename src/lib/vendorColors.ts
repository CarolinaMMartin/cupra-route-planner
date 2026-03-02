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
