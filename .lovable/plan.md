

# Plan: Auditoría Integral del Dashboard y ETL — 16 Tareas

## Estado actual confirmado con datos reales

```text
ventas_cupra:  1079 filas | 440 tickets únicos | 174 clientes | $267M total
clientes:      187 registros | 76 sin vendedor_actual (41%) | 102 sin barrio (55%)
```

- `cantidad_ordenes` en ETL cuenta **filas deduplicadas** (líneas de producto), NO tickets únicos → 1079 vs 440 reales
- Columna `facturacion_ars` toma "Facturación Ar$" como prioridad → $267M vs $511M del Excel (probable Precio Neto vs Total Final)
- Top Vendedores se calcula desde `clientes` (campo derivado), no desde `ventas_cupra` (fuente transaccional)

---

## Tarea 0 — Prerequisito bloqueante: Columna de facturación

**Pregunta al usuario antes de implementar**: ¿Cuál es la columna correcta del Excel?
- Opción A: "Precio Total Final" (~$511M, incluye IVA)
- Opción B: "Facturación Ar$" (~$267M, neto)

**Cambio en ETL** (`process-ventas-excel/index.ts` línea 250): Reordenar prioridad en `getFieldValue` según respuesta. Agregar log de qué columna se resolvió.

## Tarea 0.1 — Documentación del modelo de datos

Agregar bloque de comentarios al inicio del ETL y del dashboard documentando:
- `ventas_cupra`: tabla transaccional, 1 fila = 1 línea de producto
- `clientes`: tabla agregada, derivada de ventas_cupra. Fuente para filtros y segmentación
- **Fuente de verdad oficial para KPIs monetarios: `ventas_cupra`**
- Granularidad de cada métrica: línea, ticket (DISTINCT ticket+letra+fecha+client_id), cliente

## Tarea 1 — Corregir `cantidad_ordenes` → tickets únicos

**ETL línea 322-343**: Reemplazar `c.cantidad_ordenes += 1` por un `Set<string>` de tickets únicos por cliente:
```typescript
c.tickets_set = c.tickets_set || new Set();
const ticketKey = `${venta.ticket}||${venta.letra}||${venta.fecha_emision}`;
if (ticketKey && venta.ticket) c.tickets_set.add(ticketKey);
// En Fase 3:
cantidad_ordenes: c.tickets_set.size,
```
Usar solo `ticket` como identificador primario; concatenar con `letra` y `fecha_emision` solo para desambiguar tickets con mismo número.

## Tarea 2 — Validación de unicidad de tickets en ETL

Después de la deduplicación (Fase 1b), agregar validación:
- Contar tickets con >1 `client_id` (posible error de datos)
- Logear alertas si se detectan tickets compartidos entre clientes

## Tarea 3 — Separar vendedor_actual (operativo) vs atribución de ventas

- `vendedor_actual`: último vendedor que vendió al cliente (ya existe, corregir los 76 nulls)
- **Top Vendedores en dashboard**: calcular siempre desde `ventas_cupra` directamente (query separada), no desde campos derivados en `clientes`
- SQL one-time fix para los 76 nulls:
```sql
UPDATE clientes c SET vendedor_actual = sub.vendedor
FROM (SELECT DISTINCT ON (client_id) client_id, vendedor 
      FROM ventas_cupra WHERE vendedor IS NOT NULL
      ORDER BY client_id, fecha_emision DESC) sub
WHERE c.client_id = sub.client_id AND c.vendedor_actual IS NULL;
```
- Actualizar ETL para siempre calcular `vendedor_actual` como el vendedor de la venta más reciente

## Tarea 4 — Top Vendedores desde ventas_cupra

En `ClientesDashboard.tsx`: nueva query a `ventas_cupra` agrupada por `vendedor`:
```typescript
const { data: ventasVendedor } = await supabase
  .from('ventas_cupra')
  .select('vendedor, facturacion_ars');
// Agrupar en JS por vendedor → SUM(facturacion_ars)
```
Reemplaza el cálculo actual basado en `clientes.vendedor_actual`.

## Tarea 5 — Clientes sin barrio visibles

- `ZonaKPIs.tsx` y `topBarrios` en dashboard: incluir grupo "Sin barrio asignado" con los 102 clientes y su facturación
- Cualquier filtro/exportación que use `barrio_principal` debe contemplar nulls

## Tarea 6 — Separar "Sin datos" de "Perdidos"

`ZonaKPIs.tsx` línea 19: si `dias_desde_ultima_compra === null` → categoría "Sin datos" (no "Perdidos"). Agregar cuarta card o badge.

## Tarea 7 — Umbrales de calidad post-ETL

Al final del ETL, calcular y retornar en el response:
```json
{
  "calidad": {
    "pct_sin_barrio": 55,
    "pct_sin_vendedor": 41,
    "pct_sin_client_id": 2,
    "alerta": true
  }
}
```
Mostrar alertas en `CargaDatos.tsx` si supera umbrales (>10% sin barrio, >5% sin vendedor).

## Tarea 8 — Log de columnas evaluadas en ETL

Para `facturacion_ars`, logear:
- Lista de columnas evaluadas en orden de prioridad
- Cuál se resolvió para la primera fila
- Cuántas filas resultaron en null

## Tarea 9 — Reconciliación post-carga

Al final del ETL, agregar resumen de reconciliación:
- Total filas Excel vs filas procesadas vs filas en ventas_cupra
- Total facturación procesada
- Total tickets únicos
- Total clientes únicos
Mostrar en `CargaDatos.tsx` para que el usuario valide contra su Excel.

## Tarea 10 — Versionado y metadata de carga

Agregar campos al response del ETL:
```json
{
  "metadata": {
    "fecha_carga": "2026-03-17T...",
    "version_etl": "v2.0",
    "columna_facturacion": "Facturación Ar$",
    "filas_origen": 1079
  }
}
```

## Tarea 11 — Consistencia clientes ↔ ventas_cupra

Validación post-carga: comparar `SUM(facturacion_ars)` en ventas_cupra por client_id vs `monto_total_historico` en clientes. Reportar discrepancias >1%.

## Tarea 12 — Control de integridad client_id

En ETL: reportar cuántos registros del Excel no pudieron resolverse a un `client_id` válido, y listar los CUIT/razón social descartados.

## Tarea 13 — Indicador de calidad en dashboard

En `ClientesDashboard.tsx`: badge/card pequeño mostrando:
- % clientes sin barrio
- % clientes sin vendedor
- Fecha de última carga

## Tarea 14 — Normalización de nomenclatura

Unificar en todo el código: usar solo `dias_desde_ultima_compra` (nunca `dias_sin_compra`). Documentar granularidad en comentarios de cada KPI card.

## Tarea 15 — Documentar KPIs con tooltips

Cada KPI card en el dashboard lleva tooltip con:
- Fórmula exacta
- Tabla fuente
- Granularidad (línea/ticket/cliente)

---

## Archivos a modificar

| Archivo | Tareas |
|---------|--------|
| `supabase/functions/process-ventas-excel/index.ts` | 0, 0.1, 1, 2, 7, 8, 9, 10, 11, 12 |
| `src/pages/ClientesDashboard.tsx` | 0.1, 4, 5, 13, 14, 15 |
| `src/components/clientes/ZonaKPIs.tsx` | 5, 6 |
| `src/pages/CargaDatos.tsx` | 7, 9, 10 |
| Migración SQL | 3 (fix vendedor_actual nulls) |

## Prerequisito bloqueante

Necesito tu respuesta sobre **Tarea 0**: ¿"Precio Total Final" o "Facturación Ar$"? Sin esto no se puede implementar el resto correctamente.

