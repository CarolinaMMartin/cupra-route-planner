# Rediseño del criterio de armado de las 8 visitas

## Qué se observó en el pedido de Pilar (Comuna 14)

De los logs y de las recomendaciones guardadas de esa corrida:

- En la zona filtrada había 10 direcciones de clientes y **solo 1 era cliente propio de Pilar**.
- El motor amplió el radio en cascada (1,2 → 1,8 → 2,2 → 3 km) y después "rescató" cartera hasta 5 km: entraron clientes a **4,1 km y 4,3 km**, fuera de una ruta caminable.
- Resultado: 3 clientes + 5 prospectos, con dos puntos claramente descolgados.
- Las justificaciones que ve el asignador están escritas en lenguaje del motor: "hotspot", "0.4km", "score 76", "score_proximidad 100". Eso no explica una decisión comercial.

Es decir: el motor cumplió la cuota de 8, pero **no comunicó el problema real** (la zona no tenía cartera para ese vendedor) y estiró la ruta en vez de avisarlo.

## Criterio objetivo de las 8 visitas (nuevo)

Composición ideal por vendedor y por día:

```text
4  CARTERA ACTIVA      clientes propios que compran con regularidad
2  REACTIVACIÓN        dormidos (31-90 días) o perdidos (+90 días)
2  PROSPECTOS          lugares nuevos cercanos, sin historia
── 
8  visitas
```

Reglas de sustitución, en este orden, cuando un bloque no se llena:

1. Falta cartera activa → se completa con reactivación.
2. Falta reactivación → se completa con cartera activa.
3. Falta cualquier cliente propio → se completa con prospectos.
4. Faltan prospectos en base → se buscan en Google Maps en el mismo radio.

**La ruta compacta manda sobre la mezcla.** Ningún punto entra si rompe la compacidad: se define un radio operativo de ~2,5 km alrededor del núcleo del vendedor y una separación máxima entre extremos de ~3 km. Un cliente propio a 4-5 km ya no entra "porque es cartera": antes entra un prospecto cercano. La única excepción es un cliente de alto valor en riesgo, y en ese caso la justificación lo dice explícitamente.

## Cuándo decide cada mecanismo

```text
DETERMINÍSTICO (SQL + geometría)
  · quién es cliente de quién (último vendedor gana)
  · estado del cliente: activo / dormido / perdido
  · cooldown de 15 días
  · radio, distancias, densidad de la ruta
  · exclusiones y feedback "no visitar"

IA (solo cuando hay más candidatos válidos que lugares)
  · elegir 8 entre 20-40 candidatos ya filtrados y ya compactos
  · redactar la explicación comercial de cada visita
  · redactar el resumen de la ruta
  NO decide distancias, NO decide cuota, NO inventa candidatos

GOOGLE MAPS (último recurso)
  · solo si tras cartera + reactivación + prospectos de base
    todavía faltan lugares dentro del radio operativo
  · queda registrado que ese punto vino de una búsqueda en vivo
```

## Qué va a ver el asignador

Se elimina de la salida todo lo técnico: coordenadas, "hotspot", "score_proximidad", km crudos como argumento.

Cada visita muestra una explicación en lenguaje comercial, por ejemplo:

- "Compra hace 3 meses y era uno de tus mejores clientes del barrio. Vale la visita de recuperación."
- "Vinoteca a 3 cuadras de tu primera parada, buena reputación y todavía no compra."
- "Cliente activo de la zona, toca visita de mantenimiento."

Y arriba de la lista, un **aviso de cobertura** cuando la zona no dio para la mezcla ideal:

> En Comuna 14 Pilar tiene 1 solo cliente propio. Se completó la ruta con 7 lugares nuevos de la zona para que el día rinda. Si preferís otra zona, cambiá el filtro.

Cuando la zona no alcanza ni con prospectos de base, el aviso dice que se buscaron lugares nuevos en el mapa y cuántos se incorporaron.

## Detalle técnico

Todo el cambio vive en `supabase/functions/generate-recommendations/index.ts` (+ `recommendation-composition.ts`) y en la capa de presentación (`ResultsList.tsx`, `AIInsightsCard.tsx`). No se toca el esquema salvo un campo opcional.

1. **Constantes de compacidad**: reemplazar la cascada actual (`HARD_RADIUS_KM 1.2` → `1.8` → `2.2` → `3.0` → `ZONE_FALLBACK 4.0` → `PORTFOLIO_FALLBACK 5.0`) por un radio operativo único de 2,5 km con una sola ampliación a 3,5 km, y bajar `MAX_ROUTE_SPREAD_KM` de 6,0 a 3,0. Se elimina el rescate de cartera a 5 km como camino silencioso.

2. **Clasificación de bloques**: etiquetar cada candidato como `cartera_activa` / `reactivacion` / `prospecto` según `dias_desde_ultima_compra` (≤30 / 31-90 / +90 / sin historia), en hora Argentina, y armar la selección por cupos 4-2-2 con la cadena de sustitución de arriba, antes de llamar a la IA.

3. **Trazabilidad de la composición**: devolver por vendedor un objeto `cobertura` con lo pedido vs lo conseguido por bloque, el radio final usado, cuántos puntos vinieron de base y cuántos de Google. Guardarlo en `factores_ia` y usarlo para el aviso de cobertura.

4. **Prompt de la IA**: sacar del prompt el hotspot en coordenadas y los scores numéricos como material de redacción; pasar atributos de negocio (estado del cliente, días sin compra, ticket, rubro, cercanía en cuadras/minutos a pie) y pedir explícitamente justificación comercial sin números de coordenadas ni jerga interna. Límite de longitud por justificación.

5. **Sanitizado de salida**: filtro final que elimina de `justificacion` cualquier patrón de coordenadas o términos internos ("hotspot", "score_", "cluster"), como red de seguridad ante variaciones del modelo.

6. **Top-up de Google**: se dispara solo dentro del radio operativo y marca los puntos con origen `maps_live`, para que el aviso pueda decirlo.

7. **Auditoría**: la verificación interna pasa a chequear cupos por bloque y spread ≤3 km; si no puede corregir, sigue siendo no bloqueante pero el motivo se traduce a lenguaje del asignador en el aviso de cobertura.

## Fuera de alcance

- No se cambia el flujo de asignación manual ni la asignación por área.
- No se cambia el modelo de datos de clientes ni el ETL.
