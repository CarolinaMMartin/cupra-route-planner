

# Plan: Corrección de 3 bugs críticos en el motor

## Bugs encontrados

### Bug 1: Montos de venta absurdos ($ 2.263 trillones)
**Causa raíz**: La función `toNumberCurrency` en `process-ventas-excel` trata los puntos como separador de miles y los elimina. Pero `xlsx` entrega los números ya parseados como JavaScript numbers (ej: `34710.74`). Al convertir a string → `"34710.74"` → elimina el punto → `"3471074"` → el valor se multiplica x100 o más.

**Dato**: 99 de 1176 filas tienen valores > $100M. El promedio real debería ser ~$50.000, pero el promedio actual es $1.26 cuatrillones.

**Fix**: Modificar `toNumberCurrency` para detectar si el valor ya es un número JS válido y retornarlo directamente, sin manipular separadores.

### Bug 2: Mismos clientes recomendados para Pablo Y Pilar
**Causa raíz**: La función `validateAndFixDistribution` no deduplica entre vendedores. Cada vendedor recibe los mismos candidatos (GARDINER, BYB, MARKEN, DON JULIO, etc.) porque comparten la misma zona y la IA los selecciona para ambos.

**Dato**: De 16 recomendaciones totales, 6 clientes aparecen duplicados (uno por cada vendedor).

**Fix**: Después de asignar las 8 recs del primer vendedor, excluir esos `client_id` del pool del segundo vendedor.

### Bug 3: "Recomendó cualquier cosa" para Palermo
**Causa raíz**: Con los montos inflados, el ranking por `monto_total_historico` está corrupto. Los clientes con montos absurdos aparecen como "top" sin importar su zona real. Además, sin deduplicación entre vendedores, las anclas son las mismas para ambos → ambos reciben la misma ruta.

**Fix**: Se resuelve al corregir los bugs 1 y 2. Después de re-subir el Excel con el parser arreglado, los rankings y anclas serán correctos.

---

## Acciones

### 1. Fix parser `toNumberCurrency` en `process-ventas-excel`

```typescript
const toNumberCurrency = (v: any): number | null => {
  if (isEmpty(v)) return null;
  // Si xlsx ya lo parseó como número, usarlo directamente
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  // Si es un número JS limpio (sin separadores de miles)
  const directParse = Number(s);
  if (Number.isFinite(directParse)) return directParse;
  // Formato argentino: 1.234.567,89 → eliminar puntos, reemplazar coma
  const cleaned = s.replace(/[^\d,.\-]/g, '').replace(/\s+/g, '');
  // Detectar formato: si tiene coma seguida de 1-2 dígitos al final → coma es decimal
  if (/,\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || null;
  }
  // Si tiene punto seguido de 1-2 dígitos al final → punto es decimal
  if (/\.\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(/,/g, '')) || null;
  }
  return Number(cleaned.replace(/[.,]/g, '')) || null;
};
```

### 2. Deduplicación cross-vendor en `generate-recommendations`

En la sección 13 (validate), después de procesar cada vendedor, agregar sus `client_id` a un set global y excluirlos del siguiente:

```typescript
const globalPickedIds = new Set<string>();
for (const vendedor of vendedoresData) {
  // Filtrar candidatos ya asignados a otro vendedor
  const filteredBuckets = {
    activos: vendorBuckets[vendedor.user_id].activos.filter(c => !globalPickedIds.has(c.client_id)),
    inactivos: vendorBuckets[vendedor.user_id].inactivos.filter(c => !globalPickedIds.has(c.client_id)),
    perdidos: vendorBuckets[vendedor.user_id].perdidos.filter(c => !globalPickedIds.has(c.client_id)),
    potenciales: vendorBuckets[vendedor.user_id].potenciales.filter(c => !globalPickedIds.has(c.client_id)),
  };
  const vendorRecs = validateAndFixDistribution(..., filteredBuckets, ...);
  vendorRecs.forEach(r => globalPickedIds.add(r.client_id));
  validatedRecs.push(...vendorRecs);
}
```

### 3. Limpiar datos corruptos (migración SQL)

```sql
TRUNCATE TABLE ventas_cupra;
-- Reset campos agregados en clientes
UPDATE clientes SET 
  monto_total_historico = 0, ticket_promedio = 0, cantidad_ordenes = 0,
  participacion_mercado = 0, score_comercial = NULL, score_recencia = NULL, score_volumen = NULL;
-- Limpiar recomendaciones corruptas
TRUNCATE TABLE recomendaciones_ia;
```

Después de esto, el usuario re-sube el Excel y los datos quedan correctos.

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| Migración SQL | Truncar `ventas_cupra` + `recomendaciones_ia`, resetear campos de `clientes` |
| `supabase/functions/process-ventas-excel/index.ts` | Fix `toNumberCurrency` para no corromper números ya parseados |
| `supabase/functions/generate-recommendations/index.ts` | Deduplicación cross-vendor con `globalPickedIds` |

