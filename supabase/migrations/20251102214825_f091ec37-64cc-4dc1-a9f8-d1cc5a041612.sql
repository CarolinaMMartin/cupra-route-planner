-- Primero eliminar el constraint anterior si existe
DO $$ 
BEGIN
  -- Intentar eliminar constraints únicos existentes sobre estas columnas
  ALTER TABLE ventas_cupra DROP CONSTRAINT IF EXISTS ventas_cupra_ticket_letra_fecha_emision_client_id_key;
  ALTER TABLE ventas_cupra DROP CONSTRAINT IF EXISTS ventas_cupra_unique_venta;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Crear el nuevo constraint único que incluye codigo_producto
-- Esto permite múltiples productos (líneas) por ticket
ALTER TABLE ventas_cupra 
ADD CONSTRAINT ventas_cupra_unique_venta 
UNIQUE (ticket, letra, fecha_emision, client_id, codigo_producto);

-- Crear índice para mejorar el rendimiento de las consultas
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_ticket ON ventas_cupra(ticket, fecha_emision);
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_client ON ventas_cupra(client_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_producto ON ventas_cupra(codigo_producto);