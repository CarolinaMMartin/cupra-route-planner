-- First drop old constraint
ALTER TABLE ventas_cupra DROP CONSTRAINT IF EXISTS ventas_cupra_unique_venta;
DROP INDEX IF EXISTS ventas_cupra_unique_venta;

-- Delete duplicate rows keeping the one with highest id
DELETE FROM ventas_cupra a
USING ventas_cupra b
WHERE a.id < b.id
  AND a.ticket = b.ticket
  AND COALESCE(a.letra, '') = COALESCE(b.letra, '')
  AND COALESCE(a.fecha_emision, '1900-01-01') = COALESCE(b.fecha_emision, '1900-01-01')
  AND COALESCE(a.client_id, '') = COALESCE(b.client_id, '')
  AND COALESCE(a.codigo_producto, '') = COALESCE(b.codigo_producto, '')
  AND COALESCE(a.facturacion_ars, 0) = COALESCE(b.facturacion_ars, 0);

-- Now create the unique index
CREATE UNIQUE INDEX ventas_cupra_unique_venta ON ventas_cupra (
  ticket, COALESCE(letra, ''), COALESCE(fecha_emision, '1900-01-01'), 
  COALESCE(client_id, ''), COALESCE(codigo_producto, ''),
  COALESCE(facturacion_ars, 0)
);