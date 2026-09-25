-- Agregación sobre TODAS las filas importadas. El modelo recibe métricas,
-- nunca una muestra recortada ni cálculos delegados al lenguaje natural.
CREATE OR REPLACE FUNCTION public.resumen_ventas(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND activo AND rol = 'administrador') THEN
    RAISE EXCEPTION 'Solo un administrador activo puede analizar las ventas' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_filtros) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE = '22023';
  END IF;
  IF p_filtros ? 'client_ids' AND (jsonb_typeof(p_filtros->'client_ids') <> 'array' OR jsonb_array_length(p_filtros->'client_ids') > 10000) THEN
    RAISE EXCEPTION 'Selección de clientes inválida' USING ERRCODE = '22023';
  END IF;
  WITH base AS MATERIALIZED (
    SELECT v.id, v.client_id, v.ticket, v.letra, v.fecha_emision, v.tipo_comprobante,
      v.vendedor, v.nombre AS producto, v.codigo_producto,
      coalesce(v.facturacion_ars,0) AS monto, coalesce(v.cajas,0) AS cajas,
      coalesce(c.rubro, public.normalizar_rubro(ARRAY[v.categorias]), 'Sin rubro') AS rubro
    FROM ventas_cupra v LEFT JOIN clientes c ON c.client_id=v.client_id
    WHERE (nullif(p_filtros->>'lote_id','') IS NULL OR v.import_batch_id=(p_filtros->>'lote_id')::uuid)
      AND (nullif(p_filtros->>'desde','') IS NULL OR v.fecha_emision >= (p_filtros->>'desde')::date)
      AND (nullif(p_filtros->>'hasta','') IS NULL OR v.fecha_emision <= (p_filtros->>'hasta')::date)
      AND (NOT p_filtros ? 'client_ids' OR v.client_id IN (SELECT jsonb_array_elements_text(p_filtros->'client_ids')))
      AND (nullif(p_filtros->>'vendedor','') IS NULL OR
        translate(regexp_replace(lower(trim(v.vendedor)), '\s+', ' ', 'g'),'áéíóúüñ','aeiouun') =
        translate(regexp_replace(lower(trim(p_filtros->>'vendedor')), '\s+', ' ', 'g'),'áéíóúüñ','aeiouun'))
  ), meses AS (
    SELECT coalesce(to_char(fecha_emision,'YYYY-MM'),'Sin fecha') AS mes, sum(monto) AS neto, count(*) AS filas
    FROM base GROUP BY 1 ORDER BY 1
  ), rubros AS (
    SELECT rubro AS nombre, sum(monto) AS neto, count(DISTINCT client_id) AS clientes FROM base GROUP BY rubro ORDER BY neto DESC
  ), vendedores AS (
    SELECT coalesce(vendedor,'Sin vendedor') AS nombre, sum(monto) AS neto, count(DISTINCT client_id) AS clientes FROM base GROUP BY vendedor ORDER BY neto DESC
  ), productos AS (
    SELECT coalesce(producto,codigo_producto,'Sin producto') AS nombre, sum(monto) AS neto, sum(cajas) AS cajas FROM base
    GROUP BY codigo_producto,producto ORDER BY neto DESC LIMIT 10
  )
  SELECT jsonb_build_object(
    'filas', count(*), 'clientes',count(DISTINCT client_id),
    'comprobantes',count(DISTINCT (tipo_comprobante, fecha_emision, letra, ticket, client_id)) FILTER (WHERE ticket IS NOT NULL),
    'neto',coalesce(sum(monto),0), 'cajas',coalesce(sum(cajas),0),
    'ventas',coalesce(sum(monto) FILTER (WHERE coalesce(tipo_comprobante,'venta') NOT LIKE 'nota_credito%'),0),
    'notas_credito',coalesce(sum(abs(monto)) FILTER (WHERE tipo_comprobante LIKE 'nota_credito%'),0),
    'desde',min(fecha_emision), 'hasta',max(fecha_emision),
    'sin_fecha',count(*) FILTER (WHERE fecha_emision IS NULL), 'sin_cliente',count(*) FILTER (WHERE client_id IS NULL),
    'meses',coalesce((SELECT jsonb_agg(m) FROM meses m),'[]'::jsonb),
    'rubros',coalesce((SELECT jsonb_agg(r) FROM rubros r),'[]'::jsonb),
    'vendedores',coalesce((SELECT jsonb_agg(v) FROM vendedores v),'[]'::jsonb),
    'productos',coalesce((SELECT jsonb_agg(p) FROM productos p),'[]'::jsonb),
    'generado_en',now(), 'filtros',p_filtros
  ) INTO resultado FROM base;
  RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.resumen_ventas(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_ventas(jsonb) TO authenticated;
