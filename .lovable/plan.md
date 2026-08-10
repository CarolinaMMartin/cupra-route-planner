# Aplicar migraciones pendientes y desplegar funciones

Verifiqué el estado actual: las tablas `import_batches`, `import_staging_rows` y `prospect_discovery_queue` **no existen todavía** en la base. Los dos archivos SQL sí están en el repo. No se modifica ningún archivo de código.

## Paso 1 — Migración de importaciones (20260807150000)
Aplicar tal cual está en el repo:
- Tabla `import_batches`: historial de cargas (tipo maestro/ventas, estado, versión del ETL, nombre y hash del archivo, filas de origen, notas de crédito, usuario, resultado y calidad).
- Tabla `import_staging_rows`: filas crudas de cada carga, con expiración a 7 días.
- Función de limpieza de staging vencido y función de commit atómico de ventas (si falla una fila, se revierte todo y el histórico anterior queda intacto).
- Acceso: solo los asignadores pueden consultar el historial y el staging; las escrituras quedan reservadas al backend.

## Paso 2 — Migración de cola de prospectos (20260810120000)
Aplicar tal cual está en el repo:
- Tabla `prospect_discovery_queue`: guarda únicamente el identificador del lugar de Google más metadatos internos (consulta, zona, estado, notas, quién lo creó).
- Corrige permisos de `prospectos`: lectura y alta manual solo para usuarios autenticados reales, acceso total solo para el backend.
- Endurece el alta de cuentas: todo usuario nuevo nace como vendedor inactivo y un asignador lo habilita.
- Restablece las restricciones de acceso sobre `profiles`.

Nota técnica: ninguno de los dos archivos incluye sentencias `GRANT` para las tablas nuevas. Como todas las lecturas de esas tablas hoy pasan por Edge Functions con rol de servicio, esto no rompe nada; si más adelante la app las consulta directamente desde el navegador, habrá que agregar los permisos en una migración aparte. No modifico los archivos existentes porque pediste aplicarlos sin cambios.

## Paso 3 — Desplegar Edge Functions
Desplegar `prospect-discovery` y, junto con ella, las funciones que tocan las tablas nuevas: `process-clientes-maestro`, `process-ventas-excel`. El resto se redespliega solo si el deploy reporta desfasaje.

## Paso 4 — Secret de Google Maps
`GOOGLE_MAPS_API_KEY` ya figura configurado en el backend, administrado por el conector de Google Maps. No hace falta crearlo ni pisarlo; lo confirmo en la verificación final. Si querés reemplazarlo por una clave propia, se hace desde Conectores.

## Paso 5 — Verificación y reporte
- Confirmar que las tres tablas y las funciones SQL nuevas existen.
- Confirmar que las políticas de `prospectos` y `profiles` quedaron como define la migración.
- Probar `prospect-discovery` (acción de listado) contra la función desplegada y revisar sus logs.
- Reportar cualquier error de migración o de deploy con el detalle exacto.
