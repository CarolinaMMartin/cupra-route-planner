-- Agregar columna visited_at para registrar momento de visita
ALTER TABLE asignaciones_vendedores_clientes 
ADD COLUMN IF NOT EXISTS visited_at timestamp with time zone DEFAULT NULL;

-- Backfill estimado para asignaciones existentes con estado 'Visitado'
-- Usa cliente_feedbacks como aproximación del momento de visita
UPDATE asignaciones_vendedores_clientes a
SET visited_at = (
  SELECT cf.created_at 
  FROM cliente_feedbacks cf 
  WHERE (
    (a.client_id IS NOT NULL AND cf.client_id = a.client_id) OR
    (a.prospecto_place_id IS NOT NULL AND cf.prospecto_place_id = a.prospecto_place_id)
  )
  AND cf.vendedor_id = a.vendedor_id
  ORDER BY cf.created_at DESC
  LIMIT 1
)
WHERE a.estado = 'Visitado' AND a.visited_at IS NULL;