-- Vaciar la tabla ventas_cupra
TRUNCATE TABLE public.ventas_cupra;

-- Asegurar que la tabla tenga todas las columnas correctas del Excel
-- Ya existe, solo necesitamos confirmar que todas las columnas sean nullable
-- para que n8n pueda cargar datos con campos vacíos sin problemas

-- Verificar que telefono, celular y direccion sean nullable (ya lo son)
-- La tabla ya está bien configurada para recibir datos desde n8n