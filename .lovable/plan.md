

# Diagnóstico y Plan: Solo 1 de 8 recomendaciones + colores del mapa

## Diagnóstico

### Bug principal: Solo 1 recomendación guardada (debería ser 8)

Los logs muestran la secuencia exacta del fallo:

```text
📊 IGNACIO CAMPOMAR: 0A 0I 0P 1Pot = 1 total
🎯 IA seleccionó 8 recomendaciones
✅ IGNACIO CAMPOMAR: 1 recs (0A-0I-0P-1Pot)
✅ 1 recomendaciones guardadas
```

**Paso 1:** El vendedor tiene 20 clientes en zona pero TODOS son de otros vendedores (97 excluidos por cartera ajena). Solo queda 1 prospecto POTENCIAL.

**Paso 2:** La expansión busca más prospectos pero falla:
- `barriosFinales` está vacío (el request no tiene filtro de barrio)
- Fallback: usa barrios del portfolio del vendedor → "Wilde, Gerli, Palermo, Canning, Ciudad Evita"
- Estos barrios están lejos del centro de zona (-34.6242, -58.5028 = Monte Castro)
- `preScoreCandidates` aplica `isWithinRadiusFromCenter` (1km) → descarta TODOS los prospectos extra
- Resultado: +0 prospectos del barrio, +0 de provincia

**Paso 3:** La IA recibe 1 candidato, inventa 7 ficticios con `client_id` inexistentes.

**Paso 4:** `validateAndFixDistribution` solo encuentra 1 candidato real en los buckets → devuelve 1.

### Causa raíz
La expansión de prospectos busca por **nombre de barrio** en la DB, pero luego `preScoreCandidates` filtra por **radio 1km desde el centro de zona**. Si los barrios buscados no coinciden geográficamente con el centro de zona, se descartan todos. Necesita buscar prospectos **por proximidad geográfica**, no por nombre de barrio.

### Bug del mapa: colores no diferencian vendedores
El mapa funciona correctamente en código — `resolveRecommendedVendor` extrae el nombre y `getVendorColor` asigna colores únicos. Pero con solo 1 recomendación guardada, solo hay 1 vendedor visible → 1 color. Cuando se arregle el bug principal (8 por vendedor × 2 vendedores = 16), los colores se diferenciarán automáticamente.

## Plan de ejecución

### Archivo: `supabase/functions/generate-recommendations/index.ts`

**Cambio 1: Expansión por proximidad geográfica (no por barrio)**

Reemplazar la lógica de expansión (líneas 790-872). En lugar de buscar prospectos por nombre de barrio con `.or(barrioConds)`, buscar por rango de lat/lng alrededor del centro de zona:

```
// Calcular bounding box de ~2km alrededor del centro de zona
const deltaLat = 0.018; // ~2km
const deltaLng = 0.022; // ~2km a latitud -34
query = supabase.from("prospectos").select("*")
  .gte("latitud", zoneCenter.lat - deltaLat)
  .lte("latitud", zoneCenter.lat + deltaLat)
  .gte("longitud", zoneCenter.lng - deltaLng)
  .lte("longitud", zoneCenter.lng + deltaLng)
  .limit(needed * 5);
```

Esto garantiza que los prospectos cargados ya están dentro del radio operativo y no serán descartados por `isWithinRadiusFromCenter`.

**Cambio 2: Fallback sin filtro geo si la búsqueda por proximidad no alcanza**

Si después de la búsqueda por proximidad todavía hay <8 candidatos, buscar prospectos sin filtro geográfico y ordenados por distancia al centro de zona (calculada en JS), aceptando hasta 2km.

**Cambio 3: Aumentar radio de expansión a 2km**

Durante la expansión, usar `MAX_DISTANCE_TO_ZONE_CENTER_KM * 2` (2km) en lugar de 1km para `preScoreCandidates`, ya que el objetivo es llenar la cuota.

**Cambio 4: Versión bump a v7**

Cambiar el tag de versión para tracking en logs.

### Resultado esperado
- 8 recomendaciones por vendedor, siempre
- Prospectos concentrados geográficamente cerca del centro de zona
- Mapa con colores diferenciados por vendedor (ya funciona, solo necesita datos correctos)

