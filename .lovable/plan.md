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

---

# Phase 3: Carga de Excel + ETL integrado — IMPLEMENTADO

## Cambios realizados

### A. Edge Function `process-ventas-excel` ✅
- Recibe `{ rows: [...] }` parseadas en frontend con SheetJS
- **Normalización de campos**: `getFieldValue()` con matching exacto, case-insensitive y NFD-normalized
- **Conversión de fechas**: Excel serial → ISO, DD/MM/YYYY → ISO
- **Conversión de montos**: Formato argentino (puntos miles, coma decimal)
- **Geografía CABA**: 48 barrios mapeados a 15 comunas + detección PBA/GBA
- **Agregación RFM por cliente**: Primera/última compra, días inactividad, scores recencia/volumen/comercial
- **Canal**: Detección ON_TRADE vs OFF_TRADE por categorías
- **Upsert ventas_cupra**: Batches de 500, conflict key existente
- **Upsert clientes protegido**: No sobreescribe `last_recommendation_at`, `excluir_recomendaciones`, `ultima_visita`

### B. Página `CargaDatos.tsx` ✅
- Acceso restringido a rol `asignador`
- Drop zone + file input para `.xlsx` / `.xls`
- Parseo client-side con `xlsx` (SheetJS)
- Preview: columnas detectadas + primeras 5 filas
- Progreso visual durante procesamiento
- Resumen final: ventas procesadas, clientes actualizados, errores

### C. Navegación ✅
- Ruta `/carga-datos` en `App.tsx`
- Menú "Gestión" del asignador: nuevo item "Carga de Datos"

## Archivos creados/modificados
| Archivo | Cambio |
|---------|--------|
| `supabase/functions/process-ventas-excel/index.ts` | Creado — ETL completo |
| `src/pages/CargaDatos.tsx` | Creado — UI de upload |
| `src/App.tsx` | Ruta `/carga-datos` |
| `src/pages/Index.tsx` | Menú con "Carga de Datos" |
| `supabase/config.toml` | Función registrada |
| `package.json` | Dependencia `xlsx` |

## Próximos pasos potenciales
- Planificación temporal (agenda semanal)
- Reportes y supervisión
- Agente conversacional

