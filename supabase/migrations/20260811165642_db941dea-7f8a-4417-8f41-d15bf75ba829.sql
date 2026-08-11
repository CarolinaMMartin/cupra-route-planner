ALTER TABLE public.import_staging_rows DROP CONSTRAINT IF EXISTS import_staging_rows_tipo_fila_check;
ALTER TABLE public.import_staging_rows ADD CONSTRAINT import_staging_rows_tipo_fila_check CHECK (tipo_fila IN ('principal','nota_credito','descartada'));

CREATE OR REPLACE FUNCTION public.commit_ventas_import(p_rows jsonb, p_replace_existing boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected_count integer;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote de ventas no contiene filas';
  END IF;

  IF p_replace_existing THEN
    DELETE FROM public.ventas_cupra;
  ELSE
    DELETE FROM public.ventas_cupra current_sale
    USING jsonb_to_recordset(p_rows) AS incoming(
      ticket text, letra text, fecha_emision date, client_id text,
      codigo_producto text, facturacion_ars numeric
    )
    WHERE current_sale.ticket IS NOT DISTINCT FROM incoming.ticket
      AND COALESCE(current_sale.letra, '') = COALESCE(incoming.letra, '')
      AND COALESCE(current_sale.fecha_emision, DATE '1900-01-01') = COALESCE(incoming.fecha_emision, DATE '1900-01-01')
      AND COALESCE(current_sale.client_id, '') = COALESCE(incoming.client_id, '')
      AND COALESCE(current_sale.codigo_producto, '') = COALESCE(incoming.codigo_producto, '')
      AND COALESCE(current_sale.facturacion_ars, 0) = COALESCE(incoming.facturacion_ars, 0);
  END IF;

  INSERT INTO public.ventas_cupra (
    ticket, letra, fecha_emision, cuit_dni, razon_social, fantasia,
    cajas, codigo_producto, nombre, marca, facturacion_ars, vendedor,
    telefono, celular, correo, direccion, ciudad, provincia, pais,
    categorias, client_id, tipo_comprobante
  )
  SELECT
    incoming.ticket, incoming.letra, incoming.fecha_emision,
    incoming.cuit_dni, incoming.razon_social, incoming.fantasia,
    incoming.cajas, incoming.codigo_producto, incoming.nombre,
    incoming.marca, incoming.facturacion_ars, incoming.vendedor,
    incoming.telefono, incoming.celular, incoming.correo,
    incoming.direccion, incoming.ciudad, incoming.provincia,
    incoming.pais, incoming.categorias, incoming.client_id,
    COALESCE(NULLIF(incoming.tipo_comprobante, ''), 'venta')
  FROM jsonb_to_recordset(p_rows) AS incoming(
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
    client_id text,
    tipo_comprobante text
  );

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$function$;