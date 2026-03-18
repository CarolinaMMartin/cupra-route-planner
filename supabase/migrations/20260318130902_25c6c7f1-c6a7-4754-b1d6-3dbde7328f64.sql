
-- Fix 2: Change unique constraint to include facturacion_ars so bonificaciones (price=0) are preserved
ALTER TABLE ventas_cupra DROP CONSTRAINT ventas_cupra_unique_venta;
ALTER TABLE ventas_cupra ADD CONSTRAINT ventas_cupra_unique_venta UNIQUE (ticket, letra, fecha_emision, client_id, codigo_producto, facturacion_ars);
