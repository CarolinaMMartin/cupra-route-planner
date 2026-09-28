-- Confirmación específica del mapa: ocho visitas y 1,5 km comprobados de nuevo
-- con las ubicaciones vigentes en la base, dentro de la misma transacción.
CREATE OR REPLACE FUNCTION public.guardar_ruta_mapa(
  p_vendedor_id uuid, p_client_ids text[], p_prospecto_ids text[] DEFAULT '{}'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  clientes text[] := coalesce(p_client_ids, '{}');
  prospectos text[] := coalesce(p_prospecto_ids, '{}');
  destino text; punto record; fila jsonb;
  puntos jsonb := '[]'; visitas jsonb := '[]';
  centro_lat double precision := 0; centro_lng double precision := 0;
  lat double precision; lng double precision; distancia double precision;
  hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND activo
    AND rol IN ('administrador','asignador')) THEN
    RAISE EXCEPTION 'Solo un asignador o administrador activo puede guardar rutas' USING ERRCODE='42501';
  END IF;
  IF cardinality(clientes) < 1 OR cardinality(clientes) + cardinality(prospectos) <> 8
    OR EXISTS (SELECT 1 FROM unnest(clientes || prospectos) id WHERE id IS NULL OR trim(id)='')
    OR (SELECT count(DISTINCT id) FROM unnest(clientes) id) <> cardinality(clientes)
    OR (SELECT count(DISTINCT id) FROM unnest(prospectos) id) <> cardinality(prospectos) THEN
    RAISE EXCEPTION 'La ruta debe tener ocho visitas únicas y al menos un cliente' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id=p_vendedor_id AND activo AND (rol='vendedor' OR perfil_ventas)) THEN
    RAISE EXCEPTION 'El vendedor no está activo' USING ERRCODE='22023';
  END IF;
  FOR destino IN SELECT 'C:' || id FROM unnest(clientes) id UNION ALL SELECT 'P:' || id FROM unnest(prospectos) id ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(destino,0));
  END LOOP;
  FOR destino IN SELECT id FROM unnest(clientes) id ORDER BY 1 LOOP
    PERFORM 1 FROM public.clientes c WHERE c.client_id=destino AND NOT coalesce(c.excluir_recomendaciones,false) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Un cliente ya no está disponible. Recargá la cartera' USING ERRCODE='40001'; END IF;
    SELECT cp.lat::double precision AS lat, cp.long::double precision AS lng INTO punto
      FROM public.client_places cp WHERE cp.client_id=destino
      AND cp.lat BETWEEN -56 AND -21 AND cp.long BETWEEN -74 AND -53
      ORDER BY cp.is_primary DESC NULLS LAST, cp.direccion_verificada DESC, cp.id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Un cliente no tiene una ubicación válida' USING ERRCODE='22023'; END IF;
    centro_lat:=centro_lat+punto.lat; centro_lng:=centro_lng+punto.lng;
    puntos:=puntos || jsonb_build_object('lat',punto.lat,'lng',punto.lng);
    visitas:=visitas || jsonb_build_object('vendedor_id',p_vendedor_id,'client_id',destino);
  END LOOP;
  centro_lat:=centro_lat/cardinality(clientes); centro_lng:=centro_lng/cardinality(clientes);
  FOR destino IN SELECT id FROM unnest(prospectos) id ORDER BY 1 LOOP
    SELECT p.latitud::double precision AS lat, p.longitud::double precision AS lng INTO punto
      FROM public.prospectos p WHERE p.place_id=destino AND p.client_id IS NULL AND p.es_cliente_cupra=false
        AND coalesce(p.estado_negocio,'') NOT IN ('CLOSED_PERMANENTLY','CLOSED_TEMPORARILY')
        AND p.latitud BETWEEN -56 AND -21 AND p.longitud BETWEEN -74 AND -53 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Un prospecto dejó de estar disponible. Volvé a completar la ruta' USING ERRCODE='40001'; END IF;
    IF EXISTS (SELECT 1 FROM public.asignaciones_vendedores_clientes a WHERE a.prospecto_place_id=destino
      AND (coalesce(a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)=hoy
        OR (a.visited_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date=hoy)
      AND (a.vendedor_id<>p_vendedor_id OR a.estado='Visitado')) THEN
      RAISE EXCEPTION 'Un prospecto ya fue asignado o visitado hoy. Volvé a completar la ruta' USING ERRCODE='40001';
    END IF;
    puntos:=puntos || jsonb_build_object('lat',punto.lat,'lng',punto.lng);
    visitas:=visitas || jsonb_build_object('vendedor_id',p_vendedor_id,'prospecto_place_id',destino);
  END LOOP;
  FOR fila IN SELECT value FROM jsonb_array_elements(puntos) LOOP
    lat:=(fila->>'lat')::double precision; lng:=(fila->>'lng')::double precision;
    distancia:=6371 * 2 * asin(sqrt(least(1,
      power(sin(radians(lat-centro_lat)/2),2) + cos(radians(centro_lat))*cos(radians(lat))*power(sin(radians(lng-centro_lng)/2),2))));
    IF distancia > 1.5 THEN
      RAISE EXCEPTION 'Hay destinos fuera del radio máximo de 1,5 km del centro de los clientes' USING ERRCODE='22023';
    END IF;
  END LOOP;
  RETURN public.guardar_asignaciones(visitas,false);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_ruta_mapa(uuid,text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guardar_ruta_mapa(uuid,text[],text[]) TO authenticated;
