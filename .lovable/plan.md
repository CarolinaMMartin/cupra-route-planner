

# Plan: CUPRA Smart Route v4 — Con ajustes de robustez

## Resumen

Refactorización completa del motor de recomendaciones con clasificación por estado comercial, algoritmo de anclaje geográfico, distribución 5-1-1-1, y marcadores por estado con identificación de vendedor. Incorpora tres ajustes clave del usuario.

---

## Fase 1: Vista SQL `v_clientes_priorizacion`

Migración SQL que crea una vista combinando `clientes` + `prospectos` + `ventas_cupra`.

**Clasificación**: ACTIVO (<30d), INACTIVO (31-90d), PERDIDO (>90d), POTENCIAL (prospectos)

**Afinidad vendedor**: JOIN con `ventas_cupra` agrupado por `client_id` + vendedor, rankeado por facturación. **Ajuste de normalización**: usar `UPPER(UNACCENT(vendedor))` en el JOIN contra `UPPER(UNACCENT(profiles.nombre))` para resolver variaciones como "PABLO MANZOCCHI" vs "Pablo Manzócchi".

> Nota: Se necesita habilitar la extensión `unaccent` en la migración (`CREATE EXTENSION IF NOT EXISTS unaccent`).

**Barrios top por vendedor**: CTE con top 3 barrios por facturación por vendedor.

Campos: `entity_id, razon_social, estado_comercial, es_prospecto, vendedor_afin_id, vendedor_afin_nombre, lat, long, barrio, dias_desde_ultima_compra, monto_total_historico, score_comercial`

---

## Fase 2: Refactorización Edge Function

### 2.1 Eliminar lógica obsoleta
- Remover cálculo de `centerLat`/`centerLong` (lineas 98-119)
- Remover filtro de 15 días de ventas recientes (lineas 385-393)

### 2.2 Algoritmo "Anclaje y Magnéticos"

Reescribir `preScoreCandidates` con nueva firma que recibe `allVendorAnchors: Map<string, {lat,lng}[]>`:

1. Clasificar cada cliente por `dias_desde_ultima_compra` → ACTIVO/INACTIVO/PERDIDO
2. Identificar Anclas: Top 5 ACTIVOS del vendedor por volumen con coordenadas
3. `score_geo` = distancia al ancla más cercana (no al centroide)
4. Penalización: candidato < 300m de ancla de OTRO vendedor → -100 puntos

### 2.3 Cubetas por vendedor

Enviar 30 candidatos a la IA:
- 15 Activos (mayor afinidad + volumen)
- 5 Inactivos
- 5 Perdidos
- 5 Potenciales (prospectos cercanos a anclas)

### 2.4 Procesamiento multi-vendedor

Calcular anclas de todos los vendedores primero, luego pasarlas a `preScoreCandidates` para penalización cruzada.

### 2.5 Consultar la vista

Reemplazar queries separadas a `clientes` + `prospectos` por `v_clientes_priorizacion` cuando sea posible, simplificando el código.

---

## Fase 3: Nuevo System Prompt + Modelo

**Modelo**: `google/gemini-2.5-flash` (el más avanzado disponible en el gateway con buen razonamiento, ya usado actualmente — NO cambiar a "gemini-3" que no es estándar).

**Nuevo prompt** con cuota estricta 5-1-1-1:

```
"Eres el Planificador Estratégico de CUPRA. Armá una ruta de EXACTAMENTE 8 paradas para [VENDEDOR].
REGLAS:
1. Cuota 5-1-1-1: 5 Activos + 1 Inactivo + 1 Perdido + 1 Potencial
2. Densidad: Priorizá puntos cerca de los Activos elegidos. Rutas densas.
3. Identidad: [VENDEDOR] es fuerte en [BARRIOS_TOP]. Respetá su territorio.
4. Justificación: Para Inactivo/Perdido/Potencial explicá por qué hoy.
5. Transferencia: Si el cliente era de otro vendedor, mencionalo."
```

Incluir `estado_comercial` y `barrios_top` del vendedor en el contexto.

---

## Fase 4: Validación post-IA

- Verificar exactamente 8 recomendaciones por vendedor
- Verificar distribución 5-1-1-1
- Si falla: completar determinísticamente desde las cubetas sobrantes
- Verificar que todos los `client_id` existan en la lista enviada

---

## Fase 5: Frontend — Marcadores por estado + identificación vendedor

### 5.1 Tipo `Sucursal`: agregar `estado_cliente`

```typescript
estado_cliente?: 'ACTIVO' | 'INACTIVO' | 'PERDIDO' | 'POTENCIAL'
```

### 5.2 `vendorColors.ts`: funciones de color por estado

| Estado | Relleno |
|--------|---------|
| ACTIVO | `#22c55e` (verde) |
| INACTIVO | `#eab308` (amarillo) |
| PERDIDO | `#ef4444` (rojo) |
| POTENCIAL | `#3b82f6` (azul) |

Nuevo `createStateMarkerIcon(estado, vendorColor?, scale)`:
- **Relleno** = color del estado (semáforo comercial)
- **Borde** = color del vendedor (de la paleta existente de 12 colores)
- Esto resuelve el ajuste del usuario: en el mapa del Asignador (multi-vendedor) se ve el estado por relleno Y el vendedor por borde

```text
SVG: círculo con fill=estadoColor, stroke=vendorColor (3px), punto blanco central
```

### 5.3 Mapas actualizados

- **`ResultsMap.tsx`** (Asignador, multi-vendedor): marcadores con relleno=estado + borde=vendedor. Leyenda doble: estados (colores) + vendedores (bordes). Detección solapamiento < 200m entre vendedores distintos → badge "⚠️ Solapamiento".
- **`VendedorAssignmentsMap.tsx`** (Vendedor, mono-vendedor): marcadores solo por estado (sin borde de vendedor, porque es uno solo).
- **`AssignorTodayAssignmentsMap.tsx`**: marcadores con relleno=estado + borde=vendedor.

### 5.4 `AssignorDashboard.tsx`

Mapear `estado_cliente` desde la respuesta de la edge function (campo nuevo que la función incluirá basado en `dias_desde_ultima_compra`).

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| Migración SQL | Extensión `unaccent` + Vista `v_clientes_priorizacion` con normalización NFD |
| `supabase/functions/generate-recommendations/index.ts` | Anclas, cubetas, nuevo prompt 5-1-1-1, validación, modelo `gemini-2.5-flash` (sin cambio), `estado_comercial` en respuesta |
| `src/types/sales.ts` | `estado_cliente` en `Sucursal` |
| `src/lib/vendorColors.ts` | `getStateColor()`, `createStateMarkerIcon(estado, vendorColor?, scale)` |
| `src/components/AssignorDashboard.tsx` | Mapear `estado_cliente` |
| `src/components/assignor/ResultsMap.tsx` | Marcadores estado+vendedor, leyenda doble, solapamiento |
| `src/components/vendedor/VendedorAssignmentsMap.tsx` | Marcadores por estado |
| `src/components/assignor/AssignorTodayAssignmentsMap.tsx` | Marcadores estado+vendedor |

