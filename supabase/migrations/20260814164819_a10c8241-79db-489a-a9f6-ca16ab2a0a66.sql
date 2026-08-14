CREATE OR REPLACE FUNCTION public.preview_ventas_import(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_desde date; v_hasta date;
  v_filas int; v_rango_base int; v_eliminar int;
  v_clientes int; v_match int; v_base_total int;
  v_base_desde date; v_base_hasta date; v_total numeric;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  CREATE TEMP TABLE _prev_incoming ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(p_rows) AS x(
    ticket text, letra text, fecha_emision date, client_id text,
    codigo_producto text, facturacion_ars numeric, tipo_comprobante text,
    bonificacion numeric, renglon integer
  );

  SELECT min(fecha_emision), max(fecha_emision), count(*), count(DISTINCT client_id), COALESCE(sum(facturacion_ars),0)
    INTO v_desde, v_hasta, v_filas, v_clientes, v_total
  FROM _prev_incoming;

  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'El archivo no tiene fechas de emisión válidas: no se puede determinar el período';
  END IF;

  SELECT count(*), min(fecha_emision), max(fecha_emision)
    INTO v_base_total, v_base_desde, v_base_hasta
  FROM public.ventas_cupra;

  SELECT count(*) INTO v_rango_base
  FROM public.ventas_cupra v
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta;

  SELECT count(*) INTO v_eliminar
  FROM public.ventas_cupra v
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta
    AND NOT EXISTS (
      SELECT 1 FROM _prev_incoming i
      WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
        AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
        AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
        AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
        AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
        AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
        AND COALESCE(i.bonificacion, -1) = COALESCE(v.bonificacion, -1)
        AND COALESCE(i.renglon, 1) = COALESCE(v.renglon, 1)
    );

  SELECT count(DISTINCT i.client_id) INTO v_match
  FROM _prev_incoming i
  WHERE i.client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.client_id = i.client_id);

  DROP TABLE _prev_incoming;

  RETURN jsonb_build_object(
    'fecha_desde', v_desde,
    'fecha_hasta', v_hasta,
    'filas_archivo', v_filas,
    'clientes_archivo', v_clientes,
    'clientes_match', v_match,
    'pct_match_clientes', CASE WHEN v_clientes = 0 THEN 0 ELSE round(v_match::numeric * 100 / v_clientes, 1) END,
    'total_bruto', v_total,
    'filas_rango_base', v_rango_base,
    'filas_a_eliminar', v_eliminar,
    'pct_eliminacion', CASE WHEN v_rango_base = 0 THEN 0 ELSE round(v_eliminar::numeric * 100 / v_rango_base, 1) END,
    'base_vacia', v_base_total = 0,
    'base_filas', v_base_total,
    'base_desde', v_base_desde,
    'base_hasta', v_base_hasta,
    'requiere_confirmacion', (v_rango_base > 0 AND v_eliminar::numeric > v_rango_base * 0.2),
    'archivo_ajeno', (v_base_total > 0 AND v_clientes > 0 AND v_match::numeric < v_clientes * 0.5)
  );
END;
$function$;