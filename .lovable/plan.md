

# Plan: Geocodificación directa sin n8n + Batch para clientes pendientes

## Contexto

El webhook de n8n es una dependencia externa innecesaria — solo hace un proxy a Google Geocoding API. Tenemos `VITE_GOOGLE_MAPS_API_KEY` disponible como secret. Podemos llamar a Google directamente.

Hay **69 clientes sin coordenadas** (37% del portfolio), muchos con dirección válida. Esto causa que el motor v9-hotzone los descarte y solo recomiende prospectos.

## Cambios propuestos

### 1. Nueva edge function: `geocode-clients` (batch)

Reemplaza el plan de n8n. Llama directamente a Google Geocoding API:

- Lee clientes sin entrada en `client_places` que tengan `direccion_principal` y `ciudad_principal`
- Para cada uno, llama a `https://maps.googleapis.com/maps/api/geocode/json?address=...&key=GOOGLE_MAPS_API_KEY`
- Extrae lat/lng, barrio (sublocality), comuna (admin_area_level_2), place_id
- Upsert en `client_places` y sincroniza barrio/comuna de vuelta a `clientes`
- Throttle: 200ms entre requests (5/seg, dentro de cuota gratuita de Google)
- Retorna resumen: OK, errores, sin dirección suficiente

### 2. Reescribir `src/services/geocodingService.ts` — llamar a Google directo

Eliminar dependencia de n8n. La función `geocodeAddress` pasa a llamar a una nueva edge function `geocode-address` (single) que hace la llamada a Google Geocoding API con el secret del server side. Esto evita exponer la API key en el frontend.

Alternativa más simple: como ya tenemos `VITE_GOOGLE_MAPS_API_KEY` en el .env (es una key de frontend/Maps JS API que ya está expuesta), podemos llamar a Google Geocoding API directo desde el frontend sin edge function intermedia.

### 3. UI en `CargaDatos.tsx` — sección "Geocodificar pendientes"

- Muestra count de clientes sin coords (query simple)
- Botón "Geocodificar X clientes pendientes"
- Llama a la edge function `geocode-clients`
- Progress bar con resultado final

### 4. Actualizar `supabase/config.toml`

Agregar `[functions.geocode-clients]` con `verify_jwt = false`.

## Archivos

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/geocode-clients/index.ts` | **Nuevo** — batch geocoding directo a Google API |
| `src/services/geocodingService.ts` | Reescribir para llamar a Google API directo (sin n8n) |
| `src/pages/CargaDatos.tsx` | Agregar sección de geocodificación masiva |

## Detalle técnico de `geocode-clients`

```text
1. Query: clientes LEFT JOIN client_places WHERE cp.id IS NULL AND direccion_principal IS NOT NULL
2. Para cada cliente:
   - address = `${direccion_principal}, ${ciudad_principal}, ${provincia_principal}, Argentina`
   - GET https://maps.googleapis.com/maps/api/geocode/json?address={encoded}&key={GOOGLE_KEY}
   - Parsear: lat, lng, barrio (sublocality_level_1), comuna (admin_area_level_2), place_id
   - Validar coordenadas en rango Argentina
   - Upsert client_places
   - Update clientes SET barrio_principal, provincia_principal si estaban vacíos
3. Throttle 200ms entre calls
4. Retorna { total, geocoded, errors, skipped }
```

## Resultado esperado

- Se eliminan las 69 "lagunas" de coordenadas
- El motor v9-hotzone puede ver el 95%+ del portfolio
- Las recomendaciones priorizan clientes reales con coordenadas reales
- No más dependencia de n8n

