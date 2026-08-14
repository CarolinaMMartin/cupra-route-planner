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
  IF auth.uid() IS NOT NULL AND NOT public.is_assignor_like(auth.uid()) THEN
    RAISE EXCEPTION 'Solo un asignador o administrador puede revertir una carga';
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

REVOKE EXECUTE ON FUNCTION public.revertir_import_ventas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_import_ventas(uuid) TO authenticated, service_role;