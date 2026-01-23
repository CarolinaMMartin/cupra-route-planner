

# Cambios en Tabla de Edición de Clientes

## Estructura de Columnas

| Columna Actual | Cambio |
|----------------|--------|
| Razón Social (+ Fantasía) | ✅ Mantener tal cual |
| CUIT/DNI | ❌ **Eliminar** |
| Vendedor Principal | ✅ Mantener |
| Teléfonos | ✅ Mantener |
| Provincia | ✅ Mantener |
| — | ➕ **Agregar: Dirección** |
| — | ➕ **Agregar: Barrio** |

## Nueva Estructura Final

| Razón Social | Dirección | Barrio | Vendedor Principal | Teléfonos | Provincia | Acción |
|--------------|-----------|--------|-------------------|-----------|-----------|--------|

## Archivo a Modificar

`src/components/clientes/ClientesEditTable.tsx`

## Cambios Específicos

**Header (líneas 48-55):**
- Eliminar `<TableHead>CUIT/DNI</TableHead>`
- Agregar `<TableHead>Dirección</TableHead>` después de Razón Social
- Agregar `<TableHead>Barrio</TableHead>` después de Dirección

**Body (líneas 67-86):**
- Eliminar celda de `cuit_dni`
- Agregar celda con `direccion_principal`
- Agregar celda con `barrio_principal`

**Colspan:**
- Actualizar `colSpan` de 6 a 7 en el mensaje "No se encontraron clientes"

