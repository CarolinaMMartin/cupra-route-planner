

# Plan: Corregir Historial de Interacciones en Detalle de Asignación

## Problema Identificado

Cuando el vendedor abre una tarjeta de asignación desde el "Historial de Asignaciones", la sección **"Historial de Interacciones"** muestra (0) y el mensaje "No hay interacciones registradas aún", a pesar de que en la minivista de la tarjeta SÍ aparece el feedback.

### Causa Raíz

En `VendedorDashboard.tsx`, el query para obtener todos los feedbacks (línea 128-131) usa un join con foreign key que **no existe** en la base de datos:

```typescript
supabase.from("cliente_feedbacks").select(`
  *,
  vendedor:profiles!cliente_feedbacks_vendedor_id_fkey(nombre)
`)
```

La tabla `cliente_feedbacks` **no tiene una foreign key hacia `profiles`** para `vendedor_id`. Esto causa que el query falle silenciosamente o devuelva datos incorrectos.

### Evidencia

| Query | Estado |
|-------|--------|
| `feedbacksRes` (línea 126) - simple query | Funciona correctamente |
| `allFeedbacksRes` (línea 128-131) - con join | Falla por FK inexistente |

Los datos existen en la base de datos y el join SQL directo sí funciona, pero la sintaxis de Supabase SDK con `!foreign_key_name` requiere que la FK exista.

## Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/VendedorDashboard.tsx` | Corregir query de feedbacks y agregar profiles manualmente |

## Solución Técnica

### Opción Implementada: Query separado + merge manual

Dado que no hay FK definida, se harán dos queries:
1. Query de todos los feedbacks (sin join)
2. Query de profiles para los vendedor_ids únicos
3. Merge manual de la información del vendedor

### Cambios en fetchDashboardData() (líneas 119-160)

```typescript
// Antes (falla):
const [clientesRes, prospectosRes, feedbacksRes, allFeedbacksRes] = await Promise.all([
  // ... otros queries ...
  supabase.from("cliente_feedbacks").select(`
    *,
    vendedor:profiles!cliente_feedbacks_vendedor_id_fkey(nombre)
  `)
]);

// Después (funciona):
const [clientesRes, prospectosRes, feedbacksRes, allFeedbacksRaw] = await Promise.all([
  // ... otros queries mantienen igual ...
  supabase.from("cliente_feedbacks").select("*")  // Sin join
]);

// Obtener vendedor_ids únicos de todos los feedbacks
const vendedorIds = [...new Set(
  allFeedbacksRaw.data?.map(f => f.vendedor_id).filter(Boolean) || []
)];

// Query separado para profiles
const profilesRes = vendedorIds.length > 0
  ? await supabase
      .from("profiles")
      .select("user_id, nombre")
      .in("user_id", vendedorIds)
  : { data: [] };

// Crear mapa de profiles
const profilesMap = new Map<string, string>();
profilesRes.data?.forEach(p => profilesMap.set(p.user_id, p.nombre));

// Mapear feedbacks con info del vendedor
const allFeedbacksData = allFeedbacksRaw.data?.map(f => ({
  ...f,
  vendedor: profilesMap.has(f.vendedor_id) 
    ? { nombre: profilesMap.get(f.vendedor_id) }
    : undefined
})) || [];
```

### Actualizar el mapeo de allFeedbacksMap (líneas 147-160)

```typescript
// Agrupar todos los feedbacks por cliente/prospecto
const allFeedbacksMap = new Map<string, FeedbackInfo[]>();
allFeedbacksData.forEach(f => {
  const key = f.client_id || f.prospecto_place_id || '';
  if (key) {
    if (!allFeedbacksMap.has(key)) {
      allFeedbacksMap.set(key, []);
    }
    allFeedbacksMap.get(key)?.push(f as FeedbackInfo);
  }
});
```

## Resultado Esperado

| Antes | Después |
|-------|---------|
| Historial de Interacciones (0) | Historial de Interacciones (N) con todos los feedbacks |
| "No hay interacciones registradas aún" | Lista completa de feedbacks con vendedor, fecha y detalles |

## Alternativa a Futuro (Opcional)

Si se desea mantener la sintaxis original con join, se podría agregar la FK faltante a la base de datos:

```sql
ALTER TABLE cliente_feedbacks 
ADD CONSTRAINT cliente_feedbacks_vendedor_id_fkey 
FOREIGN KEY (vendedor_id) REFERENCES profiles(user_id);
```

Sin embargo, la solución con queries separados es más robusta y no requiere cambios en la base de datos.

