UPDATE public.clientes c
SET todos_vendedores = v.vends
FROM (
  SELECT client_id, array_agg(DISTINCT upper(trim(vendedor))) AS vends
  FROM public.ventas_cupra
  WHERE client_id IS NOT NULL AND vendedor IS NOT NULL AND trim(vendedor) <> ''
  GROUP BY client_id
) v
WHERE c.client_id = v.client_id
  AND (c.todos_vendedores IS NULL OR NOT (c.todos_vendedores @> v.vends AND v.vends @> c.todos_vendedores));