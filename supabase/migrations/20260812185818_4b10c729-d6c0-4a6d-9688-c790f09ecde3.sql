CREATE OR REPLACE FUNCTION public.sync_places_catalog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  WITH fuente AS (
    SELECT
      NULLIF(TRIM(cp.barrio_principal), '') AS barrio_principal,
      NULLIF(TRIM(cp.comuna), '') AS comuna,
      COALESCE(NULLIF(TRIM(cp.provincia_principal), ''), 'Ciudad Autónoma de Buenos Aires') AS provincia_principal
    FROM public.client_places cp
    WHERE NULLIF(TRIM(cp.barrio_principal), '') IS NOT NULL
    UNION ALL
    SELECT
      NULLIF(TRIM(p.barrio), ''),
      NULLIF(TRIM(p.comuna), ''),
      COALESCE(NULLIF(TRIM(p.provincia), ''), 'Ciudad Autónoma de Buenos Aires')
    FROM public.prospectos p
    WHERE NULLIF(TRIM(p.barrio), '') IS NOT NULL
    UNION ALL
    SELECT
      NULLIF(TRIM(c.barrio_principal), ''),
      NULL,
      COALESCE(NULLIF(TRIM(c.provincia_principal), ''), 'Ciudad Autónoma de Buenos Aires')
    FROM public.clientes c
    WHERE NULLIF(TRIM(c.barrio_principal), '') IS NOT NULL
  ), agrupado AS (
    SELECT
      barrio_principal,
      provincia_principal,
      MAX(comuna) AS comuna
    FROM fuente
    GROUP BY barrio_principal, provincia_principal
  )
  INSERT INTO public.places (barrio_principal, comuna, provincia_principal)
  SELECT a.barrio_principal, a.comuna, a.provincia_principal
  FROM agrupado a
  WHERE NOT EXISTS (
    SELECT 1 FROM public.places pl
    WHERE pl.barrio_principal = a.barrio_principal
      AND COALESCE(pl.provincia_principal, '') = COALESCE(a.provincia_principal, '')
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_places_catalog() TO authenticated;
GRANT SELECT ON public.places TO authenticated;
GRANT ALL ON public.places TO service_role;

SELECT public.sync_places_catalog();