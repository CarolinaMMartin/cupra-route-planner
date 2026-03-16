

# Plan v9: Zona Caliente por Vendedor + Mix Estratégico

## Archivo: `supabase/functions/generate-recommendations/index.ts`

### Resumen de cambios

Reescribir la lógica de scoring y selección para que cada vendedor tenga su propio "hotspot" calculado exclusivamente desde sus clientes, con radio duro de 1.5km, prioridad clientes sobre prospectos, y las 3 correcciones de seguridad.

---

### Cambio 1: Hotspot per-vendor (reemplaza zoneCenter global)

**Líneas 664-682** (cálculo de `zoneCenter` global) se mantiene SOLO como fallback. La lógica principal se mueve al loop per-vendor (líneas 788-802):

- Calcular `vendorHotspot` = centroide de los clientes propios del vendedor que tienen coordenadas Y están en la zona filtrada.
- **Fallback (corrección #1):** Si el vendedor tiene 0 clientes en zona → `vendorHotspot` = centroide de los `clientPlaces` que matchean el filtro geográfico (es decir, el centro del barrio/comuna seleccionado). Esto habilita "Modo Conquista" con solo prospectos.

### Cambio 2: Radio duro 1.5km para TODOS (clientes y prospectos)

- Eliminar `applyRadiusToClients` parameter de `preScoreCandidates`.
- SIEMPRE filtrar por `isWithinRadiusFromCenter(lat, long, vendorHotspot, 1.5)` tanto para clientes como prospectos.
- Constante: `HARD_RADIUS_KM = 1.5`, `MAX_EXPANSION_KM = 2.0`.

### Cambio 3: Pool lineal — clientes primero, prospectos después

Reemplazar buckets separados (activos/inactivos/perdidos/potenciales) por dos pools:

```text
Pool 1: CLIENTES (ACTIVO + INACTIVO + PERDIDO) dentro de 1.5km del hotspot
  → Ordenados por score_total
Pool 2: PROSPECTOS (POTENCIAL) dentro de 1.5km del hotspot
  → Ordenados por distancia al hotspot (más cerca primero)
```

Llenado: tomar hasta 8 del Pool 1. Si < 8, completar con Pool 2. Si aún < 8, expandir Pool 2 a 2km (nunca más).

### Cambio 4: Mix estratégico — al menos 1 recuperación (corrección #2)

Dentro del Pool 1, después de seleccionar los top 7 por score, verificar si hay al menos 1 cliente con `dias_desde_ultima_compra > 90` (PERDIDO). Si no lo hay pero existe uno disponible en el radio, swapear el #7 por el mejor PERDIDO. Esto garantiza proactividad de recuperación sin ser rígido.

### Cambio 5: `validateAndFixDistribution` simplificado

Reemplazar la lógica de targets 5-1-1-1 por:
1. Tomar recs válidas de la IA (que estén en candidateMap y no en globalPickedIds).
2. Si < 8, completar linealmente: primero clientes por score, luego prospectos por distancia.
3. Forzar al menos 1 PERDIDO/INACTIVO si existe (corrección #2).
4. Mantener `globalPickedIds` para deduplicación cross-vendor (corrección #3).

### Cambio 6: Expansión geográfica simplificada

Eliminar expansiones de 2.5km y 3km. Solo:
- Si < 8 candidatos en 1.5km del hotspot → buscar prospectos en bounding box de 2km del **vendorHotspot** (no del zoneCenter global).
- Cap absoluto: 2km. Nunca más.

### Cambio 7: Prompt actualizado

```
"Elegí 8 visitas priorizando clientes existentes de la cartera.
Completá con prospectos SOLO si no hay suficientes clientes.
Incluí al menos 1 cliente que lleve >90 días sin comprar si existe.
Todos deben estar geográficamente concentrados."
```

### Cambio 8: Version bump a `v9-hotzone`

---

### Resultado esperado
- Todas las recomendaciones dentro de 1.5-2km del hotspot real del vendedor
- Clientes existentes priorizados, prospectos solo como relleno
- Al menos 1 visita de recuperación (PERDIDO/INACTIVO) si existe en zona
- Deduplicación cross-vendor mantenida
- Modo conquista funcional (vendedor sin clientes en zona nueva)

