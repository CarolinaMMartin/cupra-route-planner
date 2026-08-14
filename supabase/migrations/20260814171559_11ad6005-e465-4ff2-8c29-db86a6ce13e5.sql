
CREATE OR REPLACE FUNCTION public.reconciliar_places_primarios()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cambios integer := 0;
  parcial integer := 0;
BEGIN
  CREATE TEMP TABLE _ganadores ON COMMIT DROP AS
  SELECT id FROM (
    SELECT cp.id,
           ROW_NUMBER() OVER (
             PARTITION BY cp.client_id
             ORDER BY cp.ubicacion_confiable DESC,
                      public.rank_fuente_ubicacion(cp.fuente_geocoding, cp.direccion_verificada) DESC,
                      cp.updated_at DESC NULLS LAST,
                      cp.created_at DESC NULLS LAST,
                      cp.id
           ) AS rn
    FROM public.client_places cp
  ) r WHERE r.rn = 1;

  UPDATE public.client_places cp
  SET is_primary = false
  WHERE cp.is_primary IS TRUE
    AND cp.id NOT IN (SELECT id FROM _ganadores);
  GET DIAGNOSTICS parcial = ROW_COUNT;
  cambios := cambios + parcial;

  UPDATE public.client_places cp
  SET is_primary = true
  WHERE cp.is_primary IS DISTINCT FROM true
    AND cp.id IN (SELECT id FROM _ganadores);
  GET DIAGNOSTICS parcial = ROW_COUNT;
  cambios := cambios + parcial;

  DROP TABLE _ganadores;
  RETURN cambios;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_clientes_barrio_from_places()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH p AS (
    SELECT DISTINCT ON (client_id)
      client_id, barrio_principal, comuna, provincia_principal, lat, long
    FROM public.client_places
    WHERE COALESCE(barrio_principal,'') <> ''
      AND ubicacion_confiable IS TRUE
    ORDER BY client_id,
             is_primary DESC NULLS LAST,
             public.rank_fuente_ubicacion(fuente_geocoding, direccion_verificada) DESC,
             updated_at DESC NULLS LAST
  )
  UPDATE public.clientes c
  SET barrio_principal = p.barrio_principal,
      provincia_principal = COALESCE(NULLIF(c.provincia_principal,''), p.provincia_principal),
      updated_at = now()
  FROM p
  WHERE p.client_id = c.client_id
    AND COALESCE(c.barrio_principal,'') = '';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
