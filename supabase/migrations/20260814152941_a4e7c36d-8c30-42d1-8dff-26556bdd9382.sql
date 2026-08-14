ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS codigo_postal text;
ALTER TABLE public.client_places ADD COLUMN IF NOT EXISTS codigo_postal text;
ALTER TABLE public.client_places ALTER COLUMN fuente_geocoding SET DEFAULT 'geocoding_auto';

UPDATE public.client_places SET fuente_geocoding = 'correccion_manual'
  WHERE direccion_verificada IS TRUE AND (fuente_geocoding IS NULL OR fuente_geocoding = '');
UPDATE public.client_places SET fuente_geocoding = 'geocoding_auto'
  WHERE fuente_geocoding IS NULL OR fuente_geocoding = '';

CREATE OR REPLACE FUNCTION public.rank_fuente_ubicacion(_fuente text, _verificada boolean)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(_verificada, false) THEN 3
    WHEN _fuente = 'correccion_manual' THEN 3
    WHEN _fuente IN ('excel', 'erp') THEN 2
    ELSE 1
  END
$$;

CREATE OR REPLACE FUNCTION public.reconciliar_places_primarios()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cambios integer := 0;
  parcial integer := 0;
BEGIN
  CREATE TEMP TABLE _ganadores ON COMMIT DROP AS
  SELECT id FROM (
    SELECT cp.id,
           ROW_NUMBER() OVER (
             PARTITION BY cp.client_id
             ORDER BY public.rank_fuente_ubicacion(cp.fuente_geocoding, cp.direccion_verificada) DESC,
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
$$;

SELECT public.reconciliar_places_primarios();

CREATE UNIQUE INDEX IF NOT EXISTS client_places_un_primario_por_cliente
  ON public.client_places (client_id)
  WHERE is_primary;