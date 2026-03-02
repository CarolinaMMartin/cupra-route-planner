
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

---

# Phase 2: Rediseño UX/UI del Panel de Asignación — IMPLEMENTADO

## Cambios realizados

### A. Tabs principales ✅
- Panel reorganizado con dos tabs: "Nueva Asignación" y "Asignaciones de Hoy"
- Asignaciones de hoy ahora visibles desde el primer clic (antes estaban enterradas)

### B. FilterPanel con dos modos ✅
- Modo "Por Área": selector de área → ver resumen → generar
- Modo "Personalizado": vendedores colapsables + filtros geográficos compactos
- Instrucciones IA colapsables en ambos modos
- Vendedores en Collapsible con badge "X de Y seleccionados"

### C. RecommendationFilters simplificado ✅
- De 6 filtros redundantes a solo 1 filtro por vendedor
- Se muestra solo cuando hay más de 1 vendedor

### D. TodayAssignments sin Card wrapper ✅
- Funciona como contenido directo del tab
- Layout más limpio sin doble Card

## Archivos modificados
| Archivo | Cambio |
|---------|--------|
| `src/components/AssignorDashboard.tsx` | Tabs, imports limpiados |
| `src/components/assignor/FilterPanel.tsx` | Dos modos (Area/Personalizado), vendedores colapsables |
| `src/components/assignor/RecommendationFilters.tsx` | Solo filtro por vendedor |
| `src/components/assignor/TodayAssignments.tsx` | Sin Card wrapper, layout directo |

## Próximos pasos potenciales
- Planificación temporal (agenda semanal)
- Reportes y supervisión
- Pipeline ETL directo sin n8n
- Agente conversacional
