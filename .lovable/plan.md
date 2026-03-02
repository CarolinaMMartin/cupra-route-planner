
# Phase 1: Motor de Recomendaciones Centrado en Vendedor — IMPLEMENTADO

## Cambios realizados

### A. DB: Campo `vendedor_actual` en `clientes` ✅
- Nuevo campo `vendedor_actual` (text) agregado
- Inicializado desde la última venta registrada en `ventas_cupra`
- Se actualiza automáticamente en `upsert-clientes` (campo agregado a `camposVentas`)

### B. Pre-scoring determinístico ✅
- Función `preScoreCandidates()` calcula scores numéricos ANTES de llamar a la IA
- **score_geo (50%)**: Distancia Haversine al centroide del cluster
- **score_vendedor (25%)**: Afinidad vendedor-cliente via `vendedor_actual` + mapeo nombre→UUID
- **score_comercial (15%)**: Score comercial normalizado (0-100)
- **score_rotacion (10%)**: Días desde última recomendación
- Filtra candidatos con feedback negativo automáticamente
- Envía top 20 clientes + 10 prospectos pre-rankeados por vendedor

### C. Mapeo nombre→UUID ✅
- `buildSellerNameMap()` crea mapa bidireccional nombre↔UUID
- `resolveSellerUUID()` con matching exacto + normalizado + fuzzy
- Resuelve "LEANDRO MUTUVERRIA" → `395f12ee-...` determinísticamente

### D. Prompt reducido centrado en vendedor ✅
- De ~65K chars a ~5-10K chars (reducción ~80%)
- Formato tabular compacto con scores pre-calculados
- IA solo decide ruta óptima y genera justificaciones
- System prompt simplificado: "seleccioná 8 de los pre-rankeados"

### E. UI: Vendedor actual vs anterior ✅
- `ClientDetailCard` compact view: muestra vendedor actual + anterior (si difiere)
- `ClientDetailCard` full view: sección vendedores actualizada con indicador naranja
- Tipo `Sucursal` extendido con `vendedor_actual`

## Archivos modificados
| Archivo | Cambio |
|---------|--------|
| `supabase/functions/generate-recommendations/index.ts` | Reescrito: pre-scoring + prompt reducido + mapeo nombre→UUID |
| `supabase/functions/upsert-clientes/index.ts` | `vendedor_actual` agregado a `camposVentas` |
| `src/components/assignor/ClientDetailCard.tsx` | Vendedor actual/anterior en compact y full views |
| `src/types/sales.ts` | `vendedor_actual` agregado a `Sucursal` |

## Próximos pasos potenciales
- Planificación temporal (agenda semanal)
- Reportes y supervisión
- Pipeline ETL directo sin n8n
- Agente conversacional
