
# Plan: Corregir Visualización de Clientes/Prospectos en Mapas

## Resumen del Problema
Los prospectos creados manualmente (con `place_id` que empieza con `manual-`) no aparecen en los mapas porque el código intenta consultar Google Places API con estos IDs ficticios, lo cual falla con error "INVALID_REQUEST". Sin embargo, estos prospectos **sí tienen coordenadas válidas** almacenadas en la tabla `prospectos` (columnas `latitud` y `longitud`).

## Solución Propuesta

Modificar los tres componentes de mapa para detectar prospectos manuales y usar sus coordenadas directamente en lugar de llamar a Google Places API.

---

## Paso 1: Agregar función helper para detectar place_id manual

Crear una utilidad en `src/lib/utils.ts`:

```typescript
// Detectar si un place_id es manual (no válido para Google)
export function isManualPlaceId(placeId: string | null | undefined): boolean {
  return placeId?.startsWith('manual-') ?? false;
}

// Generar URL de Google Maps desde coordenadas
export function getGoogleMapsUrlFromCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
```

---

## Paso 2: Modificar AssignorTodayAssignmentsMap.tsx

**Cambios principales:**

1. Al obtener prospectos, incluir `latitud` y `longitud` en la query a la tabla `prospectos`
2. Modificar el flujo de prospectos para:
   - Si el `place_id` es manual: usar coordenadas directas
   - Si es un place_id real de Google: usar Places API como actualmente

**Detalle de cambios:**

En `TodayAssignments.tsx`:
- Modificar la query de prospectos para incluir `latitud, longitud`
- Pasar estos datos al componente `AssignorTodayAssignmentsMap`

En `AssignorTodayAssignmentsMap.tsx`:
- Actualizar la interfaz `Assignment` para incluir coordenadas del prospecto
- Separar prospectos manuales de prospectos con place_id de Google
- Crear marcadores directamente para prospectos manuales
- Mantener la lógica actual para prospectos con place_id real

---

## Paso 3: Modificar VendedorAssignmentsMap.tsx

**Cambios principales:**

1. Recibir información de coordenadas de prospectos desde `VendedorKanban.tsx`
2. Detectar prospectos con `place_id` manual
3. Usar coordenadas directas para estos casos

**Detalle:**

- Modificar `VendedorKanban.tsx` para obtener `latitud, longitud` de prospectos
- Pasar esta info a través de `ClienteAsignado`
- En el mapa, verificar si es `manual-*` antes de llamar a Places API

---

## Paso 4: Modificar ResultsMap.tsx (menor prioridad)

Este componente ya tiene lógica para usar coordenadas directas, pero se debe verificar que funciona correctamente con prospectos manuales.

---

## Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/lib/utils.ts` | Agregar helpers `isManualPlaceId()` y `getGoogleMapsUrlFromCoords()` |
| `src/components/assignor/TodayAssignments.tsx` | Incluir `latitud, longitud` en query de prospectos |
| `src/components/assignor/AssignorTodayAssignmentsMap.tsx` | Manejar prospectos manuales con coordenadas directas |
| `src/components/vendedor/VendedorKanban.tsx` | Incluir `latitud, longitud` en `ClienteAsignado` |
| `src/components/vendedor/VendedorAssignmentsMap.tsx` | Manejar prospectos manuales con coordenadas directas |

---

## Sección Técnica

### Lógica de detección
```typescript
const isManual = placeId?.startsWith('manual-');
if (isManual && prospecto.latitud && prospecto.longitud) {
  // Crear marcador directamente con coordenadas
  const position = { lat: prospecto.latitud, lng: prospecto.longitud };
  // ... crear marker
} else if (placeId) {
  // Usar Google Places API
  await getPlaceDetails(placeId);
}
```

### Interface actualizada para prospectos en Assignment
```typescript
prospecto?: {
  nombre: string;
  telefono: string;
  direccion: string;
  barrio: string;
  latitud?: number;  // NUEVO
  longitud?: number; // NUEVO
};
```

### Link de Google Maps para prospectos manuales
En lugar de usar `getGoogleMapsUrl(placeId)` que genera un URL con `query_place_id`, usar:
```typescript
const mapsUrl = isManualPlaceId(placeId) 
  ? getGoogleMapsUrlFromCoords(prospecto.latitud, prospecto.longitud)
  : getGoogleMapsUrl(placeId);
```

---

## Resultado Esperado

- Los 4 prospectos manuales actualmente asignados aparecerán en el mapa
- Los clientes seguirán funcionando como antes (usando `client_places`)
- Los prospectos con place_id real de Google seguirán usando la API
- El botón "Abrir en Google Maps" funcionará correctamente para todos los casos
