-- Revisión humana de identidades y enriquecimiento aditivo. No fusiona datos existentes al migrar.
CREATE TABLE public.prospecto_cliente_revisiones (
  prospecto_place_id text NOT NULL REFERENCES public.prospectos(place_id),
  client_id text NOT NULL REFERENCES public.clientes(client_id),
  decision text NOT NULL CHECK (decision IN ('distinto','unificado')),
  prospecto_huella text NOT NULL, cliente_huella text NOT NULL,
  usuario_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prospecto_place_id,client_id)
);
CREATE TABLE public.prospecto_revision_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prospecto_place_id text NOT NULL,
  client_id text NOT NULL, decision text NOT NULL, usuario_id uuid,
  antes jsonb NOT NULL, despues jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.prospectos_informacion_encontrada (
  prospecto_place_id text PRIMARY KEY REFERENCES public.prospectos(place_id),
  datos jsonb NOT NULL, fuente text NOT NULL DEFAULT 'Google Places', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.prospectos_informacion_historial (
  prospecto_place_id text NOT NULL REFERENCES public.prospectos(place_id), huella text NOT NULL,
  datos jsonb NOT NULL, fuente text NOT NULL DEFAULT 'Google Places', created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prospecto_place_id,huella)
);
CREATE TABLE public.clientes_informacion_complementaria (
  client_id text NOT NULL REFERENCES public.clientes(client_id),
  prospecto_place_id text NOT NULL REFERENCES public.prospectos(place_id),
  datos jsonb NOT NULL, fuente text NOT NULL DEFAULT 'Prospecto revisado', updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id,prospecto_place_id)
);
ALTER TABLE public.prospecto_cliente_revisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecto_revision_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospectos_informacion_encontrada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospectos_informacion_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_informacion_complementaria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prospecto_cliente_revisiones,public.prospecto_revision_historial,public.prospectos_informacion_encontrada,public.clientes_informacion_complementaria FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.prospecto_cliente_revisiones,public.prospecto_revision_historial,public.prospectos_informacion_encontrada,public.clientes_informacion_complementaria TO service_role;
REVOKE ALL ON public.prospectos_informacion_historial FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.prospectos_informacion_historial TO service_role;
GRANT SELECT ON public.clientes_informacion_complementaria TO authenticated;
CREATE POLICY complementos_lectura ON public.clientes_informacion_complementaria FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND activo));

CREATE FUNCTION public.huella_prospecto_cupra(p_id text) RETURNS text LANGUAGE sql SET search_path=public AS $$
  SELECT md5(jsonb_build_array(nombre,telefono,direccion,barrio,ciudad,provincia,latitud,longitud,google_place_id,client_id,es_cliente_cupra,
    (SELECT jsonb_build_array(f.datos->'nombre',f.datos->'telefono',f.datos->'direccion',f.datos->'ciudad') FROM prospectos_informacion_encontrada f WHERE f.prospecto_place_id=p_id))::text)
  FROM prospectos WHERE place_id=p_id;
$$;
CREATE FUNCTION public.huella_cliente_cupra(p_id text) RETURNS text LANGUAGE sql SET search_path=public AS $$
  SELECT md5(jsonb_build_array(c.fantasia,c.razon_social,c.telefonos,c.direccion_principal,c.todas_direcciones,c.ciudad_principal,c.provincia_principal,
    (SELECT jsonb_agg(jsonb_build_array(p.id,p.lat,p.long,p.direccion_principal,p.google_maps_link) ORDER BY p.id) FROM client_places p WHERE p.client_id=c.client_id))::text)
  FROM clientes c WHERE c.client_id=p_id;
$$;
CREATE FUNCTION public.contexto_revision_cupra() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'clientes',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('huella',huella_cliente_cupra(c.client_id))) FROM clientes c),'[]'),
    'lugares',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM client_places p),'[]'),
    'prospectos',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('huella',huella_prospecto_cupra(p.place_id),'informacion_encontrada',f.datos)) FROM prospectos p LEFT JOIN prospectos_informacion_encontrada f ON f.prospecto_place_id=p.place_id),'[]'),
    'decisiones',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM prospecto_cliente_revisiones r),'[]'));
$$;

CREATE FUNCTION public.telefono_identidad_cupra(v text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s text:=regexp_replace(coalesce(v,''),'[^0-9]','','g');
BEGIN
  IF left(s,2)='00' THEN s:=substr(s,3); END IF;
  IF left(s,2)='54' AND length(s)>=12 THEN s:=substr(s,3); END IF;
  IF left(s,1)='9' AND length(s)=11 THEN s:=substr(s,2); END IF;
  IF left(s,1)='0' THEN s:=substr(s,2); END IF;
  IF left(s,4)='1115' AND length(s)=12 THEN s:='11'||substr(s,5); END IF;
  RETURN CASE WHEN length(s) BETWEEN 8 AND 13 THEN s ELSE '' END;
END $$;

CREATE FUNCTION public.complementar_cliente_prospecto(p_id text,p_actor uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p prospectos%ROWTYPE; c clientes%ROWTYPE; antes jsonb; despues jsonb; datos jsonb; ubicacion uuid;
BEGIN
  SELECT * INTO p FROM prospectos WHERE place_id=p_id;
  IF p.client_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('C:'||p.client_id,0));
  SELECT * INTO c FROM clientes WHERE client_id=p.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente vinculado ya no existe'; END IF;
  antes:=to_jsonb(c);
  datos:=jsonb_strip_nulls(to_jsonb(p)) || coalesce((SELECT f.datos FROM prospectos_informacion_encontrada f WHERE f.prospecto_place_id=p_id),'{}');
  INSERT INTO clientes_informacion_complementaria(client_id,prospecto_place_id,datos) VALUES(c.client_id,p_id,datos)
    ON CONFLICT(client_id,prospecto_place_id) DO UPDATE SET datos=EXCLUDED.datos,updated_at=now()
    WHERE clientes_informacion_complementaria.datos IS DISTINCT FROM EXCLUDED.datos;
  IF nullif(trim(c.fantasia),'') IS NULL THEN c.fantasia:=p.nombre; END IF;
  IF nullif(trim(c.direccion_principal),'') IS NULL THEN c.direccion_principal:=p.direccion; END IF;
  IF nullif(trim(c.barrio_principal),'') IS NULL THEN c.barrio_principal:=p.barrio; END IF;
  IF nullif(trim(c.ciudad_principal),'') IS NULL THEN c.ciudad_principal:=p.ciudad; END IF;
  IF nullif(trim(c.provincia_principal),'') IS NULL THEN c.provincia_principal:=p.provincia; END IF;
  IF nullif(trim(c.rubro),'') IS NULL THEN c.rubro:=p.rubro; END IF;
  -- Contacts discovered later are added too; existing contacts remain authoritative.
  FOR datos IN SELECT jsonb_build_object('telefono',p.telefono,'email',p.email) UNION SELECT coalesce((SELECT f.datos FROM prospectos_informacion_encontrada f WHERE f.prospecto_place_id=p_id),'{}') LOOP
    IF telefono_identidad_cupra(datos->>'telefono')<>'' AND NOT EXISTS(SELECT 1 FROM unnest(coalesce(c.telefonos,'{}')) t WHERE telefono_identidad_cupra(t)=telefono_identidad_cupra(datos->>'telefono')) THEN
      c.telefonos:=array_append(coalesce(c.telefonos,'{}'),datos->>'telefono');
    END IF;
    IF nullif(trim(datos->>'email'),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(coalesce(c.emails,'{}')) e WHERE lower(trim(e))=lower(trim(datos->>'email'))) THEN
      c.emails:=array_append(coalesce(c.emails,'{}'),datos->>'email');
    END IF;
  END LOOP;
  IF nullif(trim(p.direccion),'') IS NOT NULL AND NOT p.direccion=ANY(coalesce(c.todas_direcciones,'{}')) THEN c.todas_direcciones:=array_append(coalesce(c.todas_direcciones,'{}'),p.direccion); END IF;
  IF antes IS DISTINCT FROM to_jsonb(c) THEN
    UPDATE clientes SET fantasia=c.fantasia,direccion_principal=c.direccion_principal,barrio_principal=c.barrio_principal,
      ciudad_principal=c.ciudad_principal,provincia_principal=c.provincia_principal,rubro=c.rubro,
      telefonos=c.telefonos,emails=c.emails,todas_direcciones=c.todas_direcciones WHERE client_id=c.client_id;
  END IF;
  -- Only supply missing geometry. Never replace a valid customer location with a different one.
  IF p.latitud BETWEEN -56 AND -21 AND p.longitud BETWEEN -74 AND -53
    AND NOT EXISTS(SELECT 1 FROM client_places WHERE client_id=c.client_id AND lat BETWEEN -56 AND -21 AND long BETWEEN -74 AND -53) THEN
    SELECT id INTO ubicacion FROM client_places WHERE client_id=c.client_id ORDER BY is_primary DESC NULLS LAST,id LIMIT 1 FOR UPDATE;
    IF ubicacion IS NULL THEN
      INSERT INTO client_places(client_id,lat,long,is_primary,direccion_principal,barrio_principal,provincia_principal,comuna,google_maps_link,fuente_geocoding)
        VALUES(c.client_id,p.latitud,p.longitud,true,p.direccion,p.barrio,p.provincia,p.comuna,
          CASE WHEN coalesce(p.google_place_id,p.place_id) NOT LIKE 'manual-%' AND coalesce(p.google_place_id,p.place_id) NOT LIKE 'excel-%' THEN 'https://www.google.com/maps/search/?api=1&query='||p.latitud||','||p.longitud||'&query_place_id='||coalesce(p.google_place_id,p.place_id) END,'prospecto_unificado');
    ELSE
      UPDATE client_places SET lat=p.latitud,long=p.longitud,fuente_geocoding='prospecto_unificado',
        direccion_principal=coalesce(nullif(trim(direccion_principal),''),p.direccion),barrio_principal=coalesce(nullif(trim(barrio_principal),''),p.barrio)
        WHERE id=ubicacion;
    END IF;
  END IF;
  SELECT to_jsonb(x) INTO despues FROM clientes x WHERE client_id=c.client_id;
  IF antes IS DISTINCT FROM despues THEN
    INSERT INTO prospecto_revision_historial(prospecto_place_id,client_id,decision,usuario_id,antes,despues)
      VALUES(p_id,c.client_id,'complemento',p_actor,antes,despues);
  END IF;
END $$;

CREATE FUNCTION public.resolver_revision_cupra(p_actor uuid,p_prospecto_id text,p_cliente_id text,p_decision text,p_prospecto_huella text,p_cliente_huella text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p prospectos%ROWTYPE; c clientes%ROWTYPE; anterior jsonb; resultado jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=p_actor AND activo AND rol IN ('administrador','asignador')) THEN RAISE EXCEPTION 'Se requiere un asignador activo' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('distinto','unificado') THEN RAISE EXCEPTION 'Decisión inválida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('C:'||p_cliente_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('P:'||p_prospecto_id,0));
  SELECT * INTO c FROM clientes WHERE client_id=p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente ya no existe'; END IF;
  PERFORM 1 FROM client_places WHERE client_id=p_cliente_id ORDER BY id FOR UPDATE;
  SELECT * INTO p FROM prospectos WHERE place_id=p_prospecto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El prospecto ya no existe'; END IF;
  IF p.client_id=p_cliente_id AND p_decision='unificado' THEN RETURN jsonb_build_object('success',true,'ya_resuelto',true); END IF;
  IF p.client_id IS NOT NULL OR coalesce(p.es_cliente_cupra,false) THEN RAISE EXCEPTION 'Este prospecto ya está vinculado o convertido en cliente. Actualizá la revisión' USING ERRCODE='40001'; END IF;
  IF huella_prospecto_cupra(p_prospecto_id) IS DISTINCT FROM p_prospecto_huella OR huella_cliente_cupra(p_cliente_id) IS DISTINCT FROM p_cliente_huella THEN
    RAISE EXCEPTION 'Los datos cambiaron. Actualizá la revisión antes de confirmar' USING ERRCODE='40001';
  END IF;
  anterior:=jsonb_build_object('prospecto',to_jsonb(p),'cliente',to_jsonb(c));
  IF p_decision='unificado' THEN
    UPDATE prospectos SET client_id=p_cliente_id,es_cliente_cupra=true WHERE place_id=p_prospecto_id;
    PERFORM complementar_cliente_prospecto(p_prospecto_id,p_actor);
  END IF;
  INSERT INTO prospecto_cliente_revisiones(prospecto_place_id,client_id,decision,prospecto_huella,cliente_huella,usuario_id)
    VALUES(p_prospecto_id,p_cliente_id,p_decision,huella_prospecto_cupra(p_prospecto_id),huella_cliente_cupra(p_cliente_id),p_actor)
    ON CONFLICT(prospecto_place_id,client_id) DO UPDATE SET decision=EXCLUDED.decision,prospecto_huella=EXCLUDED.prospecto_huella,cliente_huella=EXCLUDED.cliente_huella,usuario_id=EXCLUDED.usuario_id,updated_at=now();
  resultado:=jsonb_build_object('prospecto',(SELECT to_jsonb(x) FROM prospectos x WHERE place_id=p_prospecto_id),'cliente',(SELECT to_jsonb(x) FROM clientes x WHERE client_id=p_cliente_id));
  INSERT INTO prospecto_revision_historial(prospecto_place_id,client_id,decision,usuario_id,antes,despues) VALUES(p_prospecto_id,p_cliente_id,p_decision,p_actor,anterior,resultado);
  RETURN jsonb_build_object('success',true,'decision',p_decision);
END $$;

CREATE FUNCTION public.incorporar_info_prospectos(p_filas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fila jsonb; id_actual text; vinculacion text; ids text[]:='{}';
BEGIN
  IF jsonb_typeof(p_filas)<>'array' OR jsonb_array_length(p_filas)>500 THEN RAISE EXCEPTION 'Lote de prospectos inválido'; END IF;
  FOR fila IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO fila FROM jsonb_each(fila) WHERE value<>'null'::jsonb AND value<>'""'::jsonb;
    IF nullif(trim(fila->>'place_id'),'') IS NULL OR nullif(trim(fila->>'nombre'),'') IS NULL OR NOT coalesce((fila->>'latitud')::float BETWEEN -56 AND -21 AND (fila->>'longitud')::float BETWEEN -74 AND -53,false) THEN RAISE EXCEPTION 'Prospecto sin identidad o ubicación válida'; END IF;
    SELECT place_id,client_id INTO id_actual,vinculacion FROM prospectos WHERE place_id=fila->>'place_id' OR google_place_id=fila->>'place_id' ORDER BY (place_id=fila->>'place_id') DESC LIMIT 1;
    id_actual:=coalesce(id_actual,fila->>'place_id');
    IF vinculacion IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('C:'||vinculacion,0)); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('P:'||id_actual,0));
    INSERT INTO prospectos(place_id,nombre,direccion,ciudad,provincia,barrio,comuna,latitud,longitud,telefono,email,website,instagram,rating,total_ratings,tipo_principal,tipos,estado_negocio,es_cliente_cupra,resumen_google,nivel_precio,sirve_vinos)
      VALUES(id_actual,fila->>'nombre',coalesce(fila->>'direccion',''),coalesce(fila->>'ciudad',''),coalesce(fila->>'provincia',''),fila->>'barrio',fila->>'comuna',
        (fila->>'latitud')::float,(fila->>'longitud')::float,fila->>'telefono',fila->>'email',fila->>'website',fila->>'instagram',
        (fila->>'rating')::numeric,(fila->>'total_ratings')::int,fila->>'tipo_principal',ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(fila->'tipos')='array' THEN fila->'tipos' ELSE '[]' END)),fila->>'estado_negocio',false,fila->>'resumen_google',fila->>'nivel_precio',(fila->>'sirve_vinos')::boolean)
      ON CONFLICT(place_id) DO UPDATE SET
        telefono=coalesce(nullif(trim(prospectos.telefono),''),EXCLUDED.telefono),email=coalesce(nullif(trim(prospectos.email),''),EXCLUDED.email),
        website=coalesce(nullif(trim(prospectos.website),''),EXCLUDED.website),instagram=coalesce(nullif(trim(prospectos.instagram),''),EXCLUDED.instagram),
        resumen_google=coalesce(nullif(trim(prospectos.resumen_google),''),EXCLUDED.resumen_google),nivel_precio=coalesce(prospectos.nivel_precio,EXCLUDED.nivel_precio),sirve_vinos=coalesce(prospectos.sirve_vinos,EXCLUDED.sirve_vinos),
        direccion=coalesce(nullif(trim(prospectos.direccion),''),EXCLUDED.direccion),ciudad=coalesce(nullif(trim(prospectos.ciudad),''),EXCLUDED.ciudad),
        provincia=coalesce(nullif(trim(prospectos.provincia),''),EXCLUDED.provincia),barrio=coalesce(nullif(trim(prospectos.barrio),''),EXCLUDED.barrio),comuna=coalesce(nullif(trim(prospectos.comuna),''),EXCLUDED.comuna),
        rating=coalesce(prospectos.rating,EXCLUDED.rating),total_ratings=coalesce(prospectos.total_ratings,EXCLUDED.total_ratings),
        estado_negocio=CASE WHEN EXCLUDED.estado_negocio IN ('CLOSED_PERMANENTLY','CLOSED_TEMPORARILY') THEN EXCLUDED.estado_negocio ELSE coalesce(prospectos.estado_negocio,EXCLUDED.estado_negocio) END;
    INSERT INTO prospectos_informacion_historial(prospecto_place_id,huella,datos) VALUES(id_actual,md5(fila::text),fila) ON CONFLICT DO NOTHING;
    INSERT INTO prospectos_informacion_encontrada(prospecto_place_id,datos) VALUES(id_actual,jsonb_strip_nulls(fila))
      ON CONFLICT(prospecto_place_id) DO UPDATE SET datos=prospectos_informacion_encontrada.datos||EXCLUDED.datos,updated_at=now();
    PERFORM complementar_cliente_prospecto(id_actual);
    ids:=array_append(ids,id_actual);
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('huella',huella_prospecto_cupra(p.place_id),'informacion_encontrada',f.datos)) FROM prospectos p LEFT JOIN prospectos_informacion_encontrada f ON f.prospecto_place_id=p.place_id WHERE p.place_id=ANY(ids)),'[]');
END $$;

REVOKE ALL ON FUNCTION public.contexto_revision_cupra(),public.huella_prospecto_cupra(text),public.huella_cliente_cupra(text),public.telefono_identidad_cupra(text),public.complementar_cliente_prospecto(text,uuid),public.resolver_revision_cupra(uuid,text,text,text,text,text),public.incorporar_info_prospectos(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contexto_revision_cupra(),public.huella_prospecto_cupra(text),public.huella_cliente_cupra(text),public.telefono_identidad_cupra(text),public.complementar_cliente_prospecto(text,uuid),public.resolver_revision_cupra(uuid,text,text,text,text,text),public.incorporar_info_prospectos(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
