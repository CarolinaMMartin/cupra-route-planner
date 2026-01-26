
# Plan: Eliminar Filtro de Fecha de Creación para Prospectos

## Problema Identificado

En la línea 317 de `generate-recommendations/index.ts`, existe un filtro que excluye prospectos creados hace más de 30 días:

```typescript
.gte("created_at", treintaDiasAtras.toISOString())
```

Esto excluye el 99% de los prospectos disponibles (1,334 de 1,345).

---

## Cambios Requeridos

### Archivo: `supabase/functions/generate-recommendations/index.ts`

**Líneas 310-319 - Eliminar filtro de fecha y mejorar ordenamiento:**

```typescript
// ANTES:
// PASO 5: Cargar prospectos nuevos (últimos 30 días) con misma lógica
const treintaDiasAtras = new Date();
treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

let prospectosQuery = supabaseClient
  .from("prospectos")
  .select("*")
  .gte("created_at", treintaDiasAtras.toISOString())
  .order("created_at", { ascending: false })
  .limit(100);

// DESPUÉS:
// PASO 5: Cargar prospectos con prioridad por rotación
let prospectosQuery = supabaseClient
  .from("prospectos")
  .select("*")
  .order("last_recommendation_at", { ascending: true, nullsFirst: true })
  .limit(200);
```

---

## Resumen de Cambios

| Cambio | Antes | Después |
|--------|-------|---------|
| Filtro fecha creación | `>= 30 días` | Sin filtro |
| Ordenamiento | `created_at DESC` | `last_recommendation_at ASC NULLS FIRST` |
| Límite | 100 | 200 |
| Prospectos disponibles | ~11 | ~1,341 |

---

## Sección Técnica

La lógica de priorización por `last_recommendation_at` que ya existe en líneas 352-367 seguirá funcionando correctamente. Los prospectos nunca recomendados (NULL) tendrán prioridad automática gracias al nuevo ordenamiento.

El flujo corregido será:
1. Cargar TODOS los prospectos (sin filtro de fecha)
2. Ordenar por `last_recommendation_at` (nulls primero = nunca recomendados)
3. Aplicar filtros geográficos (provincia, comuna, barrio)
4. Excluir prospectos ya asignados hoy
5. Separar por rotación de 15 días para priorización adicional
6. Enviar candidatos a la IA
