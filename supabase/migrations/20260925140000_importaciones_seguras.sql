-- Importaciones atómicas y recuperables; no modifica datos comerciales al migrar.
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS respuesta jsonb;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS aplicado_at timestamptz;
ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_tipo_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_tipo_check CHECK (tipo IN ('maestro','ventas','prospectos'));
ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_estado_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_estado_check CHECK (estado IN ('procesando','completado','completado_con_errores','fallido','revertido'));

-- Las funciones con SECURITY DEFINER de agosto habían recuperado EXECUTE público al recrearse.
REVOKE ALL ON FUNCTION public.preview_ventas_import(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_ventas_import_rango(jsonb,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebase_ventas_cupra(jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revertir_import_ventas(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.preview_ventas_import(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN RAISE EXCEPTION 'El archivo no contiene ventas'; END IF;
  WITH incoming AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(ticket text,letra text,fecha_emision date,client_id text,codigo_producto text,facturacion_ars numeric,tipo_comprobante text,bonificacion numeric,renglon integer)
  ), rangos AS (
    SELECT COALESCE(NULLIF(tipo_comprobante,''),'venta') tipo,min(fecha_emision) desde,max(fecha_emision) hasta FROM incoming GROUP BY 1
  ), actuales AS (
    SELECT v.* FROM public.ventas_cupra v JOIN rangos r ON v.tipo_comprobante=r.tipo AND v.fecha_emision BETWEEN r.desde AND r.hasta
  ), ausentes AS (
    SELECT v.* FROM actuales v WHERE NOT EXISTS(SELECT 1 FROM incoming i WHERE
      COALESCE(i.ticket,'')=COALESCE(v.ticket,'') AND COALESCE(i.letra,'')=COALESCE(v.letra,'') AND i.fecha_emision=v.fecha_emision
      AND COALESCE(i.client_id,'')=COALESCE(v.client_id,'') AND COALESCE(i.codigo_producto,'')=COALESCE(v.codigo_producto,'')
      AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta')=v.tipo_comprobante AND COALESCE(i.bonificacion,-1)=COALESCE(v.bonificacion,-1) AND COALESCE(i.renglon,1)=v.renglon)
  ), stats AS (
    SELECT min(fecha_emision) desde,max(fecha_emision) hasta,count(*) filas,count(DISTINCT client_id) clientes,
      count(DISTINCT client_id) FILTER(WHERE EXISTS(SELECT 1 FROM clientes c WHERE c.client_id=i.client_id)) coincidencias,
      COALESCE(sum(facturacion_ars),0) total FROM incoming i
  ), base AS (SELECT count(*) filas,min(fecha_emision) desde,max(fecha_emision) hasta FROM ventas_cupra)
  SELECT jsonb_build_object('fecha_desde',s.desde,'fecha_hasta',s.hasta,'filas_archivo',s.filas,'clientes_archivo',s.clientes,
    'clientes_match',s.coincidencias,'pct_match_clientes',CASE WHEN s.clientes=0 THEN 0 ELSE round(s.coincidencias*100.0/s.clientes,1) END,
    'total_bruto',s.total,'filas_rango_base',(SELECT count(*) FROM actuales),'filas_a_eliminar',(SELECT count(*) FROM ausentes),
    'pct_eliminacion',COALESCE(round((SELECT count(*) FROM ausentes)*100.0/NULLIF((SELECT count(*) FROM actuales),0),1),0),
    'requiere_confirmacion',(SELECT count(*) FROM ausentes)>(SELECT count(*) FROM actuales)*0.2,
    'archivo_ajeno',b.filas>0 AND s.clientes>0 AND s.coincidencias<s.clientes*0.5,
    'base_filas',b.filas,'base_vacia',b.filas=0,'base_desde',b.desde,'base_hasta',b.hasta)
  INTO result FROM stats s CROSS JOIN base b;
  IF result->>'fecha_desde' IS NULL THEN RAISE EXCEPTION 'No hay fechas de emisión válidas'; END IF;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.preview_ventas_import(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_ventas_import(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.aplicar_ventas_import(p_rows jsonb, p_batch_id uuid, p_confirmar_eliminaciones boolean, p_reemplazar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_desde date; v_hasta date;
  v_rango_base int; v_eliminar int; v_eliminadas int := 0;
  v_clientes int; v_match int; v_base_total int;
  v_insertadas int := 0; v_actualizadas int := 0; v_total numeric;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'fecha_emision','') IS NULL OR NULLIF(r->>'client_id','') IS NULL OR NULLIF(r->>'ticket','') IS NULL OR r->>'facturacion_ars' IS NULL) THEN
    RAISE EXCEPTION 'Hay ventas sin fecha, comprobante, cliente o importe válido. No se modificó nada.';
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
      facturacion_ars = EXCLUDED.facturacion_ars,
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
$fn$;

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
      base.client_id,
      COALESCE(ventas.bruto, 0) AS bruto,
      COALESCE(ventas.ordenes, 0) AS ordenes,
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
$$;

GRANT EXECUTE ON FUNCTION public.recompute_client_metrics() TO service_role;
CREATE OR REPLACE FUNCTION public.guardar_clientes_import(p_rows jsonb, p_tipo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r jsonb; patch jsonb; old_row public.clientes; merged public.clientes; nuevos int:=0; actualizados int:=0;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'client_id' LOOP
    IF NULLIF(r->>'client_id','') IS NULL THEN RAISE EXCEPTION 'Cliente sin identificador'; END IF;
    SELECT jsonb_object_agg(key,value) INTO patch FROM jsonb_each(r)
      WHERE key=ANY(ARRAY['cuit_dni','razon_social','fantasia','telefonos','emails','direccion_principal','codigo_postal','ciudad_principal','provincia_principal','barrio_principal','vendedor_actual','vendedor_principal','etiquetas','canal','todos_barrios','todas_ciudades','todas_direcciones','todos_vendedores','productos_comprados']) AND value NOT IN ('null'::jsonb,'[]'::jsonb,'""'::jsonb);
    patch:=COALESCE(patch,'{}'::jsonb);
    SELECT * INTO old_row FROM public.clientes WHERE client_id=r->>'client_id' FOR UPDATE;
    IF FOUND THEN
      -- Una importación no modifica una dirección corregida por una persona.
      IF EXISTS(SELECT 1 FROM public.client_places WHERE client_id=old_row.client_id AND (direccion_verificada OR fuente_geocoding='manual')) THEN
        patch:=patch - ARRAY['direccion_principal','barrio_principal','ciudad_principal','provincia_principal','codigo_postal'];
      END IF;
      -- El maestro completa la cartera; una venta antigua no cambia el vendedor actual.
      IF p_tipo='ventas' OR EXISTS(SELECT 1 FROM public.ventas_cupra WHERE client_id=old_row.client_id AND vendedor IS NOT NULL) THEN
        IF old_row.vendedor_actual IS NOT NULL THEN patch:=patch-'vendedor_actual'; END IF;
      END IF;
      IF p_tipo='ventas' AND cardinality(old_row.etiquetas)>0 THEN patch:=patch-'etiquetas'; END IF;
      merged:=jsonb_populate_record(old_row,patch);
      UPDATE public.clientes SET (cuit_dni,razon_social,fantasia,telefonos,emails,direccion_principal,codigo_postal,ciudad_principal,provincia_principal,barrio_principal,vendedor_actual,vendedor_principal,etiquetas,canal,todos_barrios,todas_ciudades,todas_direcciones,todos_vendedores,productos_comprados,updated_at)=(merged.cuit_dni,merged.razon_social,merged.fantasia,merged.telefonos,merged.emails,merged.direccion_principal,merged.codigo_postal,merged.ciudad_principal,merged.provincia_principal,merged.barrio_principal,merged.vendedor_actual,merged.vendedor_principal,merged.etiquetas,merged.canal,merged.todos_barrios,merged.todas_ciudades,merged.todas_direcciones,merged.todos_vendedores,merged.productos_comprados,now()) WHERE client_id=old_row.client_id;
      actualizados:=actualizados+1;
    ELSE
      merged:=jsonb_populate_record(NULL::public.clientes,patch||jsonb_build_object('client_id',r->>'client_id'));
      INSERT INTO public.clientes(client_id,cuit_dni,razon_social,fantasia,telefonos,emails,direccion_principal,codigo_postal,ciudad_principal,provincia_principal,barrio_principal,vendedor_actual,vendedor_principal,etiquetas,canal,todos_barrios,todas_ciudades,todas_direcciones,todos_vendedores,productos_comprados) VALUES(merged.client_id,merged.cuit_dni,merged.razon_social,merged.fantasia,merged.telefonos,merged.emails,merged.direccion_principal,merged.codigo_postal,merged.ciudad_principal,merged.provincia_principal,merged.barrio_principal,merged.vendedor_actual,merged.vendedor_principal,merged.etiquetas,merged.canal,merged.todos_barrios,merged.todas_ciudades,merged.todas_direcciones,merged.todos_vendedores,merged.productos_comprados);
      nuevos:=nuevos+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('clientes_nuevos',nuevos,'clientes_actualizados',actualizados);
END $fn$;

CREATE OR REPLACE FUNCTION public.guardar_ubicacion_cliente(p_client_id text, p_datos jsonb, p_manual boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE selected public.client_places; candidate public.client_places; existing_id uuid; source text;
BEGIN
  PERFORM 1 FROM public.clientes WHERE client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente inexistente'; END IF;
  IF NOT p_manual AND EXISTS(SELECT 1 FROM public.client_places WHERE client_id=p_client_id AND (direccion_verificada OR fuente_geocoding='manual')) THEN
    RETURN jsonb_build_object('guardado',false,'protegida',true);
  END IF;
  source:=CASE WHEN p_manual THEN 'manual' ELSE COALESCE(p_datos->>'fuente_geocoding','geocoding_auto') END;
  IF source NOT IN ('manual','excel','erp') AND EXISTS(SELECT 1 FROM public.client_places WHERE client_id=p_client_id AND fuente_geocoding IN ('excel','erp')) THEN
    RETURN jsonb_build_object('guardado',false,'protegida',true);
  END IF;
  candidate:=jsonb_populate_record(NULL::public.client_places,p_datos);
  IF candidate.lat IS NULL OR candidate.long IS NULL OR NOT(candidate.lat BETWEEN -56 AND -21 AND candidate.long BETWEEN -74 AND -53) THEN
    RAISE EXCEPTION 'Coordenadas inválidas para Argentina';
  END IF;
  SELECT * INTO selected FROM public.client_places WHERE client_id=p_client_id
    AND (lat=candidate.lat AND long=candidate.long OR direccion_principal=candidate.direccion_principal OR p_manual AND is_primary)
    ORDER BY (lat=candidate.lat AND long=candidate.long) DESC, direccion_verificada DESC,is_primary DESC,created_at DESC LIMIT 1 FOR UPDATE;
  existing_id:=selected.id;
  IF existing_id IS NOT NULL THEN
    -- Dos claves únicas: conservar el domicilio de la fila si otra ya tiene el mismo texto.
    IF EXISTS(SELECT 1 FROM public.client_places WHERE client_id=p_client_id AND id<>existing_id AND direccion_principal=candidate.direccion_principal) THEN
      candidate.direccion_principal:=selected.direccion_principal;
    END IF;
    UPDATE public.client_places SET
      lat=candidate.lat,long=candidate.long,
      direccion_principal=COALESCE(candidate.direccion_principal,direccion_principal),
      barrio_principal=COALESCE(candidate.barrio_principal,barrio_principal),
      provincia_principal=COALESCE(candidate.provincia_principal,provincia_principal),
      comuna=COALESCE(candidate.comuna,comuna),codigo_postal=COALESCE(candidate.codigo_postal,codigo_postal),
      place_id=candidate.place_id,
      google_maps_link='https://www.google.com/maps/search/?api=1&query='||candidate.lat||','||candidate.long,
      direccion_verificada=p_manual, fuente_geocoding=source,
      ubicacion_confiable=true,precision_geocoding=COALESCE(candidate.precision_geocoding,source),updated_at=now()
    WHERE id=existing_id;
  ELSE
    INSERT INTO public.client_places(client_id,lat,long,direccion_principal,barrio_principal,provincia_principal,comuna,codigo_postal,place_id,google_maps_link,direccion_verificada,fuente_geocoding,ubicacion_confiable,precision_geocoding,is_primary)
    VALUES(p_client_id,candidate.lat,candidate.long,candidate.direccion_principal,candidate.barrio_principal,candidate.provincia_principal,candidate.comuna,candidate.codigo_postal,candidate.place_id,
      'https://www.google.com/maps/search/?api=1&query='||candidate.lat||','||candidate.long,p_manual,source,true,COALESCE(candidate.precision_geocoding,source),false)
    RETURNING id INTO existing_id;
  END IF;
  UPDATE public.client_places SET is_primary=false WHERE client_id=p_client_id AND is_primary IS TRUE AND id<>existing_id;
  UPDATE public.client_places SET is_primary=true WHERE id=existing_id;
  UPDATE public.clientes SET
    direccion_principal=CASE WHEN p_manual THEN COALESCE(candidate.direccion_principal,direccion_principal) ELSE direccion_principal END,
    barrio_principal=COALESCE(candidate.barrio_principal,barrio_principal),
    provincia_principal=COALESCE(candidate.provincia_principal,provincia_principal),updated_at=now()
    WHERE client_id=p_client_id;
  RETURN jsonb_build_object('guardado',true,'id',existing_id,'lat',candidate.lat,'lng',candidate.long);
END $fn$;

CREATE OR REPLACE FUNCTION public.guardar_importacion(p_batch_id uuid,p_clientes jsonb,p_places jsonb,p_ventas jsonb DEFAULT NULL,p_reemplazar boolean DEFAULT false,p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE lote public.import_batches; totals jsonb; rango jsonb; previa jsonb; response jsonb; r jsonb; ubicaciones int:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cupra_importacion'));
  SELECT * INTO lote FROM public.import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR lote.tipo NOT IN ('maestro','ventas') THEN RAISE EXCEPTION 'Lote de importación inválido'; END IF;
  IF lote.revertido_at IS NOT NULL THEN RAISE EXCEPTION 'El lote fue revertido'; END IF;
  IF lote.respuesta IS NOT NULL THEN RETURN lote.respuesta; END IF;
  IF lote.tipo='ventas' THEN
    previa:=public.preview_ventas_import(p_ventas);
    IF (previa->>'archivo_ajeno')::boolean THEN RAISE EXCEPTION 'Los clientes del archivo no coinciden con la base. No se modificó nada.'; END IF;
    IF p_reemplazar AND COALESCE((previa->>'requiere_confirmacion')::boolean,false) AND NOT p_confirmar THEN
      RAISE EXCEPTION 'El archivo elimina más del 20%% de las ventas del período. Se requiere confirmación explícita. No se modificó nada.';
    END IF;
  END IF;
  totals:=public.guardar_clientes_import(p_clientes,lote.tipo);
  FOR r IN SELECT value FROM jsonb_array_elements(p_places) LOOP
    IF (public.guardar_ubicacion_cliente(r->>'client_id',r||'{"fuente_geocoding":"excel"}'::jsonb)->>'guardado')::boolean THEN ubicaciones:=ubicaciones+1; END IF;
  END LOOP;
  IF lote.tipo='ventas' THEN
    rango:=public.aplicar_ventas_import(p_ventas,p_batch_id,p_confirmar,p_reemplazar);
    PERFORM public.recompute_client_metrics();
    totals:=totals||jsonb_build_object('ventas_procesadas',(rango->>'total_procesadas')::int,'ventas_errores',0,
      'clientes_actualizados',(totals->>'clientes_nuevos')::int+(totals->>'clientes_actualizados')::int);
  END IF;
  PERFORM public.refrescar_rubros();
  totals:=totals||jsonb_build_object('clientes_errores',0,'coordenadas_actualizadas',ubicaciones,'sin_resolver',0,'sin_vendedor',(SELECT count(*) FROM jsonb_array_elements(p_clientes) c WHERE NULLIF(c->>'vendedor_actual','') IS NULL),'errores','[]'::jsonb);
  response:=jsonb_build_object('success',true,'batch_id',p_batch_id,'results',totals,'rango',rango);
  UPDATE public.import_batches SET respuesta=response,resultado=totals,estado='completado',aplicado_at=now(),completed_at=now() WHERE id=p_batch_id;
  RETURN response;
END $fn$;
CREATE OR REPLACE FUNCTION public.revertir_import_ventas(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_borradas int := 0; v_restauradas int := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador del lote a revertir';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND activo AND rol::text IN ('administrador','asignador')
  ) THEN RAISE EXCEPTION 'Solo un asignador o administrador activo puede revertir una carga'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cupra_importacion'));
  PERFORM 1 FROM public.import_batches WHERE id = p_batch_id AND tipo='ventas'
    AND estado IN ('completado','completado_con_errores') AND revertido_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El lote no está completado o ya fue revertido'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.import_batches newer JOIN public.import_batches target ON target.id=p_batch_id
    WHERE newer.tipo='ventas' AND newer.revertido_at IS NULL
      AND newer.estado IN ('completado','completado_con_errores')
      AND COALESCE(newer.aplicado_at,newer.completed_at) > COALESCE(target.aplicado_at,target.completed_at)
      AND (newer.modo_carga='rebase' OR target.modo_carga='rebase' OR newer.fecha_desde <= target.fecha_hasta AND newer.fecha_hasta >= target.fecha_desde)
  ) THEN RAISE EXCEPTION 'Hay una carga posterior sobre este período. Revertí primero la carga más reciente.'; END IF;

  DELETE FROM public.ventas_cupra WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  INSERT INTO public.ventas_cupra (
    ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia, cajas,
    codigo_producto, nombre, marca, facturacion_ars, vendedor, telefono, celular,
    correo, direccion, ciudad, provincia, pais, categorias, client_id,
    tipo_comprobante, import_batch_id, bonificacion, renglon
  )
  SELECT e.ticket, e.letra, e.fecha_emision, e.cuit_dni, e.razon_social, e.fantasia, e.cajas,
         e.codigo_producto, e.nombre, e.marca, e.facturacion_ars, e.vendedor, e.telefono, e.celular,
         e.correo, e.direccion, e.ciudad, e.provincia, e.pais, e.categorias, e.client_id,
         COALESCE(e.tipo_comprobante,'venta'), e.import_batch_id, e.bonificacion, COALESCE(e.renglon, 1)
  FROM public.ventas_cupra_eliminadas e
  WHERE e.batch_id = p_batch_id
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
    facturacion_ars = EXCLUDED.facturacion_ars,
    vendedor = EXCLUDED.vendedor,
    telefono = EXCLUDED.telefono,
    celular = EXCLUDED.celular,
    correo = EXCLUDED.correo,
    direccion = EXCLUDED.direccion,
    ciudad = EXCLUDED.ciudad,
    provincia = EXCLUDED.provincia,
    pais = EXCLUDED.pais,
    categorias = EXCLUDED.categorias,
    import_batch_id = EXCLUDED.import_batch_id;
  GET DIAGNOSTICS v_restauradas = ROW_COUNT;

  -- Se conserva el respaldo para auditoría; revertido_at evita repetir la operación.

  UPDATE public.import_batches SET revertido_at = now(), estado = 'revertido' WHERE id = p_batch_id;

  PERFORM public.recompute_client_metrics();

  RETURN jsonb_build_object('filas_borradas', v_borradas, 'filas_restauradas', v_restauradas);
END;
$fn$;
REVOKE ALL ON FUNCTION public.aplicar_ventas_import(jsonb,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guardar_clientes_import(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guardar_ubicacion_cliente(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guardar_importacion(uuid,jsonb,jsonb,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_ventas_import(jsonb,uuid,boolean,boolean),public.guardar_clientes_import(jsonb,text),public.guardar_ubicacion_cliente(text,jsonb,boolean),public.guardar_importacion(uuid,jsonb,jsonb,jsonb,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_import_ventas(uuid) TO authenticated;

ALTER TABLE public.prospectos ADD COLUMN IF NOT EXISTS import_key text;
ALTER TABLE public.prospectos ADD COLUMN IF NOT EXISTS google_place_id text;
CREATE UNIQUE INDEX IF NOT EXISTS prospectos_import_key_unique ON public.prospectos(import_key) WHERE import_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.import_identity(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $fn$
  SELECT regexp_replace(translate(lower(COALESCE(p_text,'')),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g');
$fn$;

CREATE TABLE IF NOT EXISTS public.import_prospectos_filas (
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  place_id text NOT NULL REFERENCES public.prospectos(place_id) ON DELETE CASCADE,
  PRIMARY KEY(batch_id,place_id)
);
ALTER TABLE public.import_prospectos_filas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_prospectos_filas FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.import_prospectos_filas TO service_role;

CREATE OR REPLACE FUNCTION public.guardar_prospectos_import(p_batch_id uuid,p_rows jsonb,p_resultados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE lote public.import_batches; r jsonb; existing public.prospectos; candidate public.prospectos; response jsonb; n int:=0; matched int:=0; matches int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cupra_importacion'));
  SELECT * INTO lote FROM public.import_batches WHERE id=p_batch_id AND tipo='prospectos' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de prospectos inválido'; END IF;
  IF lote.respuesta IS NOT NULL THEN RETURN lote.respuesta; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    candidate:=jsonb_populate_record(NULL::public.prospectos,r);
    IF candidate.import_key IS NULL OR candidate.nombre IS NULL OR candidate.direccion IS NULL THEN RAISE EXCEPTION 'Prospecto incompleto'; END IF;
    SELECT count(*) INTO matches FROM public.prospectos WHERE import_key=candidate.import_key OR place_id=candidate.place_id
      OR (public.import_identity(nombre)=public.import_identity(candidate.nombre)
        AND public.import_identity(direccion)=public.import_identity(candidate.direccion)
        AND public.import_identity(ciudad)=public.import_identity(candidate.ciudad));
    IF matches>1 THEN RAISE EXCEPTION 'El prospecto % coincide con varias fichas existentes. Revisá los duplicados antes de importar.',candidate.nombre; END IF;
    SELECT * INTO existing FROM public.prospectos WHERE import_key=candidate.import_key OR place_id=candidate.place_id
      OR (public.import_identity(nombre)=public.import_identity(candidate.nombre)
        AND public.import_identity(direccion)=public.import_identity(candidate.direccion)
        AND public.import_identity(ciudad)=public.import_identity(candidate.ciudad)) LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      -- Completar faltantes sin reabrir negocios ni perder conversiones, correcciones o recomendaciones.
      UPDATE public.prospectos SET import_key=COALESCE(import_key,candidate.import_key),
        telefono=COALESCE(NULLIF(telefono,''),candidate.telefono), email=COALESCE(NULLIF(email,''),candidate.email),
        instagram=COALESCE(NULLIF(instagram,''),candidate.instagram),
        rubro=COALESCE(NULLIF(rubro,''),candidate.rubro),
        latitud=CASE WHEN latitud=0 AND longitud=0 THEN candidate.latitud ELSE latitud END,
        longitud=CASE WHEN latitud=0 AND longitud=0 THEN candidate.longitud ELSE longitud END,
        updated_at=now() WHERE id=existing.id;
      INSERT INTO public.import_prospectos_filas VALUES(p_batch_id,existing.place_id) ON CONFLICT DO NOTHING;
      matched:=matched+1;
    ELSE
      INSERT INTO public.prospectos(place_id,import_key,client_id,nombre,direccion,barrio,ciudad,provincia,latitud,longitud,
        telefono,email,instagram,rubro,tipo_principal,estado_negocio,es_cliente_cupra)
      VALUES(candidate.place_id,candidate.import_key,candidate.client_id,candidate.nombre,candidate.direccion,candidate.barrio,
        candidate.ciudad,candidate.provincia,COALESCE(candidate.latitud,0),COALESCE(candidate.longitud,0),candidate.telefono,
        candidate.email,candidate.instagram,candidate.rubro,candidate.tipo_principal,'OPERATIONAL',candidate.client_id IS NOT NULL);
      INSERT INTO public.import_prospectos_filas VALUES(p_batch_id,candidate.place_id) ON CONFLICT DO NOTHING;
      n:=n+1;
    END IF;
  END LOOP;
  response:=jsonb_build_object('success',true,'batch_id',p_batch_id,'results',p_resultados||jsonb_build_object(
    'prospectos_cargados',n,'prospectos_existentes',matched,
    'geocodificados',(SELECT count(*) FROM prospectos p JOIN import_prospectos_filas f USING(place_id) WHERE f.batch_id=p_batch_id AND p.latitud BETWEEN -56 AND -21 AND p.longitud BETWEEN -74 AND -53),
    'sin_coordenadas',(SELECT count(*) FROM prospectos p JOIN import_prospectos_filas f USING(place_id) WHERE f.batch_id=p_batch_id AND (p.latitud=0 OR p.longitud=0)),
    'ya_son_clientes',(SELECT count(*) FROM prospectos p JOIN import_prospectos_filas f USING(place_id) WHERE f.batch_id=p_batch_id AND p.es_cliente_cupra)));

  UPDATE public.import_batches SET estado='completado',respuesta=response,resultado=response->'results',aplicado_at=now(),completed_at=now() WHERE id=p_batch_id;
  RETURN response;
END $fn$;
REVOKE ALL ON FUNCTION public.guardar_prospectos_import(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_prospectos_import(uuid,jsonb,jsonb) TO service_role;

-- Cursor over pending locations: requests finish in small batches and resume after failures.
CREATE OR REPLACE FUNCTION public.pendientes_geocodificacion(p_tipo text DEFAULT 'clientes',p_despues text DEFAULT '',p_limite int DEFAULT 5,p_batch uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE result jsonb;
BEGIN
  IF p_tipo='prospectos' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO result FROM (
      SELECT place_id AS id,nombre AS nombre,direccion,ciudad,provincia,barrio,latitud AS lat,longitud AS lng
      FROM public.prospectos p WHERE (p_batch IS NULL OR EXISTS(SELECT 1 FROM public.import_prospectos_filas f WHERE f.batch_id=p_batch AND f.place_id=p.place_id)) AND place_id>p_despues AND (latitud=0 OR longitud=0)
        AND COALESCE(estado_negocio,'OPERATIONAL') NOT IN ('CLOSED_PERMANENTLY','CLOSED_TEMPORARILY')
        AND NOT COALESCE(es_cliente_cupra,false)
      ORDER BY place_id LIMIT LEAST(GREATEST(p_limite,1),5)
    ) p;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO result FROM (
      SELECT c.client_id AS id,c.razon_social AS nombre,c.direccion_principal AS direccion,c.ciudad_principal AS ciudad,
        c.provincia_principal AS provincia,c.codigo_postal,c.barrio_principal AS barrio,
        cp.id AS location_id,cp.lat,cp.long AS lng,cp.barrio_principal AS barrio_ubicacion
      FROM public.clientes c LEFT JOIN LATERAL (
        SELECT * FROM public.client_places WHERE client_id=c.client_id
          AND lat BETWEEN -56 AND -21 AND long BETWEEN -74 AND -53
        ORDER BY direccion_verificada DESC,is_primary DESC,created_at DESC LIMIT 1
      ) cp ON true
      WHERE c.client_id>p_despues AND (cp.id IS NULL OR NULLIF(cp.barrio_principal,'') IS NULL OR NULLIF(c.barrio_principal,'') IS NULL)
      ORDER BY c.client_id LIMIT LEAST(GREATEST(p_limite,1),5)
    ) p;
  END IF;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.pendientes_geocodificacion(text,text,int,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pendientes_geocodificacion(text,text,int,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.completar_barrio_ubicacion(p_id uuid,p_lat numeric,p_lng numeric,p_barrio text,p_comuna text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE cid text;
BEGIN
  IF NULLIF(p_barrio,'') IS NULL THEN RAISE EXCEPTION 'Barrio no identificado'; END IF;
  SELECT client_id INTO cid FROM public.client_places WHERE id=p_id AND lat=p_lat AND long=p_lng;
  IF NOT FOUND THEN RAISE EXCEPTION 'La ubicación cambió durante la consulta. Volvé a intentar.'; END IF;
  PERFORM 1 FROM public.clientes WHERE client_id=cid FOR UPDATE;
  UPDATE public.client_places SET barrio_principal=COALESCE(NULLIF(barrio_principal,''),p_barrio),comuna=COALESCE(comuna,p_comuna)
    WHERE id=p_id AND lat=p_lat AND long=p_lng;
  IF NOT FOUND THEN RAISE EXCEPTION 'La ubicación cambió durante la consulta'; END IF;
  UPDATE public.clientes SET barrio_principal=p_barrio WHERE client_id=cid AND NULLIF(barrio_principal,'') IS NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.completar_barrio_ubicacion(uuid,numeric,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.completar_barrio_ubicacion(uuid,numeric,numeric,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.resumen_ubicaciones() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND activo AND rol::text IN ('administrador','asignador')) THEN
    RAISE EXCEPTION 'Sesión de asignador o administrador activo requerida';
  END IF;
  RETURN jsonb_build_object('pendientes',(
    SELECT count(*) FROM clientes c WHERE NULLIF(c.barrio_principal,'') IS NULL OR NOT EXISTS(
      SELECT 1 FROM client_places p WHERE p.client_id=c.client_id AND p.lat BETWEEN -56 AND -21 AND p.long BETWEEN -74 AND -53 AND NULLIF(p.barrio_principal,'') IS NOT NULL
    )
  ));
END $fn$;
REVOKE ALL ON FUNCTION public.resumen_ubicaciones() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resumen_ubicaciones() TO authenticated;
