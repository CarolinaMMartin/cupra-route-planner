

# Diagnóstico: Por qué el filtro de vendedor no está funcionando

## Evidencia clave

Los logs muestran que **ambos vendedores reciben exactamente los mismos candidatos**: `4A 2I 5P 5Pot`. Si el filtro estricto estuviera activo, Pilar tendría **0 clientes en Palermo** (sus clientes están en Caballito y Avellaneda) y Pablo tendría solo **2** (BONVINO + EMPERADOR MEIJI).

Además, falta el log `👤 vendedor: X en zona, Y fuera, Z válidos` que la versión corregida debería imprimir. **La versión desplegada es la vieja, sin filtro estricto.**

## 3 bugs raíz identificados

### Bug 1: Edge Function no desplegada
El código con el filtro estricto (`isClientAffiliated`) fue escrito pero la versión en producción sigue siendo la anterior. Ambos vendedores reciben los 12 clientes de Palermo sin importar a quién pertenecen.

**Fix**: Forzar re-deploy con una modificación que garantice la actualización.

### Bug 2: Nombre del vendedor en Excel ≠ Nombre en perfil
- Excel: `"PILAR CARELLI"` → se guarda en `clientes.vendedor_principal`
- Perfil: `"María del Pilar Carelli"`
- La query de `portfolioClients` usa `todos_vendedores.cs.{"María del Pilar Carelli"}` (containment exacto), que **no matchea** `["PILAR CARELLI"]`.
- Resultado: la búsqueda de cartera fuera de zona **no encuentra nada**.

**Fix**: Cargar TODOS los perfiles de vendedores al inicio. Construir un mapa `nombre_excel → user_id` cruzando `ventas_cupra.vendedor` con `profiles.nombre` via `resolveSellerUUID`. Usar ese mapa para la query de portfolio en vez de nombres exactos del perfil.

### Bug 3: `sellerNameMap` solo contiene vendedores seleccionados
Cuando se evalúa si DON JULIO pertenece a Leandro, `resolveSellerUUID("LEANDRO MUTUVERRIA")` retorna `null` porque Leandro no está en el mapa (solo Pablo y Pilar). Si bien el resultado final es correcto (null ≠ pabloId → no afiliado), esto impide lógica futura como "este cliente pertenece a OTRO vendedor conocido, no asignar".

**Fix**: Cargar TODOS los vendedores activos en `sellerNameMap`, no solo los seleccionados.

## Sobre "Secuestro de Cartera"
Los datos confirman:
- DON JULIO → `vendedor_actual: LEANDRO MUTUVERRIA`, `todos_vendedores: [LEANDRO MUTUVERRIA]`
- MARKEN → `vendedor_actual: LUCAS MUTUVERRIA`, `todos_vendedores: [LUCAS MUTUVERRIA]`

El sistema los asignó porque NO aplica el filtro. Con el fix, estos clientes quedarían **excluidos** de Pablo y Pilar (pertenecen a otros vendedores). Solo recibirían prospectos nuevos en la zona.

## Plan de implementación

### 1. `generate-recommendations/index.ts`

1. **Cargar TODOS los perfiles** al inicio (no solo los seleccionados). Usar todos para `sellerNameMap`.
2. **Fix query de portfolio**: En vez de `todos_vendedores.cs.{"nombre_perfil"}`, iterar `ventas_cupra` agrupado por vendedor para obtener los `client_id` de cada vendedor, o simplemente usar `isClientAffiliated` en JS sobre un pool más amplio de clientes.
3. **Logging robusto**: Agregar `👤 vendedor: X en zona, Y fuera, Z válidos` + `🔍 DON JULIO excluido: pertenece a LEANDRO MUTUVERRIA`.
4. **Verificar deploy**: Agregar un `console.log("🔧 Version: v5-strict-filter")` al inicio para confirmar versión en producción.

### 2. Recencia estática
`dias_desde_ultima_compra` se calcula al subir el Excel y no cambia después. Esto es correcto por diseño (se recalcula con cada nueva carga). Si el usuario reportó "15 días" para VINOTECA EZEQUIEL, podría ser confusión visual — la DB muestra 343 días (PERDIDO), que es correcto.

### Archivos a modificar
| Archivo | Cambio |
|---------|--------|
| `supabase/functions/generate-recommendations/index.ts` | Cargar todos los perfiles, fix portfolio query, logging, version tag |

