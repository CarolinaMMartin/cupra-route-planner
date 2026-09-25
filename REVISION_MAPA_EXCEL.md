# Revisión del mapa y de la importación de Excel

Fecha: 25/09/2026. Continuación de la revisión de recomendaciones. Se conserva el límite de **1,5 km** y el objetivo de **8 visitas**.

## Mapa y Google Maps

- Los mapas de vendedor, asignaciones del día y resultados usan las coordenadas guardadas. Se eliminaron las consultas a Places Legacy y las escrituras automáticas que ocurrían al abrir el mapa.
- Un cliente con GPS válido aparece aunque no tenga un enlace de Google. Los prospectos de Google usan también su GPS registrado.
- Se muestra qué asignaciones carecen de ubicación; los puntos conservan colores por estado y muestran rubro. Los textos de los comercios se insertan sin ejecutar HTML.
- Los mapas limpian sus marcadores y ventanas al cambiar datos o desmontarse. La carga común informa errores de red, tiempo de espera y rechazo de la clave.
- La corrección de dirección requiere un asignador o administrador activo. La ficha y su ubicación se actualizan juntas. Una carga de Excel no pisa direcciones verificadas.
- La geocodificación exige Argentina, precisión de puerta y una coincidencia única sin `partial_match`. No transforma el centro de una ciudad en la ubicación de un comercio.
- Google se consulta por bloques de hasta 5 registros, con cursor, presupuesto de tiempo y posibilidad de detener el proceso. Se conservan las coordenadas al completar el barrio. No se eliminan ubicaciones ni se buscan negocios por nombre para moverlos automáticamente.

## Importación

- El lector reconoce encabezados por contenido, conserva el número de fila real, rechaza encabezados duplicados/errores de celda y admite el calendario de Excel 1904.
- La vista previa permite elegir la hoja principal y la de notas de crédito. Cuando hay varias hojas reconocidas exige confirmar la selección; informa las no reconocidas. No toma una hoja arbitraria como ventas.
- Importes argentinos y coordenadas con coma se interpretan por separado; fechas imposibles y transacciones sin comprobante, identidad inequívoca o importe se rechazan antes de guardar.
- La conciliación pagina el maestro completo. Los CUIT/nombres ambiguos no se resuelven tomando arbitrariamente el primer registro. Los domicilios conflictivos del maestro requieren revisar las sucursales.
- **Reemplazar período** conserva la guarda de confirmación si elimina más del 20 % del período. **Agregar/actualizar** conserva los comprobantes ausentes del archivo. No se ofrece borrar todo el histórico desde esta pantalla.
- Clientes, coordenadas, ventas, métricas y resultado mínimo del lote se guardan en una sola transacción. Si falla, se revierte todo. Un fallo posterior al guardado informa que los datos están aplicados.
- Cada carga tiene un UUID estable: reintentar la misma operación recupera el resultado confirmado. Una carga revertida requiere una operación nueva. Las importaciones concurrentes se serializan en PostgreSQL.
- El período se calcula por tipo de comprobante. Una nota de crédito de agosto no borra ventas de agosto al cargar ventas de septiembre; una hoja solo de ventas conserva las notas de crédito existentes.
- La reversión restaura todos los campos de las ventas, conserva el respaldo y evita deshacer un lote debajo de otro posterior del mismo período. Corrige el estado `revertido`, antes incompatible con la restricción de la tabla.
- Las métricas se recalculan con todo el histórico: fechas, importes, cantidad de órdenes y notas de crédito. También se limpian cuando deja de haber ventas; una carga antigua no retrocede artificialmente la última compra.
- Prospectos tienen identidad estable por comercio/domicilio/localidad. Reimportar completa faltantes y conserva coordenadas, conversiones y estado del negocio. La geocodificación automática se limita a los prospectos del lote.
- Los RPC internos de importación/borrado no son ejecutables por `anon` o usuarios normales. Los importadores y los antiguos endpoints de carga verifican usuario activo y rol antes de escribir.

## Verificación

- `npm run check`: tipos, regresiones del motor de recomendaciones, pruebas de asignaciones/ventas en PostgreSQL embebido, 27 pruebas nuevas de importación/geocodificación y compilación de producción.
- `npm run test:imports`: casos de filas vacías, múltiples hojas, calendario 1904, fechas inválidas, importes, lectura de más de 1.000 clientes, guardas, rollback, reintentos, modo agregar, reversión, permisos y conservación de prospectos/ubicaciones.
- Prueba de interfaz en Chromium con servicios simulados: selección de hoja, modo agregar, error y reintento con el mismo UUID, geocodificación por lote/cursor, vista móvil, cliente sin enlace de Google, prospecto con GPS y limpieza del mapa. Sin errores de ejecución.
- Validación de tipos de las 10 funciones de servidor modificadas, con las declaraciones locales del SDK de Supabase para evitar dependencias de red durante la comprobación.

Los archivos de prueba son sintéticos. No se recibió un Excel comercial real en este pedido; todavía corresponde contrastar sus encabezados y totales con la vista previa antes de una carga comercial. Las pruebas locales simulan Google. Además, una consulta real de solo lectura mediante la conexión Google Maps de Lovable devolvió HTTP 200, `OK`, Argentina y precisión `ROOFTOP` para Av. Santa Fe 1860, CABA. La clave pública de Maps JS está configurada. No se modificaron claves ni restricciones de Google Cloud.

## Despliegue

Aplicar `20260925140000_importaciones_seguras.sql` antes de desplegar los importadores y el frontend. La migración no importa ni recalcula ventas existentes: agrega estructura, funciones y permisos. Después desplegar las funciones modificadas y publicar el frontend conectado a `main`.
