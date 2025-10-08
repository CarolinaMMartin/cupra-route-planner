-- 1. Modificar tabla sucursales: eliminar cuit_dni_cliente y agregar cliente_id
ALTER TABLE sucursales DROP COLUMN cuit_dni_cliente;
ALTER TABLE sucursales ADD COLUMN cliente_id uuid REFERENCES clientes(id);

-- 2. Agregar cliente_id a ventas_cupra relacionado con clientes
ALTER TABLE ventas_cupra ADD COLUMN cliente_id uuid REFERENCES clientes(id);

-- 3. Renombrar tabla clientes_unificados a clientes_recomendaciones_temporal
ALTER TABLE clientes_unificados RENAME TO clientes_recomendaciones_temporal;