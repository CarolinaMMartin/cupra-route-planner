CREATE OR REPLACE FUNCTION public.sync_clientes_barrio_from_places()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  WITH p AS (
    SELECT DISTINCT ON (client_id)
      client_id, barrio_principal, comuna, provincia_principal, lat, long
    FROM public.client_places
    WHERE COALESCE(barrio_principal,'') <> ''
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
$$;

SELECT public.sync_clientes_barrio_from_places();