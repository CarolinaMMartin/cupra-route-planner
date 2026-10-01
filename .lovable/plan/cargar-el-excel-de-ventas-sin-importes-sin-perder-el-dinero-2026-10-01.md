# Cargar el Excel de ventas sin importes, sin perder el dinero que ya está cargado

## Situación (verificada)

- Archivo: 10.975 líneas, de feb-2025 a sep-2026, 485 clientes, 2.331 comprobantes (36 notas de crédito). Todas las columnas de precio y costo vienen vacías; sí trae cantidades, productos, fechas, clientes y direcciones.
- Hoy la base tiene 274 líneas con importes (ago-2025 a ago-2026): 190 ventas por $530 M y 84 notas de crédito.
- La carga anterior falló porque la función se quedó sin tiempo de proceso con un archivo tan grande, y el lote quedó colgado en "procesando".

## Qué se va a hacer

1. **Aceptar líneas sin importe** cuando el archivo entero viene sin precios. Se avisa en la vista previa: "Este archivo no trae importes; se cargarán cantidades y se conservarán los importes existentes".
2. **Conservar el dinero existente por comprobante**: si una línea del archivo coincide con una ya cargada (mismo comprobante, letra, fecha, cliente y producto), se guarda con el importe que ya teníamos. Las líneas nuevas quedan sin importe (vacío, no cero).
3. **No borrar importes al reemplazar**: en esta carga, las líneas con dinero que no aparezcan en el archivo se mantienen. Así los $530 M y las notas de crédito actuales quedan intactos.
4. **Indicadores por cliente**: el total facturado y el ticket promedio siguen saliendo solo de las líneas con importe. La fecha de última compra, cantidad de órdenes, cadencia y productos sí se actualizan con todo el historial nuevo (mejora las recomendaciones).
5. **Archivo grande sin cortes**: procesar en partes para no exceder el tiempo, y marcar como fallido el lote colgado actual para que no bloquee nuevas cargas.
6. **Resumen al terminar**: líneas leídas, cargadas, con importe conservado, sin importe y omitidas.

Feedbacks, última visita, direcciones verificadas y asignaciones no se tocan.

## Detalles técnicos

- `process-ventas-excel`: modo "sin importes" cuando 0 filas tienen monto; `facturacion_ars = null` en vez de rechazar; enriquecer con monto existente por clave (`tipo_comprobante, fecha_emision, letra, ticket, client_id, codigo_producto`); dividir `p_ventas` en bloques para `guardar_importacion` y evitar el límite de CPU (lectura del maestro y normalización en una pasada con mapas).
- Migración: en `guardar_importacion`/`aplicar_ventas_import`, si la fila entrante tiene importe null y existe la fila previa con importe, conservarlo; en modo sin importes no eliminar filas con importe ausentes del archivo. `recompute_client_metrics` suma importes ignorando null (ya lo hace `sum`), cuenta órdenes por comprobante sobre todas las filas.
- `CargaDatos.tsx`: aviso en vista previa y fila "importe conservado" en el resumen.
- Datos: actualizar el lote `VENTAS WIWO COMPLETO.xlsx` en "procesando" a `error`.
- Pruebas: caso de archivo sin importes con coincidencias y sin coincidencias; reemplazo que no borra importes.
