# Publicación de CUPRA

Proyecto Lovable: `4edb6182-f643-40b4-b2af-197de983701b`.
Proyecto Supabase: `ofwhxaglbcgyksauwjby`.

## Preparación

1. Confirmar el commit candidato y ejecutar `npm ci` y `npm run check`.
2. Consultar el registro de migraciones y el esquema del entorno destino.
3. Registrar la versión anterior de la aplicación y de las funciones.
4. Simular las migraciones pendientes en una transacción con `ROLLBACK`.

Las migraciones históricas incluyen operaciones destructivas. En una base
existente aplicar solo las pendientes confirmadas; no reproducir todo el
historial para resolver una diferencia del registro.

## Orden de actualización

1. Aplicar y registrar, cuando aún estén pendientes:
   - `20261001150000_seguridad_prepruebas.sql`: cuentas activas, notificaciones
     privadas, ventas restringidas y conservación del historial.
   - `20261001160000_visitas_propias_catalogo.sql`: pendientes propios,
     catálogo compartido, autoasignación y traslado auditado de pendientes.
   - `20261002123000_prospeccion_empresarial.sql`: rubros de empresas y
     profesionales; completar tipos faltantes conservando la identidad.
2. Desplegar las funciones afectadas con sus módulos `_shared`:
   `generate-recommendations`, `complete-map-route`, `review-prospect`,
   `prospect-discovery`, `walking-route`, `generate-briefing`, `extract-feedback`,
   `admin-create-user`, `check-pending-assignments` y `cleanup-visited-assignments`.
3. Publicar el commit validado en `main` y actualizar la publicación de Lovable.
4. Confirmar la versión publicada y verificar los casos funcionales.

La sincronización de GitHub no comprueba por sí sola el despliegue del backend
ni la publicación del frontend. La interfaz nueva requiere los RPC nuevos.

## Configuración de servicios

| Variable de servidor | Uso |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Places, Geocoding y Routes API para caminata. |
| `LOVABLE_API_KEY` | Gateway configurado para las integraciones existentes. |
| `GEMINI_API_KEY` | Redacción opcional de explicaciones. |

Conservar las restricciones de las credenciales y verificar disponibilidad de
la Routes API en el proyecto de Google. Si no responde, la aplicación
indica que la distancia peatonal está pendiente; no muestra una estimación falsa.
La clave de navegador es independiente de los secretos del servidor.

## Validación después de publicar

- Anónimo, token inválido y cuenta inactiva: acceso rechazado en servidor.
- Vendedor: pendientes propios; catálogo compartido; ficha ajena bloqueada.
- Autoasignación: un pendiente, un movimiento y un aviso a supervisión;
  reintentar no los duplica. Comprobar en un comercio de prueba autorizado.
- Baja de vendedor: cuenta inactiva y traslado de pendientes con fechas intactas.
- Generación: ocho paradas cercanas, prospectos de la misma calle incluidos,
  sin ampliar el radio por frecuencia ni por falta de candidatos.
- Regalos empresariales: búsqueda, dashboard, recomendaciones y mapa usan
  empresas/hoteles; agregar más de 25 resultados conserva éxitos y pendientes.
- Mapa: ocho paradas y nuevo control de radio al guardar.
- Caminata: tramos, minutos, advertencias y atribución del proveedor visibles.
- Revisar y unificar: información persistente tras recargar.
- Excel: vista previa, carga por lotes y totales conciliados con el archivo.
- Cron: limpieza de visitas desactivada; avisos pendientes con ejecución SQL.

## Recuperación

Revertir aplicación y funciones como una versión consistente. Las tablas y RPC
aditivos pueden permanecer. Mantener las restricciones de acceso y la
conservación del historial; no restaurar handlers que borren visitas ni índices
que impidan conservar visitas históricas legítimas. Corregir problemas de datos
con una migración nueva y revisable.
