
Diagnóstico detallado (estado actual, con evidencia)

1) El filtro por vendedor NO es estricto (causa principal)
- En `generate-recommendations`, hoy se filtra fuerte por geografía (`client_places`, `prospectos`) pero NO por vendedor al armar candidatos.
- SQL efectivo actual:
  - `client_places` por barrio/comuna/provincia
  - `clientes` por `client_id IN zona`, `excluir_recomendaciones=false`, `monto_total_historico not null`
  - `prospectos` por zona (hasta 200)
- Luego el vendedor solo pesa en `score_vendedor` (25%), pero no excluye cartera ajena.
- Resultado real visto en DB (última corrida `c1a8be75...`):
  - Palermo: 20 clientes vs 205 prospectos.
  - Para Pablo: 8 recomendaciones, 0 activos, 0 inactivos, 4 perdidos, 4 potenciales.
  - Para Pablo, 0 clientes recomendados con vendedor actual/principal Pablo.

2) Se está pasando demasiado contexto “contaminado” a la IA
- El prompt recibe buckets por vendedor, pero buckets construidos desde un universo compartido (no estricto por vendedor).
- Logs: ambos vendedores entran con conteos similares (4A/2I/5P/5Pot), luego la selección se degrada.
- Faltan validaciones duras antes de IA para “cliente pertenece a Pablo/Pilar”.

3) Duplicados “mismo lugar” siguen siendo posibles
- La deduplicación global actual es por `client_id`/`place_id`, no por lugar real.
- Caso real detectado: “DON JULIO - CHICO SRL” (cliente) y “Don Julio Parrilla” (prospecto) ~60m (mismo lugar práctico).
- También existe bug de unicidad en validación IA: no se descartan explícitamente picks repetidos del mismo `client_id` dentro del mismo vendedor (explica warning React de keys duplicadas).

4) Valores comerciales aún inconsistentes
- Aunque se arregló el parser monetario, hay desalineación fuerte:
  - `sum(clientes.monto_total_historico)=437.464.738,86`
  - `sum(ventas_cupra.facturacion_ars)=267.087.553,38`
- Causa técnica: `process-ventas-excel` agrega métricas de clientes ANTES de deduplicar ventas; luego `ventas_cupra` se upsertea deduplicada.
- Resultado: ranking comercial/anclas se sesgan.

5) “N/A” en clientes
- Hay clientes recomendados con `monto_total=0`, `cantidad_ordenes=0`, `ultima_compra null` (ej. `client_id=40`), que pasan filtros actuales.
- En UI además hay checks falsy (`if (!value)`) que muestran `N/A` para cero.

Qué se le está pasando hoy a la IA
- Secciones por vendedor con candidatos y campos:
  - `estado`, `score`, `distancia`, `barrio`, `vendedor_actual`, `días`, `ticket`, feedback.
- Problema: esos candidatos no vienen prefiltrados de forma estricta por cartera del vendedor, por eso “analiza bien” sobre un input mal armado.

Plan de corrección (diagnóstico -> solución)

Fase A — Filtro estricto previo a IA (núcleo)
1. En backend, separar universo por vendedor ANTES de score:
   - `clientes` del vendedor: match por `vendedor_actual`/`vendedor_principal`/`todos_vendedores` normalizados (unaccent+upper).
   - Geografía en AND (vendedor + Palermo), no solo barrio global.
2. Si no alcanza cuota 5-1-1-1, fallback controlado:
   - primero cartera histórica del vendedor en zona cercana,
   - luego prospectos cercanos a anclas del vendedor (no cualquier prospecto).

Fase B — Deduplicación real de lugares
3. Excluir prospectos que representen clientes existentes:
   - por `prospectos.client_id` cuando exista,
   - y por similitud nombre + distancia (<100m) contra clientes candidatos.
4. En validación post-IA, bloquear duplicados por `client_id/place_id` y por “fingerprint de lugar” (nombre normalizado + geohash/buffer).

Fase C — Corrección de datos comerciales
5. Ajustar ETL para calcular métricas de `clientes` desde ventas ya deduplicadas (misma base que `ventas_cupra`).
6. Recalcular clientes completos (rebuild) y recién ahí regenerar recomendaciones.
   - Si querés, hacemos limpieza controlada + nueva carga de Excel luego del fix.

Fase D — Robustez UX/validación
7. Excluir de recomendación clientes sin ventas reales (`cantidad_ordenes>0`, `ultima_compra not null`) salvo modo explícito.
8. Corregir UI para que 0 no se renderice como `N/A`.
9. Agregar trazas de auditoría por request:
   - “candidatos iniciales”, “candidatos tras filtro vendedor”, “enviados a IA”, “descartados por duplicado”.

Archivos a intervenir en implementación
- `supabase/functions/generate-recommendations/index.ts` (filtros estrictos, dedup semántica, validación anti-duplicados)
- `supabase/functions/process-ventas-excel/index.ts` (agregación desde ventas deduplicadas)
- SQL de soporte (normalización/unaccent y posible helper de matching semántico)
- `src/components/assignor/ClientDetailCard.tsx` (render de 0 vs N/A)
- `src/components/AssignorDashboard.tsx` (id único robusto para lista/preselección)
