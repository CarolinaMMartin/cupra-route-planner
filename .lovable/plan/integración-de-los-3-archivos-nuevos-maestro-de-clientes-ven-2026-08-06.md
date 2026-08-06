# Integración de los 3 archivos nuevos (maestro de clientes + ventas)

## Qué hay en cada archivo

| Archivo | Contenido real | Filas | Clave |
|---|---|---|---|
| `Copia_de_clientes-32_1.xls` (hoja "Clientes") | Maestro WIWO de clientes activos: **Id**, Código, Razón Social, Fantasía, CUIT, Provincia, Dirección, Ciudad, CP, Teléfono, Celular, Correo, Categorías, **Vendedor asignado**, Observación | 635 | `Id` = `client_id` |
| `ACT.CLIENTES.xlsx` (Hoja1) | Actualización geográfica: CUIT, Provincia, Calle, Número, Ciudad, CP, **Latitud/Longitud reales**, Vendedor, Categorías | 516 | CUIT |
| `Copia_de_informe_ventas_...xlsx` (hoja "Ventas por Producto") | Ventas desglosadas por producto: Ticket, Letra, Fecha Emisión, CUIT, Razón Social, Código Producto, Nombre, Marca, Cantidad, **Precio Total Final**, Ciudad/Provincia, Lat/Long, Categorías, Vendedor, Operador | 1.542 | Ticket+Letra+Fecha+Producto |

Hoja2 de `ACT.CLIENTES` es un dump con duplicados sin datos nuevos: se ignora.

## Problemas detectados con el flujo actual

1. **El archivo de ventas rompe el parser actual.** `CargaDatos` lee la primera hoja con la primera fila como encabezado. Este informe trae 2 filas de título antes del encabezado y 6 hojas (Ventas por Producto, Ventas por Comprobante, Financiaciones, Notas de Crédito). Hoy se cargaría basura.
2. **El informe de ventas no trae `Id` de cliente**, sólo CUIT (además en notación científica). Sin el maestro cargado, muchos clientes se crean con `client_id` sintético y quedan duplicados respecto de los reales.
3. **La base tiene 190 clientes y el maestro trae 635.** ~445 clientes de cartera hoy no existen para el agente.
4. **El campo `Vendedor` viene vacío en 88 filas de ventas** (queda `Operador`), y el maestro sí trae el vendedor oficial de cartera.
5. **Las Notas de Crédito no se descuentan** de la facturación.

## Qué se va a construir

### 1. Nueva función `process-clientes-maestro`
Ingesta del maestro de clientes (los dos archivos de clientes, mismo endpoint, detectando el layout).

- Clave: `Id` → `client_id`. Si no hay `Id` (caso ACT.CLIENTES), se resuelve por CUIT normalizado contra los clientes existentes.
- Escribe/actualiza: razón social, fantasía, cuit, dirección, ciudad, provincia, barrio/comuna (con el mapeo CABA/GBA que ya existe), teléfonos, emails, etiquetas (desde "Categorías"), canal (ON/OFF trade).
- **Vendedor de cartera**: el maestro define el vendedor oficial → se guarda en `vendedor_actual`. El derivado de la última venta pasa a ser sólo histórico (`vendedor_principal`).
- **Coordenadas**: las lat/long de ACT.CLIENTES se upsertean en `client_places` como principales, pisando geocodificaciones automáticas previas.
- **Nunca toca** `cliente_feedbacks`, `excluir_recomendaciones`, `last_recommendation_at`, `ultima_visita` ni las asignaciones (misma protección que ya tiene la carga de ventas).
- Clientes del maestro sin ninguna venta se crean igual, con métricas en cero y `estado` derivado como "sin compras".

### 2. Ajustes a `process-ventas-excel`
- Soportar el layout del informe nuevo: hoja **"Ventas por Producto"** y encabezado en la 3.ª fila.
- Normalizar el CUIT cuando llega como número (notación científica) para que el match contra el maestro funcione.
- Fallback de vendedor: `Vendedor` → si viene vacío, `Operador` → si no, el vendedor de cartera del maestro.
- **Notas de Crédito**: leer la hoja correspondiente y restar esos importes del monto histórico del cliente (bandera activable, por defecto encendida).
- Mantener `Precio Total Final` como fuente oficial de facturación.

### 3. `CargaDatos.tsx` — carga en dos pasos
- Detección automática del tipo de archivo (maestro de clientes vs. informe de ventas) leyendo las hojas y encabezados; selector de hoja y fila de encabezado cuando la detección falle.
- Orden sugerido en pantalla: **1) Maestro de clientes → 2) Ventas**, con aviso si se intenta cargar ventas sin maestro previo.
- Preview y resumen por tipo: clientes nuevos/actualizados, coordenadas actualizadas, ventas procesadas, notas de crédito aplicadas, filas sin match de CUIT.

### 4. Impacto en el agente (`generate-recommendations`)
- Los ~445 clientes de cartera sin ventas entran al pool como **visitables** para el vendedor que los tiene asignado en el maestro (categoría "sin compras", scoring por debajo de ACTIVO pero por encima de prospecto frío).
- 194 de los 635 clientes del maestro **no traen vendedor**: se resuelve con el vendedor de su última venta y, si tampoco existe, quedan disponibles para asignación manual (no se recomiendan a nadie automáticamente).
- El match vendedor↔cliente pasa a usar `vendedor_actual` proveniente del maestro, que es más confiable que el derivado de ventas.
- Más clientes con coordenadas reales ⇒ mejor anclaje geográfico y menos dependencia de la geocodificación por dirección.

## Decisiones asumidas (decime si querés otra cosa)
- El **maestro manda** sobre el vendedor; la última venta queda como histórico.
- Los clientes sin compras **entran como cartera visitable**.
- Las coordenadas del Excel **pisan** las geocodificadas automáticamente.

## Detalle técnico
| Archivo | Cambio |
|---|---|
| `supabase/functions/process-clientes-maestro/index.ts` | Nuevo — ingesta maestro + geo, upsert protegido |
| `supabase/functions/process-ventas-excel/index.ts` | Layout multi-hoja, CUIT numérico, fallback Operador, notas de crédito |
| `src/pages/CargaDatos.tsx` | Detección de tipo/hoja/encabezado, flujo en 2 pasos, resúmenes |
| `supabase/config.toml` | Registro de la nueva función |
| `supabase/functions/generate-recommendations/index.ts` | Incluir cartera sin compras en el pool y priorizar `vendedor_actual` del maestro |

Sin cambios de esquema: se usan campos existentes de `clientes` y `client_places`.
