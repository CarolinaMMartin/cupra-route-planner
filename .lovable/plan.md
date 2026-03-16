

# Diagnóstico y Plan: Distribución 8 por vendedor + "Desconocido"

## Diagnóstico

### Bug 1: "Desconocido" en distribución por vendedor

**Causa raíz:** Desajuste de IDs entre frontend y backend.

- `FilterPanel.tsx` línea 102: carga perfiles y usa `v.id` (PK de tabla `profiles`) como identificador.
- `AssignorDashboard.tsx` línea 100: construye `vendedoresData` con esos mismos `profile.id` como `{ id, nombre }`.
- La Edge Function devuelve `vendedor_recomendado_id` usando `user_id` (FK a `auth.users`), NO `profile.id`.
- `AIInsightsCard.tsx` línea 17: busca `vendedores.find(v => v.id === id)` — compara `profile.id` contra `user_id` → nunca matchea → "Desconocido".

**Fix:** En `FilterPanel.tsx`, usar `user_id` en vez de `id` al construir los datos de vendedores. O alternativamente, en `AssignorDashboard.tsx` mapear correctamente.

### Bug 2: No llega a 8 por vendedor (25 en vez de 32)

**Causa raíz:** El pool de candidatos es insuficiente. El sistema actual:

1. Carga clientes en zona geográfica (barrios/comunas seleccionados)
2. Carga portfolio del vendedor fuera de zona (fallback)
3. Carga prospectos en zona
4. Filtra por cartera del vendedor (solo sus clientes)
5. Arma buckets: máx 15 activos, 5 inactivos, 5 perdidos, 5 potenciales

**Problema:** Si un vendedor tiene pocos clientes en la zona seleccionada Y pocos prospectos disponibles, los buckets quedan vacíos y `validateAndFixDistribution` no puede completar a 8.

**Ejemplo concreto:** Si Ignacio tiene 6 clientes propios en la zona y solo hay 1 prospecto disponible → máximo 7, no 8.

### Solución propuesta: Lógica "Barrio Concentración + Completar con Prospectos"

El eje nuevo es: **para cada vendedor, encontrar dónde tiene más concentración y asegurar 8 visitas SÍ O SÍ.**

## Plan de cambios

### 1. Fix "Desconocido" — `FilterPanel.tsx`
- Cambiar línea 102 para usar `user_id` en vez de `id`:
  ```
  const mapped = (data || []).map(v => ({ id: v.user_id, nombre: v.nombre, email: v.email }));
  ```
- Esto alinea todos los IDs del flujo con `user_id`, que es lo que usa la Edge Function.

### 2. Garantizar 8 por vendedor — Edge Function `generate-recommendations`

**Cambios en la lógica de carga de candidatos (paso 8, per-vendor):**

a. **Detectar barrio de concentración del vendedor:** Antes de armar buckets, agrupar los clientes del vendedor por barrio y encontrar el "barrio top" (donde tiene más clientes activos).

b. **Expandir pool de prospectos por vendor:** Si después de armar buckets el total es < 8, cargar prospectos adicionales del barrio de concentración del vendedor (sin límite de los filtros geográficos originales del request).

c. **Fallback agresivo en `validateAndFixDistribution`:** Si después de la IA + validación sigue sin llegar a 8:
   - Buscar más prospectos del barrio top del vendedor
   - Si aún faltan, buscar prospectos de barrios adyacentes (misma provincia)
   - Crear candidatos "potenciales" sintéticos si es absolutamente necesario (último recurso)

d. **Relajar la regla 5-1-1-1 como fallback:** Si no hay inactivos/perdidos suficientes, la regla pasa a ser "completar con la categoría disponible más cercana". Esto ya está parcialmente implementado (línea 374-395) pero necesita ser más agresivo con prospectos.

**Cambios específicos en el código:**

1. **Nuevo paso "8b"** después de `preScoreCandidates`: Contar candidatos totales por vendor. Si < 8, hacer una query adicional de prospectos en el barrio top del vendor (o barrios cercanos a sus anchors).

2. **Modificar `validateAndFixDistribution`**: Recibir el pool completo de prospectos como parámetro adicional. Si después de intentar llenar con buckets existentes sigue < 8, iterar sobre prospectos ordenados por distancia a los anchors del vendor.

3. **Prompt ajustado**: Agregar instrucción "Si una categoría no tiene candidatos suficientes, completá con POTENCIAL/PROSPECTO hasta llegar a 8. NUNCA devuelvas menos de 8 por vendedor."

### 3. Fix secundario: `AssignorDashboard.tsx`
- Actualizar `setVendedoresData` para que use los mismos IDs que vienen del FilterPanel (ya corregidos con `user_id`).

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/components/assignor/FilterPanel.tsx` | Usar `user_id` en vez de `id` |
| `supabase/functions/generate-recommendations/index.ts` | Expandir pool de prospectos per-vendor, garantizar 8 |
| `src/components/assignor/AIInsightsCard.tsx` | Sin cambios (se arregla solo con el fix de IDs) |

