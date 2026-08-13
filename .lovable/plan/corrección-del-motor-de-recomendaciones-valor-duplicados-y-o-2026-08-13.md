# Corrección del motor de recomendaciones: valor, duplicados y orden de decisión

Tu diagnóstico es correcto en los cinco puntos. Esto es lo que hay que cambiar, en orden de gravedad.

## 1. Zona primero → cuentas primero (el problema de fondo)

Hoy el motor fija el núcleo geográfico del vendedor **antes** de mirar la cartera, y después busca qué hay adentro. Por eso "0 de cartera activa" es una afirmación de zona presentada como afirmación de vendedora.

Nuevo orden:

```text
1. RANKEAR ACCIONES a nivel vendedora (toda su cartera, sin filtro geográfico)
   defender  = activo con días/cadencia >= 1        (PALANTI: 33/13 = 2,5)
   reactivar = dormido/perdido con valor relevante
   prospectar= solo para completar
2. TOMAR EL TOP N (~20-25 acciones)
3. CLUSTERIZAR ese top N geográficamente y elegir el cluster
   que maximice valor recuperable dentro de 2,5 km
4. COMPLETAR el día dentro de ese cluster
```

Regla nueva: si el cluster elegido no llega a **4 cuentas propias**, el motor **cambia de cluster**, no rellena con prospectos fríos. Solo si ningún cluster del vendedor llega a 4 se admite ruta mixta, y el aviso lo dice como lo que es: "en esta zona no hay cartera; tu mejor zona hoy es X".

Cuando el asignador filtra una zona a mano, el filtro se respeta, pero el aviso compara contra el ranking global: "filtraste Villa Ortúzar; ahí tenés 2 cuentas. PALANTI HISTÓRICA (Palermo) está vencida al doble de su cadencia y no entra en este filtro."

## 2. Score que discrimina

Reemplazo del score plano actual (todo daba 1) por:

```text
prioridad = valor_histórico
          × (días_sin_comprar / cadencia_propia)
          × margen_realizado
          × factor_distancia
```

- `cadencia_propia`: promedio de días entre órdenes del cliente, calculado en el ETL y guardado en `clientes`. Sin cadencia propia (1 sola orden) se usa la mediana del canal.
- `margen_realizado`: precio promedio por caja del cliente contra el del canal.
- `factor_distancia`: 1/(1+km al núcleo del cluster).

Efecto directo: PALANTI ($10,4M, 33 días sobre cadencia 13) queda muy por encima de las dos cuentas de $1,79M que hoy motivaron la ruta.

## 3. El campo "$": una sola escala, etiquetada, con flag de NC

Confirmado el cruce de universos: las ventas del archivo vienen filtradas a CUPRA (61% del total facturado) y las notas de crédito vienen de todas las marcas. Por eso LA CAVA DE RITA da negativo.

Cambios:

- El importe de la tarjeta pasa a ser **ticket promedio bruto CUPRA** (ventas CUPRA / órdenes CUPRA). Numerador y denominador en el mismo universo. Se elimina la resta de NC de ese campo.
- Las notas de crédito dejan de mezclarse: se guardan aparte (`monto_notas_credito`, `ratio_nc`) y no contaminan el ticket.
- El campo se muestra **etiquetado**: "Ticket prom. $204.000" en vez de "$".
- Flag visible en la tarjeta cuando `NC / facturado > 30%`: "Devolución del 60% de lo facturado el 28/11/2025 — verificar antes de visitar", con la fecha de la NC. Para LA CAVA DE RITA es NC total del mismo día.

## 4. Gate prospecto ↔ cartera (Vinoteca Masis)

Hoy el filtro anti-duplicado exige coincidencia de nombre **y** menos de 100 m. Masis está a 870 m, así que pasó como prospecto frío estando activo con Leandro hace 20 días.

Nuevo gate, sobre nombre de fantasía normalizado (sin acentos, sin razón social, sin "vinoteca/bodega/almacén"):

```text
mismo nombre normalizado + < 200 m   → se descarta, es el mismo negocio
mismo nombre normalizado + 200-800 m → NO se ofrece como prospecto nuevo:
                                       se etiqueta "posible cliente existente — verificar"
                                       y se indica de qué vendedor y hace cuánto compró
mismo nombre + mismo barrio          → misma regla que arriba
```

Un prospecto marcado así nunca cuenta para el cupo de prospectos ni se le pide visita en frío.

## 5. Normalización de zonas

`Parque Chas / VILLA URQUIZA / Villa Ortúzar / Villa Urquiza` son 3, no 4. Se normaliza (trim, título, sin acentos para comparar) antes de agrupar, tanto en el resumen como en los avisos.

## 6. Calidad de prospectos de Google

- Descartar lugares con menos de **15 reseñas**: un 5.0 con 3 reseñas no es señal de potencial.
- Descartar tipos incoherentes con el canal mayorista (`tourist_attraction`, centros culturales, `night_club`, `cafe` sin venta de botella). Se prioriza `liquor_store`, `wine_bar` con reseñas, restaurantes con carta de vinos.
- El ranking de prospectos deja de usar rating como proxy de potencial: pasa a ser `min(reseñas, 200)` ponderado, y el rating solo actúa como filtro de piso (>= 3,8).

## Detalle técnico

- `supabase/functions/process-ventas-excel/index.ts`: dejar de netear NC dentro de `monto_total_historico`; agregar `monto_notas_credito`, `fecha_ultima_nc`, `cadencia_dias` y `precio_promedio_caja` al agregado de `clientes`.
- Migración: nuevas columnas en `clientes` (`monto_notas_credito`, `fecha_ultima_nc`, `cadencia_dias`, `precio_promedio_caja`) + backfill desde `ventas_cupra`.
- `supabase/functions/generate-recommendations/index.ts`: invertir el pipeline (ranking de cartera → clusterizado → cupos), nuevo `prioridad`, gate de matching prospecto↔cartera, filtros de calidad de Google, normalización de barrios en el resumen.
- `recommendation-composition.ts`: regla "cambiar de cluster antes que rellenar con prospectos".
- `ResultsList.tsx` / `AIInsightsCard.tsx`: importe etiquetado, flag de NC, chip "posible cliente existente — verificar", avisos comparando zona filtrada contra ranking global.
- Tests: cadencia y prioridad con los casos reales (PALANTI vs FUEGOS), NC de LA CAVA DE RITA, Masis a 870 m, dedupe de barrios.

## Fuera de alcance

- No se toca la asignación manual ni la asignación por área.
- No se cambia el esquema de prospectos ni el flujo de descubrimiento en sí, solo sus filtros de calidad.
