
-- Add vendedor_actual to track the current seller managing the client
ALTER TABLE public.clientes ADD COLUMN vendedor_actual text;

-- Initialize vendedor_actual from the most recent sale per client
UPDATE public.clientes c
SET vendedor_actual = sub.vendedor
FROM (
  SELECT DISTINCT ON (client_id) client_id, vendedor
  FROM public.ventas_cupra
  WHERE vendedor IS NOT NULL
  ORDER BY client_id, fecha_emision DESC NULLS LAST
) sub
WHERE c.client_id = sub.client_id;
