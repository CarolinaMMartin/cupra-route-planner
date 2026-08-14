ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS monto_nc_producto numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_nc_concepto numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_client_metrics()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH ventas AS (
    SELECT
      v.client_id,
      SUM(COALESCE(v.facturacion_ars, 0)) AS bruto,
      SUM(COALESCE(v.cajas, 0)) AS cajas,
      COUNT(DISTINCT (COALESCE(v.ticket,'') || '|' || COALESCE(v.letra,'') || '|' || COALESCE(v.fecha_emision::text,''))) AS ordenes,
      MIN(v.fecha_emision) AS primera,
      MAX(v.fecha_emision) AS ultima,
      COUNT(DISTINCT v.fecha_emision) AS dias_distintos
    FROM public.ventas_cupra v
    WHERE v.client_id IS NOT NULL
      AND v.tipo_comprobante = 'venta'
    GROUP BY v.client_id
  ), notas AS (
    SELECT
      v.client_id,
      SUM(CASE WHEN v.tipo_comprobante = 'nota_credito' THEN ABS(COALESCE(v.facturacion_ars,0)) ELSE 0 END) AS nc_producto,
      SUM(CASE WHEN v.tipo_comprobante = 'nota_credito_concepto' THEN ABS(COALESCE(v.facturacion_ars,0)) ELSE 0 END) AS nc_concepto,
      MAX(v.fecha_emision) FILTER (WHERE v.tipo_comprobante = 'nota_credito') AS fecha_ultima_nc
    FROM public.ventas_cupra v
    WHERE v.client_id IS NOT NULL
      AND v.tipo_comprobante IN ('nota_credito', 'nota_credito_concepto')
    GROUP BY v.client_id
  ), metricas AS (
    SELECT
      COALESCE(ventas.client_id, notas.client_id) AS client_id,
      COALESCE(ventas.bruto, 0) AS bruto,
      COALESCE(ventas.ordenes, 0) AS ordenes,
      ventas.primera,
      ventas.ultima,
      COALESCE(ventas.dias_distintos, 0) AS dias_distintos,
      COALESCE(ventas.cajas, 0) AS cajas,
      COALESCE(notas.nc_producto, 0) AS nc_producto,
      COALESCE(notas.nc_concepto, 0) AS nc_concepto,
      notas.fecha_ultima_nc
    FROM ventas
    FULL OUTER JOIN notas ON notas.client_id = ventas.client_id
  )
  UPDATE public.clientes c
  SET
    monto_total_historico = ROUND(m.bruto::numeric, 2),
    monto_total_cupra = ROUND(m.bruto::numeric, 2),
    cantidad_ordenes = m.ordenes,
    ticket_promedio = CASE WHEN m.ordenes > 0 THEN ROUND((m.bruto / m.ordenes)::numeric, 2) ELSE 0 END,
    precio_promedio_caja = CASE WHEN m.cajas > 0 THEN ROUND((m.bruto / m.cajas)::numeric, 2) ELSE NULL END,
    cadencia_dias = CASE
      WHEN m.dias_distintos >= 2 AND m.primera IS NOT NULL AND m.ultima IS NOT NULL AND m.ultima > m.primera
        THEN GREATEST(1, ROUND(((m.ultima - m.primera)::numeric / (m.dias_distintos - 1)))::integer)
      ELSE NULL
    END,
    monto_nc_producto = ROUND(m.nc_producto::numeric, 2),
    monto_nc_concepto = ROUND(m.nc_concepto::numeric, 2),
    monto_notas_credito = ROUND(m.nc_producto::numeric, 2),
    fecha_ultima_nc = m.fecha_ultima_nc,
    updated_at = now()
  FROM metricas m
  WHERE c.client_id = m.client_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_client_metrics() TO service_role;