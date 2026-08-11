# Reconciliar la importación de ventas

## Qué está pasando (verificado)

El archivo tiene 1.542 filas de venta, pero la base tiene 1.898. La diferencia no es un error de duplicación: son dos orígenes mezclados en la misma tabla.

| Concepto | Filas |
|---|---|
| Filas de la hoja "Ventas por Producto" | 1.542 |
| Filas de venta cargadas en la base | 1.509 |
| Filas de venta omitidas en la carga | 33 |
| Notas de crédito cargadas como filas negativas | 389 |
| **Total en base** | **1.898** |

Datos confirmados con consultas: 1.509 filas con importe positivo o cero, 389 con importe negativo, y cero filas duplicadas exactas.

La hoja "Notas de Crédito Detallado" del mismo archivo trae 620 filas; solo 389 se pudieron conciliar contra un cliente/venta, así que 231 quedaron afuera sin quedar registradas en ningún lado visible.

Problemas reales detectados:
1. No hay forma de distinguir una venta de una nota de crédito en la tabla salvo por el signo del importe, y nada lo documenta en pantalla.
2. 33 filas de venta se descartan silenciosamente (sin identidad de cliente resoluble o sin importe).
3. 231 notas de crédito no conciliadas se pierden sin dejar rastro.
4. La carga que está hoy en la base se hizo antes de que existiera el registro de lotes, por eso no hay historial de esa importación.

## Qué se va a hacer

### 1. Marcar el tipo de fila
Agregar a la tabla de ventas un campo de tipo de comprobante ("venta" / "nota_credito") y completarlo para las filas ya cargadas según el signo del importe. Así el conteo se puede explicar en cualquier momento sin adivinar.

### 2. Registrar lo omitido
Que el importador guarde las filas descartadas (venta sin cliente resoluble, venta sin importe, nota de crédito sin conciliar) en el área de staging con el motivo, en lugar de solo contarlas.

### 3. Mostrar el detalle de la carga
En la pantalla de carga de datos, mostrar al terminar un resumen conciliado: filas leídas, filas cargadas, notas de crédito aplicadas y filas omitidas con su motivo. El objetivo es que el número del Excel y el de la base siempre cierren en pantalla.

### 4. Consultas y KPIs
Revisar que los indicadores y el motor de recomendaciones sigan sumando ventas netas (venta menos nota de crédito) y que ningún conteo de "cantidad de operaciones" incluya notas de crédito como si fueran ventas.

## Detalles técnicos

- Migración: `ALTER TABLE public.ventas_cupra ADD COLUMN tipo_comprobante text NOT NULL DEFAULT 'venta'`, backfill `= 'nota_credito'` donde `facturacion_ars < 0`, más índice por tipo.
- `supabase/functions/process-ventas-excel/index.ts`: escribir el nuevo campo al insertar; extender el staging (`import_staging_rows`) con las filas descartadas y su motivo; incluir el desglose completo en `resultado` de `import_batches`.
- `src/pages/CargaDatos.tsx`: renderizar la tabla de conciliación con el desglose devuelto por la función.
- Revisión de lectura en el dashboard del asignador y en `generate-recommendations` para separar monto neto de cantidad de operaciones.
- No se re-importa nada ni se borra la carga actual: el backfill deja los 1.898 registros explicados tal cual están.

## Fuera de alcance

No se cambia la lógica de recomendaciones ni el flujo de asignaciones.
