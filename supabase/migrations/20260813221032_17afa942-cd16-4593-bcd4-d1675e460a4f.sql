-- Proper Spanish title case (initcap breaks on accents)
CREATE OR REPLACE FUNCTION public.titlecase_nombre(_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    (SELECT string_agg(
       CASE
         WHEN w.ord > 1 AND lower(w.palabra) IN ('de','del','la','las','los','y','e','da','do')
           THEN lower(w.palabra)
         ELSE upper(left(w.palabra, 1)) || lower(substr(w.palabra, 2))
       END, ' ' ORDER BY w.ord)
     FROM unnest(regexp_split_to_array(regexp_replace(btrim(coalesce(_texto,'')), '\s+', ' ', 'g'), ' '))
       WITH ORDINALITY AS w(palabra, ord)
    ), '')
$$;

-- Rebuild catalog collapsing accent variants
CREATE TEMP TABLE tmp_canon ON COMMIT DROP AS
SELECT DISTINCT ON (public.vendedor_key(nombre_display))
  public.vendedor_key(nombre_display) AS k,
  public.titlecase_nombre(nombre_display) AS display
FROM public.vendedores_canonicos
ORDER BY public.vendedor_key(nombre_display), (nombre_display ~ '[^\x00-\x7F]') DESC, nombre_display;

DELETE FROM public.vendedores_canonicos;
INSERT INTO public.vendedores_canonicos (vendedor_key, nombre_display)
SELECT k, display FROM tmp_canon WHERE k IS NOT NULL;

-- Use proper title case for newly discovered names too
CREATE OR REPLACE FUNCTION public.canonical_vendedor(_nombre text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  display text;
BEGIN
  k := public.vendedor_key(_nombre);
  IF k IS NULL THEN RETURN NULL; END IF;

  SELECT nombre_display INTO display FROM public.vendedores_canonicos WHERE vendedor_key = k;
  IF display IS NOT NULL THEN RETURN display; END IF;

  display := public.titlecase_nombre(_nombre);
  INSERT INTO public.vendedores_canonicos (vendedor_key, nombre_display)
  VALUES (k, display)
  ON CONFLICT (vendedor_key) DO UPDATE SET nombre_display = public.vendedores_canonicos.nombre_display
  RETURNING nombre_display INTO display;

  RETURN display;
END;
$$;

-- Re-backfill
UPDATE public.ventas_cupra
SET vendedor = public.canonical_vendedor(vendedor)
WHERE vendedor IS DISTINCT FROM public.canonical_vendedor(vendedor);

UPDATE public.clientes SET vendedor_actual = vendedor_actual;

UPDATE public.profiles
SET nombre = public.titlecase_nombre(nombre)
WHERE nombre IS DISTINCT FROM public.titlecase_nombre(nombre);