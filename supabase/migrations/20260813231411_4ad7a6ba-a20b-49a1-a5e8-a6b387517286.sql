ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS monto_notas_credito numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_ultima_nc date,
  ADD COLUMN IF NOT EXISTS cadencia_dias integer,
  ADD COLUMN IF NOT EXISTS precio_promedio_caja numeric;

WITH ventas AS (
  SELECT client_id,
         SUM(COALESCE(facturacion_ars,0)) AS bruto,
         SUM(COALESCE(cajas,0)) AS cajas,
         COUNT(DISTINCT COALESCE(ticket,'') || '|' || COALESCE(fecha_emision::text,'')) AS ordenes,
         MIN(fecha_emision) AS primera,
         MAX(fecha_emision) AS ultima
  FROM public.ventas_cupra
  WHERE tipo_comprobante <> 'nota_credito' AND client_id IS NOT NULL
  GROUP BY client_id
), ncs AS (
  SELECT client_id,
         SUM(ABS(COALESCE(facturacion_ars,0))) AS nc_monto,
         MAX(fecha_emision) AS nc_fecha
  FROM public.ventas_cupra
  WHERE tipo_comprobante = 'nota_credito' AND client_id IS NOT NULL
  GROUP BY client_id
)
UPDATE public.clientes c
SET monto_total_historico = COALESCE(v.bruto, 0),
    cantidad_ordenes = COALESCE(v.ordenes, 0),
    ticket_promedio = CASE WHEN COALESCE(v.ordenes,0) > 0
                           THEN ROUND(COALESCE(v.bruto,0) / v.ordenes, 2) END,
    precio_promedio_caja = CASE WHEN COALESCE(v.cajas,0) > 0
                                THEN ROUND(COALESCE(v.bruto,0) / v.cajas, 2) END,
    cadencia_dias = CASE WHEN COALESCE(v.ordenes,0) > 1 AND v.ultima > v.primera
                         THEN GREATEST(1, ROUND((v.ultima - v.primera)::numeric / (v.ordenes - 1))::int) END,
    monto_notas_credito = COALESCE(n.nc_monto, 0),
    fecha_ultima_nc = n.nc_fecha
FROM ventas v
FULL OUTER JOIN ncs n ON n.client_id = v.client_id
WHERE c.client_id = COALESCE(v.client_id, n.client_id);