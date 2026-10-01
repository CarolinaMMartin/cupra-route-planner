CREATE POLICY perfiles_conservar_historial ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE TABLE public.movimientos_visitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  vendedor_anterior uuid,
  vendedor_nuevo uuid NOT NULL,
  client_id text,
  prospecto_place_id text,
  fecha_programada date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_visitas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.movimientos_visitas FROM anon,authenticated;
GRANT SELECT ON public.movimientos_visitas TO authenticated;
GRANT ALL ON public.movimientos_visitas TO service_role;
CREATE POLICY movimientos_supervision ON public.movimientos_visitas FOR SELECT TO authenticated
  USING (public.is_assignor_like(auth.uid()));

CREATE POLICY asignaciones_lectura_propia ON public.asignaciones_vendedores_clientes AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.is_assignor_like(auth.uid()) OR vendedor_id=auth.uid());
CREATE POLICY asignaciones_conservar_visitas ON public.asignaciones_vendedores_clientes AS RESTRICTIVE
  FOR DELETE TO authenticated USING (estado<>'Visitado');
DROP POLICY IF EXISTS "Vendedores pueden auto-asignarse" ON public.asignaciones_vendedores_clientes;

CREATE FUNCTION public.puede_ver_cuenta(p_cliente text, p_prospecto text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_active_user(auth.uid()) AND (public.is_assignor_like(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.asignaciones_vendedores_clientes a WHERE a.vendedor_id=auth.uid()
      AND ((p_cliente IS NOT NULL AND a.client_id=p_cliente) OR (p_prospecto IS NOT NULL AND a.prospecto_place_id=p_prospecto))
  ));
$$;
REVOKE ALL ON FUNCTION public.puede_ver_cuenta(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.puede_ver_cuenta(text,text) TO authenticated;
CREATE POLICY clientes_ficha_asignada ON public.clientes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.puede_ver_cuenta(client_id));
CREATE POLICY lugares_ficha_asignada ON public.client_places AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.puede_ver_cuenta(client_id));
CREATE POLICY feedback_cuenta_asignada ON public.cliente_feedbacks AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.puede_ver_cuenta(client_id,prospecto_place_id))
  WITH CHECK (public.puede_ver_cuenta(client_id,prospecto_place_id));
CREATE POLICY briefing_cuenta_asignada ON public.visita_briefings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.puede_ver_cuenta(client_id,prospecto_place_id));

CREATE FUNCTION public.proteger_identidad_visita() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_user='authenticated' AND (NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id
    OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.prospecto_place_id IS DISTINCT FROM OLD.prospecto_place_id
    OR NEW.origen_asignacion IS DISTINCT FROM OLD.origen_asignacion OR NEW.es_prospecto IS DISTINCT FROM OLD.es_prospecto
    OR (OLD.estado='Visitado' AND NEW.estado<>'Visitado')) THEN
    RAISE EXCEPTION 'Usá la operación de asignación para cambiar el responsable; una visita realizada conserva su historia' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proteger_identidad_visita BEFORE UPDATE ON public.asignaciones_vendedores_clientes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_identidad_visita();

CREATE FUNCTION public.catalogo_visitas(p_busqueda text DEFAULT '', p_tipo text DEFAULT 'ambos', p_offset integer DEFAULT 0, p_limite integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE resultado jsonb; consulta text:=lower(trim(coalesce(p_busqueda,'')));
BEGIN
  IF NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Se requiere una cuenta activa' USING ERRCODE='42501'; END IF;
  IF p_tipo NOT IN ('clientes','prospectos','ambos') OR length(consulta)>100 OR p_offset<0
    OR p_limite NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Consulta inválida' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(dato),'[]') INTO resultado FROM (
    SELECT id,tipo,dato FROM (
      SELECT c.client_id AS id,'cliente' AS tipo,jsonb_build_object(
        'id',c.client_id,'tipo','cliente','nombre',coalesce(nullif(c.fantasia,''),c.razon_social),
        'direccion',coalesce(cp.direccion_principal,c.direccion_principal),'barrio',coalesce(cp.barrio_principal,c.barrio_principal),
        'telefono',c.telefonos[1],'telefonos',c.telefonos,'lat',cp.lat,'lng',cp.long,
        'rubro',c.rubro,'vendedor',coalesce(c.vendedor_actual,c.vendedor_principal)) AS dato
      FROM public.clientes c LEFT JOIN LATERAL (
        SELECT p.direccion_principal,p.barrio_principal,p.lat,p.long FROM public.client_places p
        WHERE p.client_id=c.client_id ORDER BY p.is_primary DESC NULLS LAST,p.direccion_verificada DESC,p.id LIMIT 1
      ) cp ON true
      WHERE p_tipo IN ('clientes','ambos') AND NOT coalesce(c.excluir_recomendaciones,false)
        AND (consulta='' OR position(consulta IN lower(concat_ws(' ',c.razon_social,c.fantasia,c.direccion_principal)))>0)
      UNION ALL
      SELECT p.place_id,'prospecto',jsonb_build_object('id',p.place_id,'tipo','prospecto','nombre',p.nombre,
        'direccion',p.direccion,'barrio',p.barrio,'telefono',p.telefono,'telefonos',ARRAY[p.telefono],
        'lat',p.latitud,'lng',p.longitud,'rubro',p.rubro,'vendedor',NULL)
      FROM public.prospectos p WHERE p_tipo IN ('prospectos','ambos') AND p.client_id IS NULL AND NOT p.es_cliente_cupra
        AND coalesce(p.estado_negocio,'') NOT IN ('CLOSED_PERMANENTLY','CLOSED_TEMPORARILY')
        AND (consulta='' OR position(consulta IN lower(concat_ws(' ',p.nombre,p.direccion)))>0)
    ) catalogo ORDER BY tipo,id OFFSET p_offset LIMIT p_limite
  ) pagina;
  RETURN resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_visitas(text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.catalogo_visitas(text,text,integer,integer) TO authenticated;

CREATE FUNCTION public.autoasignar_visita(p_client_id text DEFAULT NULL,p_prospecto_id text DEFAULT NULL,p_fecha date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); fecha date:=coalesce(p_fecha,(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  anterior public.asignaciones_vendedores_clientes%ROWTYPE; visita uuid; nombre_comercio text; nombre_actor text; cantidad integer;
BEGIN
  SELECT p.nombre INTO nombre_actor FROM public.profiles p WHERE p.user_id=actor AND p.activo AND (p.rol='vendedor' OR p.perfil_ventas);
  IF NOT FOUND THEN RAISE EXCEPTION 'Se requiere un perfil de ventas activo' USING ERRCODE='42501'; END IF;
  IF (p_client_id IS NULL)=(p_prospecto_id IS NULL) OR fecha<(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'Indicá un comercio y una fecha vigente' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce('C:'||p_client_id,'P:'||p_prospecto_id),0));
  IF p_client_id IS NOT NULL THEN
    SELECT coalesce(nullif(fantasia,''),razon_social) INTO nombre_comercio FROM public.clientes
      WHERE client_id=p_client_id AND NOT coalesce(excluir_recomendaciones,false) FOR UPDATE;
  ELSE
    SELECT p.nombre INTO nombre_comercio FROM public.prospectos p WHERE p.place_id=p_prospecto_id AND p.client_id IS NULL
      AND NOT p.es_cliente_cupra AND coalesce(p.estado_negocio,'') NOT IN ('CLOSED_PERMANENTLY','CLOSED_TEMPORARILY') FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'El comercio ya no está disponible' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.asignaciones_vendedores_clientes a WHERE a.estado='Visitado'
    AND a.client_id IS NOT DISTINCT FROM p_client_id AND a.prospecto_place_id IS NOT DISTINCT FROM p_prospecto_id
    AND coalesce((a.visited_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)=fecha) THEN
    RAISE EXCEPTION 'Este comercio ya fue visitado en esa fecha' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO cantidad FROM public.asignaciones_vendedores_clientes a WHERE a.estado<>'Visitado'
    AND a.client_id IS NOT DISTINCT FROM p_client_id AND a.prospecto_place_id IS NOT DISTINCT FROM p_prospecto_id
    AND coalesce(a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)=fecha;
  IF cantidad>1 THEN RAISE EXCEPTION 'Hay visitas duplicadas. El asignador debe unificarlas primero' USING ERRCODE='40001'; END IF;
  SELECT * INTO anterior FROM public.asignaciones_vendedores_clientes a WHERE a.estado<>'Visitado'
    AND a.client_id IS NOT DISTINCT FROM p_client_id AND a.prospecto_place_id IS NOT DISTINCT FROM p_prospecto_id
    AND coalesce(a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)=fecha FOR UPDATE;
  IF FOUND AND anterior.vendedor_id=actor THEN RETURN jsonb_build_object('id',anterior.id,'creada',false,'reasignada',false); END IF;
  IF anterior.id IS NOT NULL THEN
    UPDATE public.asignaciones_vendedores_clientes SET vendedor_id=actor,origen_asignacion='auto',fecha_programada=fecha WHERE id=anterior.id RETURNING id INTO visita;
  ELSE
    INSERT INTO public.asignaciones_vendedores_clientes(vendedor_id,client_id,prospecto_place_id,es_prospecto,estado,origen_asignacion,fecha_programada)
      VALUES(actor,p_client_id,p_prospecto_id,p_prospecto_id IS NOT NULL,'Por visitar','auto',fecha) RETURNING id INTO visita;
  END IF;
  INSERT INTO public.movimientos_visitas(asignacion_id,usuario_id,vendedor_anterior,vendedor_nuevo,client_id,prospecto_place_id,fecha_programada)
    VALUES(visita,actor,anterior.vendedor_id,actor,p_client_id,p_prospecto_id,fecha);
  INSERT INTO public.notificaciones(vendedor_id,tipo,titulo,mensaje,asignacion_id)
    SELECT user_id,'autoasignacion','Visita tomada por un vendedor',concat(nombre_actor,' tomó la visita a ',nombre_comercio,' para el ',fecha,
      CASE WHEN anterior.id IS NOT NULL THEN '. Se transfirió el pendiente y se conservó su historial.' ELSE '.' END),visita
    FROM public.profiles WHERE activo AND rol IN ('asignador','administrador');
  RETURN jsonb_build_object('id',visita,'creada',true,'reasignada',anterior.id IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.autoasignar_visita(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.autoasignar_visita(text,text,date) TO authenticated;

CREATE FUNCTION public.reasignar_pendientes(p_origen uuid,p_destino uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE filas jsonb:='[]'; candidata record; visita public.asignaciones_vendedores_clientes%ROWTYPE; fecha date;
BEGIN
  IF NOT public.is_assignor_like(auth.uid()) THEN RAISE EXCEPTION 'Se requiere un asignador activo' USING ERRCODE='42501'; END IF;
  IF p_origen=p_destino THEN RAISE EXCEPTION 'Elegí otro vendedor' USING ERRCODE='22023'; END IF;
  FOR candidata IN SELECT a.id,coalesce('C:'||a.client_id,'P:'||a.prospecto_place_id) AS comercio
    FROM public.asignaciones_vendedores_clientes a WHERE vendedor_id=p_origen AND estado<>'Visitado'
    ORDER BY comercio,id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(candidata.comercio,0));
    SELECT * INTO visita FROM public.asignaciones_vendedores_clientes WHERE id=candidata.id AND vendedor_id=p_origen AND estado<>'Visitado' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una visita cambió. Recargá los pendientes antes de reasignar' USING ERRCODE='40001'; END IF;
    fecha:=coalesce(visita.fecha_programada,(visita.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
    filas:=filas||jsonb_build_array(jsonb_build_object('asignacion_id',visita.id,'vendedor_id',p_destino,
      'client_id',visita.client_id,'prospecto_place_id',visita.prospecto_place_id,'fecha_programada',fecha));
    INSERT INTO public.movimientos_visitas(asignacion_id,usuario_id,vendedor_anterior,vendedor_nuevo,client_id,prospecto_place_id,fecha_programada)
      VALUES(visita.id,auth.uid(),p_origen,p_destino,visita.client_id,visita.prospecto_place_id,fecha);
  END LOOP;
  IF jsonb_array_length(filas)=0 THEN RETURN 0; END IF;
  RETURN public.guardar_asignaciones(filas,false);
END;
$$;
REVOKE ALL ON FUNCTION public.reasignar_pendientes(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reasignar_pendientes(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
