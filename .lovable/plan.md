

# Plan: Botón "Detener" para cancelar la generación de recomendaciones IA

## Problema
Cuando se lanza "Generar Recomendaciones", no hay forma de cancelar la petición si el usuario se equivocó en los filtros. El botón queda en "Analizando..." sin opción de parar.

## Solución

Usar un `AbortController` para cancelar la llamada a la Edge Function, y mostrar un botón "Detener" rojo mientras está cargando.

### Cambios

**1. `src/components/AssignorDashboard.tsx`**
- Crear un `useRef<AbortController>` para almacenar el controller activo.
- En `handleRequestRecommendations`, crear un nuevo `AbortController` y pasarlo a `supabase.functions.invoke` (via `fetch` directo, ya que `invoke` no soporta `signal` nativamente — o usar el workaround con `fetch` manual al URL de la función).
- Crear función `handleCancelRecommendations` que llama `abortController.current.abort()` y hace `setIsLoading(false)`.
- Pasar `onCancel` como prop al `FilterPanel`.

**2. `src/components/assignor/FilterPanel.tsx`**
- Agregar prop `onCancel?: () => void`.
- En ambos botones (modo "area" y modo "custom"), cuando `isLoading` es true, mostrar un botón "Detener" con ícono de stop al lado (o reemplazar el botón de "Analizando..." por uno rojo que diga "Detener").

### Detalle técnico: AbortController con Supabase
`supabase.functions.invoke` no acepta `signal` directamente. Usaremos `fetch` manual al endpoint de la función con el `AbortSignal` para poder cancelar la petición HTTP en vuelo.

