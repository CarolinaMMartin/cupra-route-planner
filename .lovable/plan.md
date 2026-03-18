

# Plan: Corregir datos del Dashboard — 6 Fixes del diagnóstico

## Resumen del diagnóstico

| # | Problema | Causa raíz | Impacto |
|---|---------|------------|---------|
| 1 | $267M vs $509M | El Excel se cargó cuando el ETL priorizaba "Facturación Ar$" (neto), no "Precio Total Final" (bruto). Los datos en `ventas_cupra` son viejos. | Todos los KPIs monetarios incorrectos |
| 2 | 55% sin barrio | `normalizarGeografia()` hace NFD que convierte Ñ→N, rompiendo el lookup en `BARRIOS_A_COMUNA`. Además, ciudades de GBA no se mapean a barrio. | Segmentación geográfica inútil |
| 3 | 6 filas duplicadas | El ETL ya deduplica por clave compuesta, pero las 6 duplicatas del Excel tienen algún campo diferente (no son 100% idénticas). | $1.8M inflados |
| 4 | 197 vs 187 clientes | KPI "Clientes" cuenta `DISTINCT razon_social` en `ventas_cupra` (197), filtros usan tabla `clientes` (187). Diferencia: clientes con misma razón social pero distinto `client_id`. | Confusión en UI |
| 5 | Inactivos 45 vs 48, Perdidos 98 vs 121 | Consecuencia de Fix 1: datos incompletos en DB. Los 13 "sin datos" son clientes sin ventas. | Se corrige con re-carga |
| 6 | Variantes de provincia | "CABA", "Cdad. Autónoma de Buenos Aires", etc. no se normalizan. | Filtros fragmentados |

## Cambios propuestos

### Fix 2 — Corregir `normalizarGeografia()` (ETL)

**Archivo**: `supabase/functions/process-ventas-excel/index.ts`

El bug es que `BARRIOS_A_COMUNA` tiene keys con Ñ (`NUÑEZ`) pero la función hace NFD que elimina la Ñ. Solución: normalizar también las keys del mapa al comparar.

```typescript
// Antes:
if (BARRIOS_A_COMUNA[ubicacion]) { ... }

// Después: normalizar la key del mapa también
const ubicacionNorm = ciudadRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const barrioKey = Object.keys(BARRIOS_A_COMUNA).find(k => 
  k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === ubicacionNorm
);
if (barrioKey) {
  return { barrio: barrioKey, comuna: BARRIOS_A_COMUNA[barrioKey], ciudad: 'CABA', provincia: 'CABA' };
}
```

Además, agregar barrios de CABA faltantes al mapa: `CONGRESO` → `COMUNA 5` (es parte de Balvanera).

### Fix 3 — Deduplicación más estricta

**Archivo**: `supabase/functions/process-ventas-excel/index.ts`

Agregar un paso previo de deduplicación por hash completo de la fila (todos los campos) antes de la dedup por clave compuesta. Las 6 filas son idénticas en contenido pero la clave compuesta tiene alguna variación menor.

```typescript
// Fase 0.5: Eliminar filas 100% idénticas
const rowHashes = new Set<string>();
const rowsUnique = rows.filter(row => {
  const hash = JSON.stringify(Object.values(row).map(v => String(v ?? '').trim()));
  if (rowHashes.has(hash)) return false;
  rowHashes.add(hash);
  return true;
});
```

### Fix 4 — Unificar conteo de clientes

**Archivo**: `src/pages/ClientesDashboard.tsx`

Cambiar el KPI "Clientes" para contar `DISTINCT client_id` en vez de `DISTINCT razon_social`:

```typescript
// Antes:
if (v.razon_social) clientesSet.add(v.razon_social);
// Después:
if (v.client_id) clientesSet.add(v.client_id);
```

Esto hará que coincida con la tabla `clientes` (187).

### Fix 5 — Excluir "sin datos" de KPIs de ventas

Los 13 clientes sin ventas ya se manejan correctamente (se muestran como "Sin datos" en la card). No requiere cambio de código — se corrige automáticamente cuando los KPIs vienen de `ventas_cupra` (que ya no los incluye).

### Fix 6 — Normalizar provincias en ETL

**Archivo**: `supabase/functions/process-ventas-excel/index.ts`

Agregar mapa de normalización de provincias después de `normalizarGeografia()`:

```typescript
const PROVINCIA_NORM: Record<string, string> = {
  'CABA': 'CABA',
  'CDAD. AUTONOMA DE BUENOS AIRES': 'CABA',
  'CIUDAD AUTONOMA DE BUENOS AIRES': 'CABA',
  'C.A.B.A.': 'CABA',
  'CAPITAL FEDERAL': 'CABA',
  'BUENOS AIRES': 'Provincia de Buenos Aires',
  'BS AS': 'Provincia de Buenos Aires',
  'BS. AS.': 'Provincia de Buenos Aires',
  'PBA': 'Provincia de Buenos Aires',
  'PROVINCIA DE BUENOS AIRES': 'Provincia de Buenos Aires',
};
```

Aplicar también un backfill SQL para normalizar los datos existentes en `clientes`.

### Fix 1 — Re-carga del Excel (acción del usuario)

Este NO es un cambio de código. La DB tiene $267M porque el Excel se cargó con una versión anterior del ETL que priorizaba "Facturación Ar$" en vez de "Precio Total Final". El ETL v3.0 ya está configurado correctamente (línea 253 prioriza "Precio Total Final"). 

**Acción requerida**: Re-subir el Excel desde la página "Carga de Datos". Con los fixes 2, 3 y 6 aplicados al ETL, la re-carga corregirá automáticamente:
- Ventas totales: $267M → ~$509M
- Barrios: se asignarán correctamente para clientes CABA
- Provincias: normalizadas
- Inactivos/Perdidos: recalculados con datos completos

### Backfill SQL (una vez)

Migración para normalizar provincias existentes y reclasificar barrios de CABA que quedaron como ciudad:

```sql
-- Normalizar provincias existentes
UPDATE clientes SET provincia_principal = 'CABA' 
WHERE UPPER(provincia_principal) IN ('CDAD. AUTONOMA DE BUENOS AIRES', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'C.A.B.A.', 'CAPITAL FEDERAL');

UPDATE clientes SET provincia_principal = 'Provincia de Buenos Aires'
WHERE UPPER(provincia_principal) IN ('BS AS', 'BS. AS.', 'PBA');
```

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/process-ventas-excel/index.ts` | Fix 2 (barrios NFD), Fix 3 (dedup estricta), Fix 6 (provincias) |
| `src/pages/ClientesDashboard.tsx` | Fix 4 (client_id en vez de razon_social) |
| SQL migration | Backfill provincias |

## Secuencia de ejecución

1. Aplicar cambios de código (ETL + Dashboard)
2. Deploy edge function
3. Ejecutar backfill SQL
4. **Usuario re-sube el Excel** → todos los fixes se aplican juntos
5. Verificar KPIs post-carga

