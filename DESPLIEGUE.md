# Publicación de CUPRA

El repositorio conserva la integración con el proyecto de Lovable
`4edb6182-f643-40b4-b2af-197de983701b` y el backend de Supabase
`ofwhxaglbcgyksauwjby`. Esta actualización se publica sobre ese entorno.
Cambiar de proveedor de alojamiento es una tarea separada.

## Orden de publicación

1. Verificar en Supabase el proyecto, el esquema y las migraciones ya aplicadas.
   Confirmar una copia recuperable de los datos y registrar la versión de las funciones desplegadas.
2. Aplicar, en este orden, únicamente las tres migraciones de esta entrega:
   - `supabase/migrations/20260923120000_rubro_normalizado.sql`
   - `supabase/migrations/20260923130000_asignaciones_atomicas.sql`
   - `supabase/migrations/20260925120000_analisis_ventas.sql`
3. Desplegar las funciones modificadas listadas abajo. Confirmar sesión válida,
   roles, secretos existentes y respuesta del motor.
4. Publicar en `main` el commit validado y actualizar la publicación de Lovable.
5. Verificar la URL publicada, la carga de mapas, una generación y el guardado de
   una ruta acordada con el asignador. Registrar el identificador del despliegue.

La sincronización de GitHub no prueba que las migraciones, las funciones o el
sitio público estén actualizados. No publicar el frontend antes del backend:
usa `rubro`, `rubros_disponibles()`, `guardar_asignaciones()` y `resumen_ventas()`.

Antes de usar la CLI, revisar `supabase migration list --linked` y la salida de
`supabase db push --dry-run`. El repositorio contiene migraciones antiguas con
operaciones destructivas. No ejecutar todas las migraciones históricas para
resolver una diferencia de registro en una base existente.

## Funciones

Desplegar en el proyecto confirmado:

```bash
supabase functions deploy analyze-sales --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy generate-recommendations --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy geocode-address --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy geocode-clients --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy resolve-client-location --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy prospect-discovery --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy process-prospectos-excel --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy process-clientes-maestro --project-ref ofwhxaglbcgyksauwjby
supabase functions deploy process-ventas-excel --project-ref ofwhxaglbcgyksauwjby
```

El archivo compartido `ai-chat.ts` incorpora un tiempo máximo de espera. Otras
funciones que lo importen recibirán esa mejora al ser desplegadas posteriormente.

## Configuración

| Variable del servidor | Uso |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Places y Geocoding; usar una credencial de servidor restringida por API. |
| `GEMINI_API_KEY` | Redacción opcional. El motor funciona con textos determinísticos si falla. |
| `LOVABLE_API_KEY` | Compatibilidad con el gateway existente. Conservar durante esta publicación. |

Las claves del servidor permanecen en Supabase. La clave del navegador se
administra por separado y requiere restricciones de dominio. Esta entrega no
rota ni elimina credenciales.

## Validación reproducible

```bash
npm ci
npm run check
```

`check` verifica los tipos de la interfaz, las reglas y el recorrido del motor,
las migraciones y transacciones en PostgreSQL embebido (PGlite), y la compilación
de producción. Las pruebas usan datos sintéticos y no acceden a producción.
La validación de GitHub Actions ejecuta el mismo comando.

El lint global conserva deuda de tipado del proyecto y no forma parte de la
puerta de publicación de esta entrega; no se han desactivado reglas para ocultarla.

## Comprobación funcional

- Generar una ruta con inventario suficiente: ocho visitas por vendedor, sin cuota 5-2-1 y a no más de 1,5 km del centro.
- Elegir solo perdidos: prioriza ese estado y avisa cualquier sustitución.
- Elegir un rubro: el filtro se conserva durante las ampliaciones.
- Si no hay ocho candidatos dentro de 1,5 km, devuelve 422 con el déficit por vendedor.
  La interfaz bloquea la confirmación de rutas incompletas; nunca aumenta el radio.
- Asignar por recomendaciones, tabla, mapa y calendario; preservar visitas realizadas
  y citas de otros días. Reintentar no debe duplicar la visita.
- Verificar que la asignación manual de cartera registra la transferencia y su auditoría.
- Analizar un archivo de más de 1000 filas: filas y venta neta deben coincidir con la
  base. Verificar archivo, fechas, rubro y estados; probar indisponibilidad de IA.
- Revisar Supervisión: cada visita usa feedback de su propio intervalo temporal.

## Recuperación

Registrar el commit anterior de la aplicación y la versión anterior de cada
Edge Function antes de publicar. Ante un fallo, restaurar la versión completa
probada; no mezclar frontend nuevo con funciones o esquema antiguos.

Las nuevas columnas pueden permanecer al revertir código. La migración de
asignaciones permite historial repetido: no restaurar a ciegas índices únicos
antiguos, porque rechazarían visitas históricas legítimas. Tampoco volver a
publicar los handlers anteriores que borraban esas visitas.
