

## Plan: Resolver vinculación client_id por CUIT/DNI

### Problema

```text
Excel actual:
  CUIT/DNI: 30634566623  →  client_id = "30634566623" (CUIT como fallback)

DB existente:
  client_id: "350"  cuit_dni: "30634566623"  razon_social: GARDINER

Resultado: cliente DUPLICADO
```

### Solución

Agregar una **Fase 0** en el edge function que consulte la tabla `clientes` para construir un mapa `cuit_dni → client_id` existente. Cuando el Excel no trae un ID explícito, se busca primero si ya existe un cliente con ese CUIT y se usa su `client_id` original.

### Cambio en `process-ventas-excel/index.ts`

**Fase 0 (nueva):** Antes de procesar filas:
```typescript
// Extraer todos los CUITs únicos del Excel
const allCuits = new Set<string>();
for (const row of rows) {
  const cuit = normalizeCuit(getFieldValue(row, ['CUIT / DNI', ...]));
  if (cuit) allCuits.add(cuit);
}

// Consultar clientes existentes por CUIT
const { data: existingByCuit } = await supabase
  .from('clientes')
  .select('client_id, cuit_dni')
  .in('cuit_dni', Array.from(allCuits));

// Mapa: cuit → client_id existente
const cuitToClientId = new Map<string, string>();
for (const c of existingByCuit || []) {
  if (c.cuit_dni) cuitToClientId.set(c.cuit_dni, c.client_id);
}
```

**En Fase 1**, cambiar la resolución de `client_id`:
```typescript
const idCandidato = normalizeClientId(getFieldValue(row, ['Id', 'Número Externo', ...]));
const cuit_dni = normalizeCuit(getFieldValue(row, ['CUIT / DNI', ...]));

// Prioridad: ID explícito > lookup por CUIT > CUIT como fallback
const client_id = idCandidato 
  || (cuit_dni && cuitToClientId.get(cuit_dni)) 
  || cuit_dni;
```

### Resultado

- GARDINER llega con CUIT `30634566623` → lookup encuentra `client_id: "350"` → se actualiza el cliente existente sin duplicar
- Clientes nuevos (CUIT no encontrado en DB) → se crean con CUIT como client_id (comportamiento actual)
- Ventas se vinculan correctamente al client_id real

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/process-ventas-excel/index.ts` | Agregar Fase 0 de lookup CUIT→client_id |

### Limpieza de duplicados existentes

También debemos verificar si ya se crearon duplicados en cargas anteriores y limpiarlos. Puedo hacer un query para detectarlos después de implementar el fix.

