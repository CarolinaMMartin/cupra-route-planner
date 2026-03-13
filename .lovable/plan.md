

## Plan: Upload Excel + ETL integrado en la app

### Análisis: n8n vs Lovable

El workflow de n8n hace 3 cosas:
1. **Parsear Excel** de ventas (mapear columnas con nombres variados)
2. **Cargar ventas** crudas → `upsert-ventas-cupra`
3. **Agregar por cliente** (RFM, scores, geografía CABA, arrays) → `upsert-clientes`

**Recomendación: hacerlo todo en Lovable.** Las razones:

- La lógica ETL es JavaScript puro (~400 líneas), portable directamente a una edge function
- Los endpoints de destino (`upsert-ventas-cupra`, `upsert-clientes`) ya existen
- Eliminamos la dependencia de n8n + Google Drive para la carga de datos
- El usuario sube el Excel directo en la app, ve progreso y errores en tiempo real

### Arquitectura

```text
┌─────────────────────────────────────────────┐
│  UI: Página "Carga de Datos"                │
│  ┌─────────────────────────────────┐        │
│  │  Drop zone / File input (.xlsx) │        │
│  └──────────────┬──────────────────┘        │
│                 │ File                       │
│                 ▼                            │
│  Frontend: Parse Excel (SheetJS/xlsx)       │
│  → rows[] crudos                            │
│                 │                            │
│                 ▼                            │
│  Edge Function: process-ventas-excel        │
│  1. Normalizar campos (fechas, montos...)   │
│  2. Upsert ventas_cupra (bulk)              │
│  3. Agregar por client_id (RFM, geo, etc)   │
│  4. Upsert clientes (protegido)             │
│  5. Return resumen                          │
│                 │                            │
│                 ▼                            │
│  UI: Resumen de carga                       │
│  (X ventas, Y clientes, Z errores)          │
└─────────────────────────────────────────────┘
```

### Componentes a crear

**1. Edge Function `process-ventas-excel`**
- Recibe `{ rows: [...] }` (filas crudas del Excel ya parseadas en frontend)
- Porta toda la lógica ETL del n8n:
  - Normalización de campos con `getFieldValue` (manejo de variantes de nombre de columna)
  - Conversión de fechas Excel serial → ISO
  - Conversión de montos con formato argentino
  - Agregación por `client_id`: RFM, scores, geografía CABA (barrio→comuna), arrays de contacto
- Escribe directo a `ventas_cupra` y llama la lógica de `upsert-clientes` (protegiendo campos internos)
- Devuelve resumen: `{ ventas_procesadas, clientes_actualizados, errores[] }`

**2. Página `CargaDatos.tsx`**
- Accesible solo para rol `asignador`
- File input que acepta `.xlsx` / `.xls`
- Parseo client-side con librería `xlsx` (SheetJS)
- Envía rows al edge function
- Muestra progreso y resumen al finalizar
- Opción de previsualizar primeras filas antes de confirmar

**3. Ruta + navegación**
- Nueva ruta `/carga-datos`
- Botón en el menú del asignador

### Detalle técnico del ETL (portado de n8n)

La lógica clave que se porta:
- **`getFieldValue()`**: Busca columnas por nombre exacto, case-insensitive, y normalizado (sin acentos)
- **`normalizarGeografia()`**: Mapea barrios CABA → comunas, detecta localidades PBA
- **Agregación RFM**: Primera/última compra, días desde última, score recencia/volumen/comercial
- **Protección de campos**: Misma lógica que `upsert-clientes` (no sobreescribir `last_recommendation_at`, `excluir_recomendaciones`, etc.)

### Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `supabase/functions/process-ventas-excel/index.ts` | Crear — ETL completo |
| `src/pages/CargaDatos.tsx` | Crear — UI de upload |
| `src/App.tsx` | Modificar — agregar ruta |
| `supabase/config.toml` | Modificar — registrar función |
| `package.json` | Agregar dep `xlsx` |

### Beneficios vs mantener n8n

- **Sin dependencia externa**: No necesitás n8n ni Google Drive
- **Feedback inmediato**: El usuario ve errores y resumen al instante
- **Mismo código**: La lógica ETL es idéntica, solo cambia dónde corre
- **Mantenible**: Un solo lugar para actualizar reglas de negocio

