-- ============ OT8: carga segura por rango ============

-- 1. Identidad de línea sin importe: consolidar duplicados previos
DELETE FROM public.ventas_cupra a
USING public.ventas_cupra b
WHERE a.id < b.id
  AND COALESCE(a.ticket,'') = COALESCE(b.ticket,'')
  AND COALESCE(a.letra,'') = COALESCE(b.letra,'')
  AND COALESCE(a.fecha_emision, DATE '1900-01-01') = COALESCE(b.fecha_emision, DATE '1900-01-01')
  AND COALESCE(a.client_id,'') = COALESCE(b.client_id,'')
  AND COALESCE(a.codigo_producto,'') = COALESCE(b.codigo_producto,'')
  AND COALESCE(a.tipo_comprobante,'venta') = COALESCE(b.tipo_comprobante,'venta');

DROP INDEX IF EXISTS public.ventas_cupra_unique_venta;

CREATE UNIQUE INDEX ventas_cupra_unique_venta ON public.ventas_cupra (
  COALESCE(ticket,''),
  COALESCE(letra,''),
  COALESCE(fecha_emision, DATE '1900-01-01'),
  COALESCE(client_id,''),
  COALESCE(codigo_producto,''),
  COALESCE(tipo_comprobante,'venta')
);

ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS import_batch_id uuid;
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_batch ON public.ventas_cupra(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_fecha ON public.ventas_cupra(fecha_emision);

-- 2. Tabla de respaldo de filas eliminadas / pisadas
CREATE TABLE IF NOT EXISTS public.ventas_cupra_eliminadas (
  id bigserial PRIMARY KEY,
  batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  motivo text NOT NULL DEFAULT 'eliminada',
  venta_id bigint,
  client_id text,
  ticket text,
  letra text,
  fecha_emision date,
  cuit_dni text,
  razon_social text,
  fantasia text,
  cajas integer,
  codigo_producto text,
  nombre text,
  marca text,
  facturacion_ars numeric,
  vendedor text,
  telefono text,
  celular text,
  correo text,
  direccion text,
  ciudad text,
  provincia text,
  pais text,
  categorias text,
  tipo_comprobante text,
  import_batch_id uuid,
  eliminada_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ventas_cupra_eliminadas TO authenticated;
GRANT ALL ON public.ventas_cupra_eliminadas TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ventas_cupra_eliminadas_id_seq TO service_role;
ALTER TABLE public.ventas_cupra_eliminadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Asignadores ven ventas eliminadas" ON public.ventas_cupra_eliminadas;
CREATE POLICY "Asignadores ven ventas eliminadas" ON public.ventas_cupra_eliminadas
  FOR SELECT TO authenticated USING (public.is_assignor_like(auth.uid()));
DROP POLICY IF EXISTS "Service role gestiona ventas eliminadas" ON public.ventas_cupra_eliminadas;
CREATE POLICY "Service role gestiona ventas eliminadas" ON public.ventas_cupra_eliminadas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ventas_eliminadas_batch ON public.ventas_cupra_eliminadas(batch_id);

-- 3. Metadatos del lote
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS fecha_desde date,
  ADD COLUMN IF NOT EXISTS fecha_hasta date,
  ADD COLUMN IF NOT EXISTS modo_carga text NOT NULL DEFAULT 'rango',
  ADD COLUMN IF NOT EXISTS clientes_archivo integer,
  ADD COLUMN IF NOT EXISTS total_bruto numeric,
  ADD COLUMN IF NOT EXISTS filas_insertadas integer,
  ADD COLUMN IF NOT EXISTS filas_actualizadas integer,
  ADD COLUMN IF NOT EXISTS filas_eliminadas integer,
  ADD COLUMN IF NOT EXISTS revertido_at timestamptz;

-- 4. Vista previa (sin tocar datos)
CREATE OR REPLACE FUNCTION public.preview_ventas_import(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    codigo_producto text, facturacion_ars numeric, tipo_comprobante text
  );

  SELECT min(fecha_emision), max(fecha_emision), count(*), count(DISTINCT client_id), COALESCE(sum(facturacion_ars),0)
    INTO v_desde, v_hasta, v_filas, v_clientes, v_total
  FROM _prev_incoming;

  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'El archivo no tiene fechas de emisión válidas: no se puede determinar el período';
  END IF;

  SELECT count(*), min(fecha_emision), max(fecha_emision) INTO v_base_total, v_base_desde, v_base_hasta
  FROM public.ventas_cupra;

  SELECT count(*) INTO v_rango_base FROM public.ventas_cupra v
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta;

  SELECT count(*) INTO v_eliminar FROM public.ventas_cupra v
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta
    AND NOT EXISTS (
      SELECT 1 FROM _prev_incoming i
      WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
        AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
        AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
        AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
        AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
        AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
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
$$;

-- 5. Commit por rango: única carga automática
CREATE OR REPLACE FUNCTION public.commit_ventas_import_rango(
  p_rows jsonb,
  p_batch_id uuid DEFAULT NULL,
  p_confirmar_eliminaciones boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_desde date; v_hasta date;
  v_rango_base int; v_eliminar int; v_eliminadas int := 0;
  v_clientes int; v_match int; v_base_total int;
  v_insertadas int := 0; v_actualizadas int := 0; v_total numeric;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  CREATE TEMP TABLE _incoming ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(p_rows) AS x(
    ticket text, letra text, fecha_emision date, cuit_dni text, razon_social text,
    fantasia text, cajas integer, codigo_producto text, nombre text, marca text,
    facturacion_ars numeric, vendedor text, telefono text, celular text, correo text,
    direccion text, ciudad text, provincia text, pais text, categorias text,
    client_id text, tipo_comprobante text
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
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta;

  CREATE TEMP TABLE _a_eliminar ON COMMIT DROP AS
  SELECT v.* FROM public.ventas_cupra v
  WHERE v.fecha_emision BETWEEN v_desde AND v_hasta
    AND NOT EXISTS (
      SELECT 1 FROM _incoming i
      WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
        AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
        AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
        AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
        AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
        AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
    );

  SELECT count(*) INTO v_eliminar FROM _a_eliminar;

  IF v_rango_base > 0 AND v_eliminar::numeric > v_rango_base * 0.2 AND NOT p_confirmar_eliminaciones THEN
    RAISE EXCEPTION 'Este archivo elimina % de % filas del período % a % (más del 20%%). Se requiere confirmación explícita. No se modificó nada.', v_eliminar, v_rango_base, v_desde, v_hasta;
  END IF;

  -- Respaldo de filas que se van a pisar (para poder revertir)
  INSERT INTO public.ventas_cupra_eliminadas (
    batch_id, motivo, venta_id, client_id, ticket, letra, fecha_emision, cuit_dni,
    razon_social, fantasia, cajas, codigo_producto, nombre, marca, facturacion_ars,
    vendedor, telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, tipo_comprobante, import_batch_id
  )
  SELECT p_batch_id, 'actualizada', v.id, v.client_id, v.ticket, v.letra, v.fecha_emision, v.cuit_dni,
         v.razon_social, v.fantasia, v.cajas, v.codigo_producto, v.nombre, v.marca, v.facturacion_ars,
         v.vendedor, v.telefono, v.celular, v.correo, v.direccion, v.ciudad, v.provincia, v.pais,
         v.categorias, v.tipo_comprobante, v.import_batch_id
  FROM public.ventas_cupra v
  WHERE EXISTS (
    SELECT 1 FROM _incoming i
    WHERE COALESCE(i.ticket,'') = COALESCE(v.ticket,'')
      AND COALESCE(i.letra,'') = COALESCE(v.letra,'')
      AND COALESCE(i.fecha_emision, DATE '1900-01-01') = COALESCE(v.fecha_emision, DATE '1900-01-01')
      AND COALESCE(i.client_id,'') = COALESCE(v.client_id,'')
      AND COALESCE(i.codigo_producto,'') = COALESCE(v.codigo_producto,'')
      AND COALESCE(NULLIF(i.tipo_comprobante,''),'venta') = COALESCE(v.tipo_comprobante,'venta')
  );

  -- Respaldo + borrado SOLO dentro del rango del archivo
  INSERT INTO public.ventas_cupra_eliminadas (
    batch_id, motivo, venta_id, client_id, ticket, letra, fecha_emision, cuit_dni,
    razon_social, fantasia, cajas, codigo_producto, nombre, marca, facturacion_ars,
    vendedor, telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, tipo_comprobante, import_batch_id
  )
  SELECT p_batch_id, 'eliminada', e.id, e.client_id, e.ticket, e.letra, e.fecha_emision, e.cuit_dni,
         e.razon_social, e.fantasia, e.cajas, e.codigo_producto, e.nombre, e.marca, e.facturacion_ars,
         e.vendedor, e.telefono, e.celular, e.correo, e.direccion, e.ciudad, e.provincia, e.pais,
         e.categorias, e.tipo_comprobante, e.import_batch_id
  FROM _a_eliminar e;

  DELETE FROM public.ventas_cupra v USING _a_eliminar e WHERE v.id = e.id;
  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;

  -- Upsert por clave natural (el importe se ACTUALIZA, no duplica)
  WITH upserted AS (
    INSERT INTO public.ventas_cupra (
      ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia, cajas,
      codigo_producto, nombre, marca, facturacion_ars, vendedor, telefono, celular,
      correo, direccion, ciudad, provincia, pais, categorias, client_id,
      tipo_comprobante, import_batch_id
    )
    SELECT i.ticket, i.letra, i.fecha_emision, i.cuit_dni, i.razon_social, i.fantasia, i.cajas,
           i.codigo_producto, i.nombre, i.marca, i.facturacion_ars, i.vendedor, i.telefono, i.celular,
           i.correo, i.direccion, i.ciudad, i.provincia, i.pais, i.categorias, i.client_id,
           COALESCE(NULLIF(i.tipo_comprobante,''),'venta'), p_batch_id
    FROM _incoming i
    ON CONFLICT (
      COALESCE(ticket,''),
      COALESCE(letra,''),
      COALESCE(fecha_emision, DATE '1900-01-01'),
      COALESCE(client_id,''),
      COALESCE(codigo_producto,''),
      COALESCE(tipo_comprobante,'venta')
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
      categorias = EXCLUDED.categorias
    RETURNING (xmax = 0) AS insertada
  )
  SELECT count(*) FILTER (WHERE insertada), count(*) FILTER (WHERE NOT insertada)
    INTO v_insertadas, v_actualizadas FROM upserted;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET
      fecha_desde = v_desde,
      fecha_hasta = v_hasta,
      modo_carga = 'rango',
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
$$;

-- 6. Revertir una carga
CREATE OR REPLACE FUNCTION public.revertir_import_ventas(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_borradas int := 0; v_restauradas int := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador del lote a revertir';
  END IF;

  DELETE FROM public.ventas_cupra WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  INSERT INTO public.ventas_cupra (
    ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia, cajas,
    codigo_producto, nombre, marca, facturacion_ars, vendedor, telefono, celular,
    correo, direccion, ciudad, provincia, pais, categorias, client_id,
    tipo_comprobante, import_batch_id
  )
  SELECT e.ticket, e.letra, e.fecha_emision, e.cuit_dni, e.razon_social, e.fantasia, e.cajas,
         e.codigo_producto, e.nombre, e.marca, e.facturacion_ars, e.vendedor, e.telefono, e.celular,
         e.correo, e.direccion, e.ciudad, e.provincia, e.pais, e.categorias, e.client_id,
         COALESCE(e.tipo_comprobante,'venta'), e.import_batch_id
  FROM public.ventas_cupra_eliminadas e
  WHERE e.batch_id = p_batch_id
  ON CONFLICT (
    COALESCE(ticket,''),
    COALESCE(letra,''),
    COALESCE(fecha_emision, DATE '1900-01-01'),
    COALESCE(client_id,''),
    COALESCE(codigo_producto,''),
    COALESCE(tipo_comprobante,'venta')
  ) DO UPDATE SET
    facturacion_ars = EXCLUDED.facturacion_ars,
    cajas = EXCLUDED.cajas,
    vendedor = EXCLUDED.vendedor,
    razon_social = EXCLUDED.razon_social,
    import_batch_id = EXCLUDED.import_batch_id;
  GET DIAGNOSTICS v_restauradas = ROW_COUNT;

  DELETE FROM public.ventas_cupra_eliminadas WHERE batch_id = p_batch_id;

  UPDATE public.import_batches SET revertido_at = now(), estado = 'revertido' WHERE id = p_batch_id;

  PERFORM public.recompute_client_metrics();

  RETURN jsonb_build_object('filas_borradas', v_borradas, 'filas_restauradas', v_restauradas);
END;
$$;

-- 7. Rebase total: SOLO acción de administrador, con respaldo previo
CREATE OR REPLACE FUNCTION public.rebase_ventas_cupra(
  p_rows jsonb,
  p_batch_id uuid,
  p_confirmacion text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_respaldadas int := 0; v_insertadas int := 0;
BEGIN
  IF upper(COALESCE(p_confirmacion,'')) <> 'CUPRA' THEN
    RAISE EXCEPTION 'Confirmación inválida: para rebasear la base hay que tipear el nombre de la empresa';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  INSERT INTO public.ventas_cupra_eliminadas (
    batch_id, motivo, venta_id, client_id, ticket, letra, fecha_emision, cuit_dni,
    razon_social, fantasia, cajas, codigo_producto, nombre, marca, facturacion_ars,
    vendedor, telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, tipo_comprobante, import_batch_id
  )
  SELECT p_batch_id, 'rebase', v.id, v.client_id, v.ticket, v.letra, v.fecha_emision, v.cuit_dni,
         v.razon_social, v.fantasia, v.cajas, v.codigo_producto, v.nombre, v.marca, v.facturacion_ars,
         v.vendedor, v.telefono, v.celular, v.correo, v.direccion, v.ciudad, v.provincia, v.pais,
         v.categorias, v.tipo_comprobante, v.import_batch_id
  FROM public.ventas_cupra v;
  GET DIAGNOSTICS v_respaldadas = ROW_COUNT;

  DELETE FROM public.ventas_cupra WHERE true;

  INSERT INTO public.ventas_cupra (
    ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia, cajas,
    codigo_producto, nombre, marca, facturacion_ars, vendedor, telefono, celular,
    correo, direccion, ciudad, provincia, pais, categorias, client_id,
    tipo_comprobante, import_batch_id
  )
  SELECT i.ticket, i.letra, i.fecha_emision, i.cuit_dni, i.razon_social, i.fantasia, i.cajas,
         i.codigo_producto, i.nombre, i.marca, i.facturacion_ars, i.vendedor, i.telefono, i.celular,
         i.correo, i.direccion, i.ciudad, i.provincia, i.pais, i.categorias, i.client_id,
         COALESCE(NULLIF(i.tipo_comprobante,''),'venta'), p_batch_id
  FROM jsonb_to_recordset(p_rows) AS i(
    ticket text, letra text, fecha_emision date, cuit_dni text, razon_social text,
    fantasia text, cajas integer, codigo_producto text, nombre text, marca text,
    facturacion_ars numeric, vendedor text, telefono text, celular text, correo text,
    direccion text, ciudad text, provincia text, pais text, categorias text,
    client_id text, tipo_comprobante text
  );
  GET DIAGNOSTICS v_insertadas = ROW_COUNT;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.import_batches SET
      modo_carga = 'rebase',
      filas_insertadas = v_insertadas,
      filas_eliminadas = v_respaldadas
    WHERE id = p_batch_id;
  END IF;

  RETURN jsonb_build_object('filas_respaldadas', v_respaldadas, 'filas_insertadas', v_insertadas);
END;
$$;

-- 8. Fuera el borrado total automático
DROP FUNCTION IF EXISTS public.commit_ventas_import(jsonb, boolean);

REVOKE EXECUTE ON FUNCTION public.preview_ventas_import(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_ventas_import_rango(jsonb, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revertir_import_ventas(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rebase_ventas_cupra(jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_ventas_import(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_ventas_import_rango(jsonb, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_import_ventas(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rebase_ventas_cupra(jsonb, uuid, text) TO service_role;