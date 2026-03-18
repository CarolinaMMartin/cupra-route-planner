

# Plan: Dar prioridad real a las instrucciones del usuario en el motor de recomendaciones

## Problema

Cuando el usuario escribe instrucciones adicionales (ej: "priorizar restaurantes ON_TRADE", "solo clientes que compran Malbec"), el sistema las ignora en la práctica por **dos razones**:

1. **Posición débil en el prompt**: Las instrucciones se agregan al final del prompt como un apéndice menor (línea 867), después de toda la lista de candidatos. La IA puede no darles suficiente peso.

2. **`validateAndFill` descarta las selecciones de la IA**: Esta función (líneas 390-481) reconstruye la lista desde cero siguiendo su propia lógica rígida (Activos→Perdidos→Prospectos por score), sin respetar qué candidatos eligió la IA. Si la IA seleccionó un cliente específico porque matchea la instrucción del usuario, `validateAndFill` lo puede reemplazar por otro con mayor score genérico.

## Cambios

### 1. Elevar las instrucciones en el prompt (Edge Function)

**Archivo**: `supabase/functions/generate-recommendations/index.ts`

Mover `instrucciones_adicionales` **ANTES** de las secciones de vendedores y darle un encuadre de máxima prioridad:

```
INSTRUCCIONES DEL CLIENTE (PRIORIDAD MÁXIMA):
{instrucciones_adicionales}
Estas instrucciones tienen prioridad sobre las reglas de composición estándar.
Seleccioná candidatos que cumplan estos criterios PRIMERO.
```

### 2. Respetar las selecciones de la IA en `validateAndFill`

**Archivo**: `supabase/functions/generate-recommendations/index.ts`

Cambiar la lógica de validación para que:

1. **Primero** acepte los picks de la IA que son válidos (existen en los pools, no duplicados) — hasta 8
2. **Después** complete slots faltantes con la lógica de composición (Active→Lost→Prospects)
3. **Solo rebalancee** si la composición viola reglas duras (ej: 0 prospectos teniendo disponibles)

Esto significa que si la IA eligió 6 restaurantes porque el usuario pidió "solo restaurantes", esos 6 se respetan y solo se completan los 2 slots restantes con la lógica automática.

### 3. Pasar instrucciones al system prompt también

Incluir las instrucciones del usuario en el `RECOMMENDATION_SYSTEM_PROMPT` dinámicamente, para que la IA las tenga como contexto de sistema y no solo como texto del usuario.

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/generate-recommendations/index.ts` | Reposicionar instrucciones en prompt, refactorizar `validateAndFill` para respetar picks de la IA |

## Lógica nueva de `validateAndFill`

```text
1. Aceptar AI picks válidos (en pool + no duplicados) → hasta 8
2. Contar composición actual (activos, perdidos, prospectos)
3. Si prospectos < 2 y hay disponibles → swap último perdido por prospecto
4. Si perdidos == 0 y hay disponibles → swap último prospecto por perdido  
5. Si total < 8 → completar con lógica estándar (Active→Lost→Prospect)
```

La diferencia clave: hoy la función **descarta** los picks de la IA y reconstruye desde cero. Con el cambio, **respeta** los picks y solo ajusta composición mínima.

