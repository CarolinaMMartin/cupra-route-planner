

# Diagnóstico y Plan Técnico: Sistema de Asignaciones

## Estado Actual vs Reglas de Negocio

| Regla de Negocio | Estado Actual | Cumple |
|------------------|---------------|--------|
| Asignación no visitada sigue válida aunque sea de días anteriores | El sistema mantiene las 8 asignaciones de ayer | ✅ |
| "Asignaciones de Hoy" muestra solo asignaciones creadas hoy | Filtra por `created_at >= inicio del día (UTC)` | ⚠️ Usa UTC, no hora Argentina |
| "Modificar" opera sobre todas las asignaciones vigentes | No tiene filtro de fecha ni estado | ❌ Incluye visitados |
| Marcar "Visitado" excluye del circuito operativo | Se guarda en `visited_at` y cambia `estado` | ✅ |
| Limpieza nocturna de TODOS los visitados sin filtrar fecha | Solo limpia visitados creados HOY | ❌ |
| Cron ejecuta a las 23:00 hora Argentina | Ejecuta a las 23:00 UTC (20:00 ARG) | ❌ |

---

## Diagnóstico Detallado

### 1. Vista "Asignaciones de Hoy" - Problema de Zona Horaria

**Archivo:** `TodayAssignments.tsx` (líneas 91-96)

**Código actual:**
```typescript
const today = new Date();
const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
```

**Problema:** Usa `Date.UTC()` que calcula las 00:00 UTC, equivalente a las 21:00 del día anterior en Argentina. Esto puede causar que:
- Entre las 00:00 y 03:00 ARG se muestren asignaciones del día anterior
- Entre las 21:00 y 00:00 ARG no se muestren asignaciones del día actual

---

### 2. Vista "Modificar" (AssignmentsSelector) - Sin Filtro de Estado

**Archivo:** `AssignmentsSelector.tsx` (líneas 71-96)

**Código actual:**
```typescript
const { data, error } = await supabase
  .from('asignaciones_vendedores_clientes')
  .select(...)
  .order('created_at', { ascending: false });
```

**Problema:** No filtra por estado, por lo que incluiría asignaciones con estado "Visitado" si existieran. Según las reglas, debería mostrar solo asignaciones vigentes (no visitadas).

---

### 3. Edge Function de Limpieza - Filtro de Fecha Incorrecto

**Archivo:** `cleanup-visited-assignments/index.ts` (líneas 22-33)

**Código actual:**
```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);

const { data: deletedAssignments } = await supabase
  .from('asignaciones_vendedores_clientes')
  .delete()
  .eq('estado', 'Visitado')
  .gte('created_at', today.toISOString())  // ❌ Solo limpia visitados de HOY
  .select();
```

**Problema:** Solo elimina asignaciones visitadas creadas hoy. Si un vendedor marca como visitada una asignación de ayer, NO se limpiará nunca.

---

### 4. Cron Job - Hora Incorrecta

**Configuración actual:**
```sql
schedule: '0 23 * * *'  -- 23:00 UTC = 20:00 Argentina
```

**Problema:** El cron ejecuta a las 20:00 hora Argentina, 3 horas antes del cierre del día laboral esperado (23:00 ARG).

---

### 5. Preservación de Registros - OK

**Verificado:** El sistema preserva correctamente el historial de visitas:
- Los feedbacks se guardan en la tabla `cliente_feedbacks` con toda la información
- El campo `visited_at` registra el momento exacto de la visita
- Los datos de `vendedor_id`, `client_id`, `feedback`, `tipo_interaccion` quedan persistidos
- La tabla de supervisión puede consultar esta información históricamente

---

## Plan Técnico de Corrección

### Paso 1: Corregir Edge Function de Limpieza

**Archivo:** `supabase/functions/cleanup-visited-assignments/index.ts`

**Cambios:**
1. Eliminar el filtro `.gte('created_at', today.toISOString())`
2. Limpiar TODAS las asignaciones con estado "Visitado" sin importar fecha
3. Usar zona horaria Argentina para logging

**Código propuesto:**
```typescript
Deno.serve(async (req) => {
  // ... CORS handling ...

  // Calcular fecha actual en Argentina para logging
  const nowArg = new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log(`🧹 Limpieza iniciada: ${nowArg} (hora Argentina)`);

  // Eliminar TODAS las asignaciones visitadas (sin filtro de fecha)
  const { data: deletedAssignments, error } = await supabase
    .from('asignaciones_vendedores_clientes')
    .delete()
    .eq('estado', 'Visitado')
    .select();

  console.log(`✅ Eliminadas ${deletedAssignments?.length || 0} asignaciones visitadas`);
  // ...
});
```

---

### Paso 2: Actualizar Cron Job

**Acción:** Ejecutar SQL para actualizar la hora del cron a 02:00 UTC (23:00 Argentina)

```sql
SELECT cron.unschedule(1);

SELECT cron.schedule(
  'cleanup-visited-assignments',
  '0 2 * * *',  -- 02:00 UTC = 23:00 Argentina
  $$
  SELECT net.http_post(
    url:='https://ofwhxaglbcgyksauwjby.supabase.co/functions/v1/cleanup-visited-assignments',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body:=concat('{"timestamp": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
```

---

### Paso 3: Corregir Vista "Asignaciones de Hoy" (Zona Horaria)

**Archivo:** `TodayAssignments.tsx`

**Cambio:** Calcular el inicio del día en hora Argentina (UTC-3)

```typescript
// Calcular inicio del día en Argentina (UTC-3)
const now = new Date();
// Ajustar a Argentina sumando el offset de -3 horas
const argentinaOffset = -3 * 60; // minutos
const localOffset = now.getTimezoneOffset(); // minutos
const diffMinutes = argentinaOffset - (-localOffset);

const argentinaTime = new Date(now.getTime() + diffMinutes * 60 * 1000);
const startOfDayArg = new Date(Date.UTC(
  argentinaTime.getFullYear(),
  argentinaTime.getMonth(),
  argentinaTime.getDate(),
  3, 0, 0, 0  // 03:00 UTC = 00:00 Argentina
));
```

---

### Paso 4: Filtrar "Modificar" para Excluir Visitados

**Archivo:** `AssignmentsSelector.tsx`

**Cambio:** Agregar filtro para excluir asignaciones visitadas

```typescript
const { data, error } = await supabase
  .from('asignaciones_vendedores_clientes')
  .select(...)
  .neq('estado', 'Visitado')  // Excluir visitados
  .order('created_at', { ascending: false });
```

---

## Resumen de Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/cleanup-visited-assignments/index.ts` | Eliminar filtro de fecha, usar timezone Argentina |
| `src/components/assignor/TodayAssignments.tsx` | Calcular inicio del día en hora Argentina |
| `src/components/assignor/AssignmentsSelector.tsx` | Agregar `.neq('estado', 'Visitado')` |
| SQL Migration | Actualizar cron de `0 23 * * *` a `0 2 * * *` |

---

## Verificación de Preservación de Datos

**Confirmado:** No se pierde información al limpiar porque:

1. **Tabla `cliente_feedbacks`:** Guarda el registro permanente de cada visita con:
   - `vendedor_id`, `client_id` o `prospecto_place_id`
   - `feedback`, `tipo_interaccion`, `visita_realizada`
   - `created_at` (timestamp del momento)

2. **Campo `visited_at`:** Registra el momento exacto en que el vendedor marcó la visita

3. **Supervisión:** La vista `SupervisionVendedores` puede consultar históricamente usando filtros de `visited_at` para reportes

El proceso de limpieza solo elimina el registro de asignación (ya procesado), pero toda la información relevante queda preservada en las tablas de feedbacks y clientes.

