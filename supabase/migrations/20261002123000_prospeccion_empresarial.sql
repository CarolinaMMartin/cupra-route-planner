CREATE OR REPLACE FUNCTION public.normalizar_rubro(p_textos text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text;
  primero text;
  t text;
BEGIN
  IF p_textos IS NULL OR array_length(p_textos, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  s := ' ' || upper(translate(array_to_string(p_textos, ' '),
        'ÁÉÍÓÚÜÑáéíóúüñ_-/,;|', 'AEIOUUNAEIOUUN      ')) || ' ';

  IF s ~ '(VINOTECA|VINERIA|ENOTECA|LIQUOR STORE|WINE STORE|LICORERIA|CAVA DE VINOS)' THEN RETURN 'Vinoteca'; END IF;
  IF s ~ '(WINE ?BAR|BAR DE VINOS)' THEN RETURN 'Wine bar'; END IF;
  IF s ~ '(RESTAURANT|RESTO|PARRILLA|STEAK HOUSE|BODEGON|GASTRONOM|BISTRO|PIZZERIA|TRATTORIA|MEAL TAKEAWAY|MEAL DELIVERY)' THEN RETURN 'Restaurante'; END IF;
  IF s ~ '(HOTEL|LODGING|HOSTEL|APART)' THEN RETURN 'Hotel'; END IF;
  IF s ~ '( BAR |CERVECERIA| PUB |BREWERY|COCTELERIA|NIGHT CLUB)' THEN RETURN 'Bar'; END IF;
  IF s ~ '(SUPERMERCADO|SUPERMARKET|HIPERMERCADO|GROCERY|AUTOSERVICIO|MINIMERCADO|ALMACEN|DESPENSA|CONVENIENCE)' THEN RETURN 'Almacén / Supermercado'; END IF;
  IF s ~ '(DISTRIBUID|MAYORISTA|WHOLESALE)' THEN RETURN 'Distribuidor'; END IF;
  IF s ~ '(CATERING|EVENTOS|EVENT VENUE)' THEN RETURN 'Catering / Eventos'; END IF;
  IF s ~ '(GOURMET|DELI |DELICATESSEN|FIAMBRERIA|FOOD STORE)' THEN RETURN 'Tienda gourmet'; END IF;
  IF s ~ '(CORPORATE OFFICE|BUSINESS CENTER|COWORKING|MANUFACTURER|EMPRESA|OFICINA|FABRICA)' THEN RETURN 'Empresa'; END IF;
  IF s ~ '(LAWYER|ESTUDIO JURIDICO|ABOGAD)' THEN RETURN 'Estudio jurídico'; END IF;
  IF s ~ '(ACCOUNTING|ESTUDIO CONTABLE|CONTADOR)' THEN RETURN 'Estudio contable'; END IF;
  IF s ~ '(REAL ESTATE AGENCY|INMOBILIARIA)' THEN RETURN 'Inmobiliaria'; END IF;
  IF s ~ '(INSURANCE AGENCY|AGENCIA DE SEGUROS|ASEGURADORA)' THEN RETURN 'Agencia de seguros'; END IF;


  -- Sin regla: primer valor que no sea un código técnico.
  FOREACH t IN ARRAY p_textos LOOP
    t := trim(coalesce(t, ''));
    CONTINUE WHEN t = '' OR upper(replace(t, '_', ' ')) IN
      ('ON TRADE', 'OFF TRADE', 'ONTRADE', 'OFFTRADE', 'MANUAL', 'ESTABLISHMENT', 'POINT OF INTEREST', 'FOOD', 'STORE', 'NUEVO', 'PROSPECTO');
    primero := initcap(lower(replace(t, '_', ' ')));
    EXIT;
  END LOOP;
  RETURN primero;
END;
$$;

-- Prospectos: manda el tipo principal de Google ("bar" que también figura como
-- "restaurant" es Bar). Si el tipo principal no es un rubro conocido, se usan todos.
CREATE OR REPLACE FUNCTION public.rubro_prospecto(p_tipo text, p_tipos text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  r := public.normalizar_rubro(ARRAY[p_tipo]);
  IF r IN ('Vinoteca', 'Wine bar', 'Restaurante', 'Hotel', 'Bar', 'Almacén / Supermercado',
           'Distribuidor', 'Catering / Eventos', 'Tienda gourmet', 'Empresa', 'Estudio jurídico',
           'Estudio contable', 'Inmobiliaria', 'Agencia de seguros') THEN
    RETURN r;
  END IF;
  RETURN public.normalizar_rubro(array_prepend(p_tipo, coalesce(p_tipos, '{}'::text[])));
END;
$$;

SELECT public.refrescar_rubros();

CREATE OR REPLACE FUNCTION public.incorporar_info_prospectos(p_filas jsonb) RETURNS jsonb
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
        tipo_principal=CASE WHEN nullif(trim(prospectos.tipo_principal),'') IS NULL OR lower(prospectos.tipo_principal)='manual'
          THEN coalesce(EXCLUDED.tipo_principal,prospectos.tipo_principal) ELSE prospectos.tipo_principal END,
        tipos=CASE WHEN coalesce(array_length(prospectos.tipos,1),0)=0 THEN EXCLUDED.tipos ELSE prospectos.tipos END,
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

NOTIFY pgrst,'reload schema';
