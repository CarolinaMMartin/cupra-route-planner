

# Plan: Corregir KPIs por Zona — Datos desde ventas_cupra

## Problema raíz

La tabla ZonaKPIs calcula facturación desde `clientes.monto_total_historico` (tabla derivada, ~$267M) en vez de `ventas_cupra` (fuente de verdad). Además, la DB tiene $267M porque el ETL mapeó "Facturación Ar$" y no "Precio Total Final" (~$511M). Son **dos problemas distintos**:

1. **Dato en DB incorrecto**: `facturacion_ars` en `ventas_cupra` tiene el neto ($267M), no el total final ($511M). El ETL ya prioriza "Precio Total Final" pero los datos actuales no fueron re-cargados.
2. **ZonaKPIs usa tabla equivocada**: Línea 71 suma `cliente.monto_total_historico` (derivado) en vez de agregar desde `ventas_cupra`.
3. **Columna "Vend." confusa**: muestra vendedores distintos por barrio, pero sin tooltip ni definición clara.

## Cambios

### 1. ZonaKPIs: Facturación desde ventas_cupra

**Archivo**: `src/components/clientes/ZonaKPIs.tsx`

- Agregar prop `ventasData: any[]` (las filas raw de ventas_cupra que ya se fetchean en el dashboard).
- Recalcular facturación por barrio haciendo `GROUP BY` del `client_id` → barrio (lookup desde clientesData), `SUM(facturacion_ars)` desde ventasData.
- Recalcular vendedores por barrio desde ventasData (campo `vendedor`), no desde clientes derivados.
- Agregar columna "Tickets" (COUNT DISTINCT ticket por barrio) para dar semántica clara.
- Renombrar header "Vend." → tooltip explicando "Vendedores distintos que facturaron en esta zona".

### 2. Dashboard: Pasar ventasRaw a ZonaKPIs

**Archivo**: `src/pages/ClientesDashboard.tsx`

- Línea 659: pasar `ventasData={ventasRaw}` como prop adicional a `<ZonaKPIs>`.

### 3. Cards globales de estado (Activos/Inactivos/Perdidos/Sin datos)

Estas están correctas (usan `dias_desde_ultima_compra` con la lógica de 4 categorías). No se tocan.

### 4. Tooltip en columna "Cobertura"

Agregar tooltip: "% de clientes activos (compraron en últimos 30 días) sobre el total del barrio".

## Nota sobre los $267M

Los datos en `ventas_cupra` siguen con el valor neto porque no se re-subió el Excel desde que se cambió la prioridad del ETL. **Se necesita re-cargar el Excel** para que los $511M se reflejen. Esto no es un cambio de código sino una acción del usuario.

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/components/clientes/ZonaKPIs.tsx` | Nueva prop `ventasData`, recalcular facturación y vendedores desde ventas_cupra |
| `src/pages/ClientesDashboard.tsx` | Pasar `ventasRaw` como prop |

