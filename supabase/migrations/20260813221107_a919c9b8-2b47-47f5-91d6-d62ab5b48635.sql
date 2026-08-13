-- Resolver tolerant to corrupted characters (U+FFFD) coming from Excel encoding issues
CREATE OR REPLACE FUNCTION public.canonical_vendedor(_nombre text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  patron text;
  display text;
BEGIN
  k := public.vendedor_key(_nombre);
  IF k IS NULL THEN RETURN NULL; END IF;

  SELECT nombre_display INTO display FROM public.vendedores_canonicos WHERE vendedor_key = k;
  IF display IS NOT NULL THEN RETURN display; END IF;

  -- treat replacement/unknown characters as wildcards to match an existing canonical name
  IF k ~ '[^A-Z0-9 ]' THEN
    patron := regexp_replace(k, '[^A-Z0-9 ]', '_', 'g');
    SELECT vc.nombre_display INTO display
    FROM public.vendedores_canonicos vc
    WHERE vc.vendedor_key LIKE patron
      AND length(vc.vendedor_key) = length(patron)
    ORDER BY vc.nombre_display
    LIMIT 1;
    IF display IS NOT NULL THEN RETURN display; END IF;
  END IF;

  display := public.titlecase_nombre(_nombre);
  INSERT INTO public.vendedores_canonicos (vendedor_key, nombre_display)
  VALUES (k, display)
  ON CONFLICT (vendedor_key) DO UPDATE SET nombre_display = public.vendedores_canonicos.nombre_display
  RETURNING nombre_display INTO display;

  RETURN display;
END;
$$;

-- Drop corrupted catalog entries that have a clean equivalent
DELETE FROM public.vendedores_canonicos malo
WHERE malo.vendedor_key ~ '[^A-Z0-9 ]'
  AND EXISTS (
    SELECT 1 FROM public.vendedores_canonicos bueno
    WHERE bueno.vendedor_key !~ '[^A-Z0-9 ]'
      AND length(bueno.vendedor_key) = length(malo.vendedor_key)
      AND bueno.vendedor_key LIKE regexp_replace(malo.vendedor_key, '[^A-Z0-9 ]', '_', 'g')
  );

UPDATE public.ventas_cupra
SET vendedor = public.canonical_vendedor(vendedor)
WHERE vendedor IS DISTINCT FROM public.canonical_vendedor(vendedor);

UPDATE public.clientes SET vendedor_actual = vendedor_actual;