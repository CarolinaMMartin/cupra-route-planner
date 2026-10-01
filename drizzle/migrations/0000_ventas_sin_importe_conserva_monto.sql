CREATE OR REPLACE FUNCTION public.aplicar_ventas_import(p_rows jsonb, p_batch_id uuid, p_confirmar_eliminaciones boolean, p_reemplazar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_desde date; v_hasta date;
  v_rango_base int; v_eliminar int; v_eliminadas int := 0;
  v_clientes int; v_match int; v_base_total int;
  v_insertadas int := 0; v_actualizadas int := 0; v_total numeric;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'fecha_emision','') IS NULL OR NULLIF(r->>'client_id','') IS NULL OR NULLIF(r->>'ticket','') IS NULL ) THEN
    RAISE EXCEPTION 'Hay ventas sin fecha, comprobante o cliente válido. No se modificó nada.';
  END IF;
  CREATE TEMP TABLE _incoming ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(p_rows) AS x(
    ticket text, letra text, fecha_emision date, cuit_dni text, razon_social text,
    fantasia text, cajas integer, codigo_producto text, nombre text, marca text,
    facturacion_ars numeric, vendedor text, telefono text, celular text, correo text,
    direccion text, ciudad text, provincia text, pais text, categorias text,
    client_id text, tipo_comprobante text, bonificacion numeric, renglon integer
  );

  SELECT min(fecha_emision), max(fecha_emision), count(DISTINCT client_id), COALESCE(sum(facturacion_ars),0)
    INTO v_desde, v_hasta, v_clientes, v_total FROM _incoming;

  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'El archivo no tiene fechas de emisión válidas: no se puede determinar el período a reemplazar';
  END IF;

  SELECT count(*) INTO v_base_total FROM public.ventas_cupra;

  SELECT count(DISTINCT i.client_id) INTO v_match
  FROM _incoming i
  WHERE i.client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.client_id = i.client_id);

  IF v_base_total > 0 AND v_clientes > 0 AND v_match::numeric < v_clientes * 0.5 THEN
    RAISE EXCEPTION 'Este archivo parece de otra empresa u otro formato: solo % de % clientes coinciden con la base. No se modificó nada.', v_match, v_clientes;
  END IF;

  SELECT count(*) INTO v_rango_base FROM public.ventas_cupra v
  WHERE EXISTS (SELECT 1 FROM _incoming z WHERE COALESCE(NULLIF(z.tipo_comprobante,''),'venta')=v.tipo_comprobante GROUP BY COALESCE(NULLIF(z.tipo_comprobante,''),'venta') HAVING v.fecha_emision BETWEEN min(z.fecha_emision) AND max(z.fecha_emision));

  CREATE TEMP TABLE _a_eliminar ON COMMIT DROP AS
  SELECT v.* FROM public.ventas_cupra v
  WHERE p_reemplazar AND EXISTS (SELECT 1 FROM _incoming z WHERE COALESCE(NULLIF(z.tipo_comprobante,''),'venta')=v.tipo_comprobante GROUP BY COALESCE(NULLIF(z.tipo_comprobante,''),'venta') HAVING v.fecha_emision BETWEEN min(z.fecha_emision) AND max(z.fecha_emision))
    AND NOT EXISTS (
      SELECT 1 FROM _incoming i
      WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
        AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
        AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
        AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
        AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
        AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
        AND COALESCE(i.bonificacion, -1) = COALESCE(v.bonificacion, -1)
        AND COALESCE(i.renglon, 1) = COALESCE(v.renglon, 1)
    );

  SELECT count(*) INTO v_eliminar FROM _a_eliminar;

  IF v_rango_base > 0 AND v_eliminar::numeric > v_rango_base * 0.2 AND NOT p_confirmar_eliminaciones THEN
    RAISE EXCEPTION 'Este archivo elimina % de % filas del período % a % (más del 20%%). Se requiere confirmación explícita. No se modificó nada.', v_eliminar, v_rango_base, v_desde, v_hasta;
  END IF;

  INSERT INTO public.ventas_cupra_eliminadas (
    batch_id, motivo, venta_id, client_id, ticket, letra, fecha_emision, cuit_dni,
    razon_social, fantasia, cajas, codigo_producto, nombre, marca, facturacion_ars,
    vendedor, telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, tipo_comprobante, import_batch_id, bonificacion, renglon
  )
  SELECT p_batch_id, 'actualizada', v.id, v.client_id, v.ticket, v.letra, v.fecha_emision, v.cuit_dni,
         v.razon_social, v.fantasia, v.cajas, v.codigo_producto, v.nombre, v.marca, v.facturacion_ars,
         v.vendedor, v.telefono, v.celular, v.correo, v.direccion, v.ciudad, v.provincia, v.pais,
         v.categorias, v.tipo_comprobante, v.import_batch_id, v.bonificacion, v.renglon
  FROM public.ventas_cupra v
  WHERE EXISTS (
    SELECT 1 FROM _incoming i
    WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
      AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
      AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
      AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
      AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
      AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
      AND COALESCE(i.bonificacion, -1) = COALESCE(v.bonificacion, -1)
      AND COALESCE(i.renglon, 1) = COALESCE(v.renglon, 1)
  );

  INSERT INTO public.ventas_cupra_eliminadas (
    batch_id, motivo, venta_id, client_id, ticket, letra, fecha_emision, cuit_dni,
    razon_social, fantasia, cajas, codigo_producto, nombre, marca, facturacion_ars,
    vendedor, telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, tipo_comprobante, import_batch_id, bonificacion, renglon
  )
  SELECT p_batch_id, 'eliminada', e.id, e.client_id, e.ticket, e.letra, e.fecha_emision, e.cuit_dni,
         e.razon_social, e.fantasia, e.cajas, e.codigo_producto, e.nombre, e.marca, e.facturacion_ars,
         e.vendedor, e.telefono, e.celular, e.correo, e.direccion, e.ciudad, e.provincia, e.pais,
         e.categorias, e.tipo_comprobante, e.import_batch_id, e.bonificacion, e.renglon
  FROM _a_eliminar e;

  DELETE FROM public.ventas_cupra v USING _a_eliminar e WHERE v.id = e.id;
  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;

  WITH upserted AS (
    INSERT INTO public.ventas_cupra (
      ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia, cajas,
      codigo_producto, nombre, marca, facturacion_ars, vendedor, telefono, celular,
      correo, direccion, ciudad, provincia, pais, categorias, client_id,
      tipo_comprobante, import_batch_id, bonificacion, renglon
    )
    SELECT i.ticket, i.letra, i.fecha_emision, i.cuit_dni, i.razon_social, i.fantasia, i.cajas,
           i.codigo_producto, i.nombre, i.marca, i.facturacion_ars, i.vendedor, i.telefono, i.celular,
           i.correo, i.direccion, i.ciudad, i.provincia, i.pais, i.categorias, i.client_id,
           COALESCE(NULLIF(i.tipo_comprobante,''),'venta'), p_batch_id, i.bonificacion, COALESCE(i.renglon, 1)
    FROM _incoming i
    ON CONFLICT (
      COALESCE(ticket,''),
      COALESCE(letra,''),
      COALESCE(fecha_emision, DATE '1900-01-01'),
      COALESCE(client_id,''),
      COALESCE(codigo_producto,''),
      COALESCE(tipo_comprobante,'venta'),
      COALESCE(bonificacion, -1),
      COALESCE(renglon, 1)
    ) DO UPDATE SET
      cuit_dni = EXCLUDED.cuit_dni,
      razon_social = EXCLUDED.razon_social,
      fantasia = EXCLUDED.fantasia,
      cajas = EXCLUDED.cajas,
      nombre = EXCLUDED.nombre,
      marca = EXCLUDED.marca,
      facturacion_ars = COALESCE(EXCLUDED.facturacion_ars, ventas_cupra.facturacion_ars),
      vendedor = EXCLUDED.vendedor,
      telefono = EXCLUDED.telefono,
      celular = EXCLUDED.celular,
      correo = EXCLUDED.correo,
      direccion = EXCLUDED.direccion,
      ciudad = EXCLUDED.ciudad,
      provincia = EXCLUDED.provincia,
      pais = EXCLUDED.pais,
      categorias = EXCLUDED.categorias,
      import_batch_id = EXCLUDED.import_batch_id
    RETURNING (xmax = 0) AS insertada
  )
  SELECT count(*) FILTER (WHERE insertada), count(*) FILTER (WHERE NOT insertada)
    INTO v_insertadas, v_actualizadas FROM upserted;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET
      fecha_desde = v_desde,
      fecha_hasta = v_hasta,
      modo_carga = CASE WHEN p_reemplazar THEN 'rango' ELSE 'agregar' END,
      clientes_archivo = v_clientes,
      total_bruto = v_total,
      filas_insertadas = v_insertadas,
      filas_actualizadas = v_actualizadas,
      filas_eliminadas = v_eliminadas
    WHERE id = p_batch_id;
  END IF;

  DROP TABLE _incoming;
  DROP TABLE _a_eliminar;

  RETURN jsonb_build_object(
    'fecha_desde', v_desde,
    'fecha_hasta', v_hasta,
    'filas_insertadas', v_insertadas,
    'filas_actualizadas', v_actualizadas,
    'filas_eliminadas', v_eliminadas,
    'filas_rango_base', v_rango_base,
    'clientes_archivo', v_clientes,
    'clientes_match', v_match,
    'total_bruto', v_total,
    'total_procesadas', v_insertadas + v_actualizadas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_client_metrics()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer;
BEGIN
  WITH ventas AS (
    SELECT
      v.client_id,
      SUM(COALESCE(v.facturacion_ars, 0)) AS bruto,
      SUM(COALESCE(v.cajas, 0)) AS cajas,
      SUM(COALESCE(v.cajas, 0)) FILTER (WHERE v.facturacion_ars IS NOT NULL) AS cajas_ci,
      COUNT(DISTINCT (COALESCE(v.ticket,'') || '|' || COALESCE(v.letra,'') || '|' || COALESCE(v.fecha_emision::text,''))) AS ordenes,
      MIN(v.fecha_emision) AS primera,
      COUNT(DISTINCT (COALESCE(v.ticket,'') || '|' || COALESCE(v.letra,'') || '|' || COALESCE(v.fecha_emision::text,''))) FILTER (WHERE v.facturacion_ars IS NOT NULL) AS ordenes_con_importe,
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
      base.client_id,
      COALESCE(ventas.bruto, 0) AS bruto,
      COALESCE(ventas.ordenes, 0) AS ordenes,
      COALESCE(ventas.ordenes_con_importe, 0) AS ordenes_con_importe,
      COALESCE(ventas.cajas_ci, 0) AS cajas_ci,
      ventas.primera,
      ventas.ultima,
      COALESCE(ventas.dias_distintos, 0) AS dias_distintos,
      COALESCE(ventas.cajas, 0) AS cajas,
      COALESCE(notas.nc_producto, 0) AS nc_producto,
      COALESCE(notas.nc_concepto, 0) AS nc_concepto,
      notas.fecha_ultima_nc
    FROM public.clientes base
    LEFT JOIN ventas ON ventas.client_id = base.client_id
    LEFT JOIN notas ON notas.client_id = base.client_id
  )
  UPDATE public.clientes c
  SET
    primera_compra = m.primera,
    ultima_compra = m.ultima,
    dias_desde_ultima_compra = CASE WHEN m.ultima IS NOT NULL THEN GREATEST(0, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - m.ultima) END,
    categoria_recencia = CASE WHEN m.ultima IS NULL THEN 'SIN_COMPRAS'
      WHEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - m.ultima <= 30 THEN 'ACTIVO'
      WHEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - m.ultima <= 90 THEN 'INACTIVO' ELSE 'PERDIDO' END,
    monto_total_historico = ROUND(m.bruto::numeric, 2),
    monto_total_cupra = ROUND(m.bruto::numeric, 2),
    cantidad_ordenes = m.ordenes,
    ticket_promedio = CASE WHEN m.ordenes_con_importe > 0 THEN ROUND((m.bruto / m.ordenes_con_importe)::numeric, 2) ELSE 0 END,
    precio_promedio_caja = CASE WHEN m.cajas_ci > 0 THEN ROUND((m.bruto / m.cajas_ci)::numeric, 2) ELSE NULL END,
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
  UPDATE public.clientes c SET
    participacion_mercado = CASE WHEN total.bruto>0 THEN round(c.monto_total_historico*100/total.bruto,2) ELSE 0 END,
    categoria_volumen = CASE WHEN total.bruto<=0 THEN 'BAJO' WHEN c.monto_total_historico/total.bruto>=0.1 THEN 'TOP_10' WHEN c.monto_total_historico/total.bruto>=0.05 THEN 'ALTO' WHEN c.monto_total_historico/total.bruto>=0.02 THEN 'MEDIO' ELSE 'BAJO' END,
    score_volumen = CASE WHEN c.cantidad_ordenes=0 THEN 0 WHEN total.bruto<=0 THEN 25 WHEN c.monto_total_historico/total.bruto>=0.1 THEN 100 WHEN c.monto_total_historico/total.bruto>=0.05 THEN 75 WHEN c.monto_total_historico/total.bruto>=0.02 THEN 50 ELSE 25 END,
    score_recencia = CASE WHEN c.ultima_compra IS NULL THEN 0 WHEN c.dias_desde_ultima_compra<=30 THEN 100 WHEN c.dias_desde_ultima_compra<=90 THEN 70 WHEN c.dias_desde_ultima_compra<=180 THEN 40 ELSE 10 END,
    requiere_visita = CASE WHEN c.dias_desde_ultima_compra<=15 THEN 'NO' ELSE 'SI' END
  FROM (SELECT COALESCE(sum(monto_total_historico),0) bruto FROM public.clientes) total;
  UPDATE public.clientes SET score_comercial=round(score_volumen*0.4+score_recencia*0.6);
  UPDATE public.clientes c SET vendedor_actual=v.vendedor FROM (
    SELECT DISTINCT ON(client_id) client_id,vendedor FROM public.ventas_cupra
    WHERE tipo_comprobante='venta' AND NULLIF(vendedor,'') IS NOT NULL
    ORDER BY client_id,fecha_emision DESC NULLS LAST,id DESC
  ) v WHERE v.client_id=c.client_id;
  RETURN updated_count;
END;
$function$;