

# Plan: Fix recomendaciones — siempre 8 por vendedor, concentradas geográficamente

## Diagnóstico detallado

Analicé los logs, la data y el código completo. Los problemas son tres:

### Bug 1: Solo guarda 4 de 8 (enrichment pierde los prospectos extra)
La expansión de prospectos (líneas 724-795) agrega candidatos al bucket `potenciales`, pero **nunca los agrega al array `prospectos`** (línea 570). Al momento de enriquecer (línea 995), busca `prospectos.find(p => p.place_id === rec.client_id)` y no los encuentra → los descarta con `continue`. Por eso IA selecciona 8 pero solo se guardan 4.

### Bug 2: Prospectos vienen de cualquier lado, no del barrio pedido
La expansión busca prospectos del "barrio top del vendedor" (su cartera histórica), NO del barrio que el usuario pidió. Pilar tiene clientes en Avellaneda y Caballito → los prospectos extra vienen de ahí, no de Palermo.

### Bug 3: Pilar tiene 0 clientes en Palermo, los anchors apuntan a otra zona
Pilar tiene solo 6 clientes en total, 2 con ubicación (Avellaneda y Caballito). Ninguno en Palermo. Los anchors se calculan sobre esos clientes lejanos, así que el score geográfico de prospectos de Palermo es bajo.

## Solución

### Cambio 1: Guardar prospectos extra para el lookup de enrichment
Crear un array `extraProspectosLoaded` que acumule todos los prospectos cargados durante la expansión. Usarlo en la línea 995 como fallback: `prospectos.find(p => ...) || extraProspectosLoaded.find(p => ...)`.

### Cambio 2: Expansión usa barrios del REQUEST, no del portfolio
Cuando `totalCandidates < 8`, buscar prospectos primero en `barriosFinales` (los barrios que el usuario seleccionó en el filtro), no en los barrios del portfolio del vendedor. Si `barriosFinales` está vacío, ahí sí usar el barrio top del portfolio.

### Cambio 3: Anchors fallback a zona solicitada
Cuando un vendedor tiene 0 clientes en zona y sus anchors están lejos de la zona pedida, calcular un "centro geográfico de la zona" usando los client_places de la zona (aunque sean de otros vendedores) como anchor secundario. Esto hace que los prospectos de Palermo tengan score geo alto.

### Cambio 4: validateAndFixDistribution más agresivo
Si después de la validación todavía hay < 8, rellenar con cualquier prospecto disponible del bucket potenciales sin límite de categoría.

## Archivo a modificar

`supabase/functions/generate-recommendations/index.ts`:

1. Declarar `const extraProspectosLoaded: any[] = []` antes del loop per-vendor
2. En la expansión (líneas 744-764), además de agregar al bucket, hacer `extraProspectosLoaded.push(...extraFiltered)` y lo mismo para la expansión de provincia (líneas 774-793)
3. Cambiar la lógica de expansion: usar `barriosFinales` como primera opción de barrio, `topBarrios` como fallback
4. Agregar anchor fallback: si `anchors.length === 0` y hay `clientPlaces` en zona, usar su centroide
5. En enrichment (línea 995), agregar: `|| extraProspectosLoaded.find(p => p.place_id === rec.client_id)`

