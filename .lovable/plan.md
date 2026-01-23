
# Plan: Sincronización Geográfica Completa

## Estado Actual Confirmado

### Provincias en `client_places` (fuente de verdad)
| Valor | Cantidad | Acción |
|-------|----------|--------|
| Ciudad Autónoma de Buenos Aires | 75 | ✅ Correcto |
| Provincia de Buenos Aires | 31 | ✅ Correcto |
| Buenos Aires | 6 | → Normalizar |
| Buenos Aires Province | 2 | → Normalizar |

### Provincias en `clientes` (con problemas)
| Valor | Cantidad | Acción |
|-------|----------|--------|
| Ciudad Autónoma de Buenos Aires | 65 | ✅ Mantener |
| Provincia de Buenos Aires | 27 | ✅ Mantener |
| BUENOS AIRES | 13 | → Sincronizar |
| CABA | 11 | → Sincronizar |
| Buenos Aires | 6 | → Sincronizar |
| Buenos Aires Province | 1 | → Sincronizar |

### Barrios en mayúsculas
LINIERS, PUERTO MADERO, CITY BELL, CABALLITO, GONNET, ABASTO, BARRACAS, etc.

---

## Implementación en 3 Fases

### Fase 1 — SQL Backfill (una vez)

#### 1.1 Normalizar provincias en `client_places`

```sql
-- Normalizar "Buenos Aires" y "Buenos Aires Province" a "Provincia de Buenos Aires"
UPDATE client_places
SET provincia_principal = 'Provincia de Buenos Aires'
WHERE provincia_principal IN ('Buenos Aires', 'Buenos Aires Province');
```

#### 1.2 Sincronizar `clientes` desde `client_places` (SIEMPRE)

```sql
-- Sincronizar provincia, barrio, dirección desde client_places primario
UPDATE clientes c
SET 
  provincia_principal = cp.provincia_principal,
  barrio_principal = cp.barrio_principal,
  direccion_principal = cp.direccion_principal
FROM client_places cp
WHERE c.client_id = cp.client_id
  AND cp.is_primary = true;

-- Recalcular todos_barrios como array de todos los barrios del cliente
UPDATE clientes c
SET todos_barrios = subq.barrios_array
FROM (
  SELECT client_id, 
         ARRAY_AGG(DISTINCT barrio_principal) FILTER (WHERE barrio_principal IS NOT NULL) as barrios_array
  FROM client_places 
  GROUP BY client_id
) subq
WHERE c.client_id = subq.client_id;
```

**Resultado esperado:**
- Solo quedan 2 provincias: "Ciudad Autónoma de Buenos Aires" y "Provincia de Buenos Aires"
- Desaparecen: CABA, BUENOS AIRES, Buenos Aires, Buenos Aires Province
- Desaparecen barrios en mayúsculas: CITY BELL → City Bell, PALERMO → Palermo

---

### Fase 2 — Prevención (Edge Functions)

#### 2.1 Modificar `upsert-client-places`

Agregar normalización de provincia al recibir datos:

```typescript
// Normalización de provincia antes de guardar
const normalizeProvince = (prov: string | null | undefined): string | null => {
  if (!prov) return null;
  const trimmed = prov.trim();
  const lower = trimmed.toLowerCase();
  
  // CABA variantes
  if (lower.includes('ciudad autónoma') || lower === 'caba') {
    return 'Ciudad Autónoma de Buenos Aires';
  }
  
  // Provincia de Buenos Aires variantes
  if (lower === 'buenos aires' || 
      lower === 'buenos aires province' ||
      lower === 'provincia de buenos aires') {
    return 'Provincia de Buenos Aires';
  }
  
  // Mantener original si no es variante conocida
  return trimmed;
};
```

Aplicar en el mapeo de datos (línea 99):
```typescript
provincia_principal: normalizeProvince(place.provincia),
```

#### 2.2 `upsert-clientes`

Ya está correctamente implementado:
- Excluye campos geográficos del payload de n8n (líneas 109-118)
- Siempre sincroniza desde client_places (sin condición NULL, líneas 233-246)

---

### Fase 3 — UI Robusta (Dashboard)

#### 3.1 Agregar dedupe case-insensitive para Provincias

El selector actual NO tiene dedupe (líneas 112-118):

```typescript
// ACTUAL:
const provincias = useMemo(() => {
  const uniqueProvincias = new Set<string>();
  clientesData.forEach(cliente => {
    if (cliente.provincia_principal) uniqueProvincias.add(cliente.provincia_principal);
  });
  return Array.from(uniqueProvincias).sort();
}, [clientesData]);

// CAMBIAR A:
const provincias = useMemo(() => {
  const provinciasMap = new Map<string, string>(); // normalized -> display
  clientesData.forEach(cliente => {
    if (cliente.provincia_principal) {
      const key = normalize(cliente.provincia_principal);
      if (!provinciasMap.has(key)) {
        provinciasMap.set(key, cliente.provincia_principal);
      }
    }
  });
  return Array.from(provinciasMap.values()).sort();
}, [clientesData]);
```

#### 3.2 Agregar filtrado case-insensitive para Provincia

```typescript
// ACTUAL (línea 187):
const matchProvincia = selectedProvincia === "all" || 
  cliente.provincia_principal === selectedProvincia;

// CAMBIAR A:
const matchProvincia = selectedProvincia === "all" || 
  normalize(cliente.provincia_principal) === normalize(selectedProvincia);
```

---

## Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| SQL Migration | Normalizar client_places + Backfill clientes |
| `supabase/functions/upsert-client-places/index.ts` | Agregar `normalizeProvince()` |
| `src/pages/ClientesDashboard.tsx` | Dedupe + filtrado case-insensitive para provincias |

---

## Verificación Final

### En base de datos

```sql
-- Debe retornar solo 2 provincias
SELECT DISTINCT provincia_principal FROM clientes;

-- Debe retornar 12 (según client_places primario)
SELECT COUNT(*) FROM clientes WHERE barrio_principal = 'Palermo';
```

### En UI
- Selector de provincia muestra 2 opciones (sin CABA, BUENOS AIRES, etc.)
- Filtrar por "Palermo" muestra 12 clientes
- No hay duplicados en ningún selector

---

## Secuencia de Ejecución

1. Ejecutar SQL: Normalizar `client_places.provincia_principal`
2. Ejecutar SQL: Backfill `clientes` desde `client_places`
3. Verificar en BD que solo hay 2 provincias y 12 Palermo
4. Actualizar `upsert-client-places` con `normalizeProvince()`
5. Robustecer `ClientesDashboard` con dedupe provincias
6. Verificar UI: selectores sin duplicados
