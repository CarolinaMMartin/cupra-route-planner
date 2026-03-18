

# Plan: Corregir ETL + Dashboard — Alineación 1:1 con Excel

## Diagnóstico confirmado (código actual)

| Problema | Líneas | Causa |
|----------|--------|-------|
| Pérdida de filas sin client_id | ETL L399-403 | `if (!client_id) continue` descarta filas con razón social pero sin ID/CUIT |
| Dedup bypass por campos nulos | ETL L273 | `buildVentaConflictKey` retorna `null` si `letra` es null → filas van a `ventasSinClaveConflicto` sin deduplicar |
| KPI Clientes cuenta client_id | Dashboard L260 | `clientesSet.add(v.client_id)` en vez de razón social normalizada |
| Barrio como dimensión principal | Dashboard L288-317, ZonaKPIs | "Top Barrios" y ZonaKPIs usan barrio que no existe en Excel |
| Sin alerta de delta post-carga | CargaDatos | No compara totales ETL vs Excel |

## Cambios

### 1. ETL: No perder filas sin client_id (L399-403)

Reemplazar el `continue` por generación de ID sintético:

```typescript
if (!client_id && razon_social) {
  // Generar ID determinístico: normalizar razón social
  const normalized = razon_social.trim().toUpperCase().replace(/\s+/g, ' ');
  client_id = `RS_${normalized}`;
}
if (!client_id) { // Sin ID NI razón social → descartar
  ventasSinClientId += 1;
  descartados.push({ cuit_dni, razon_social });
  continue;
}
```

### 2. ETL: Dedup robusta con COALESCE de nulos (L269-277)

Cambiar `buildVentaConflictKey` para no retornar null cuando `letra` es vacía:

```typescript
const buildVentaConflictKey = (venta) => {
  const ticket = venta.ticket;
  if (!ticket) return null; // Solo ticket es obligatorio
  const parts = [
    String(ticket).trim().toUpperCase(),
    String(venta.letra ?? '').trim().toUpperCase(),
    String(venta.fecha_emision ?? '').trim(),
    String(venta.client_id ?? '').trim().toUpperCase(),
    String(venta.codigo_producto ?? '').trim().toUpperCase(),
    String(venta.facturacion_ars ?? 0),
  ];
  return parts.join('||');
};
```

### 3. ETL: Reconciliación con razón social normalizada

Agregar al objeto `reconciliacion`:
- `clientes_razon_social`: COUNT DISTINCT de razón social normalizada (TRIM+UPPER+collapse spaces)
- Mantener `clientes_unicos` (por client_id) como control secundario

### 4. Dashboard KPI: Clientes = razón social normalizada (L254-266)

```typescript
const normalizeRS = (rs: string) => rs.trim().toUpperCase().replace(/\s+/g, ' ');
// En kpis useMemo:
if (v.razon_social) clientesSet.add(normalizeRS(v.razon_social));
```

### 5. Dashboard: Reemplazar "Top Barrios" por "Top Ciudades" (L288-317)

Cambiar el lookup de `barrio_principal` a `ciudad` directamente desde `ventas_cupra.ciudad`. Ya se tiene este campo en el fetch. Eliminar "⚠️ Sin barrio asignado" y usar "Sin ciudad" como fallback.

### 6. ZonaKPIs: Cambiar eje de "Barrio" a "Ciudad/Provincia"

En `ZonaKPIs.tsx`, reemplazar `barrio_principal` por `ciudad_principal` como dimensión de agrupación. Renombrar headers de "Zona" a "Ciudad". Eliminar referencia a "Sin barrio asignado".

### 7. CargaDatos: Alerta de delta post-carga

En la UI de resultados, calcular delta entre `reconciliacion.facturacion_total_procesada` y la suma del preview del Excel. Si delta > 0.1%, mostrar alerta roja. Mostrar tabla de vendedores con montos.

### 8. SQL Migration: Índice único robusto con COALESCE

```sql
ALTER TABLE ventas_cupra DROP CONSTRAINT IF EXISTS ventas_cupra_unique_venta;
CREATE UNIQUE INDEX ventas_cupra_unique_venta ON ventas_cupra (
  ticket, COALESCE(letra, ''), COALESCE(fecha_emision, '1900-01-01'),
  COALESCE(client_id, ''), COALESCE(codigo_producto, ''),
  COALESCE(facturacion_ars, 0)
);
```

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `supabase/functions/process-ventas-excel/index.ts` | Fixes 1, 2, 3 |
| `src/pages/ClientesDashboard.tsx` | Fixes 4, 5 |
| `src/components/clientes/ZonaKPIs.tsx` | Fix 6 |
| `src/pages/CargaDatos.tsx` | Fix 7 |
| SQL migration | Fix 8 |

## Criterio de aceptación

Tras re-carga del Excel:
- Ventas = ~$511.323.740
- Tickets = 443
- Clientes (razón social normalizada) ≈ 200
- Delta < 0.1% → sin alerta
- Rankings por Ciudad, no por Barrio

