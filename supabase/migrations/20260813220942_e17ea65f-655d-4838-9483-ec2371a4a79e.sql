-- 1. Normalization helpers
CREATE OR REPLACE FUNCTION public.vendedor_key(_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(upper(public.unaccent(regexp_replace(btrim(coalesce(_nombre,'')), '\s+', ' ', 'g'))), '')
$$;

-- 2. Canonical catalog
CREATE TABLE IF NOT EXISTS public.vendedores_canonicos (
  vendedor_key text PRIMARY KEY,
  nombre_display text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vendedores_canonicos TO authenticated;
GRANT ALL ON public.vendedores_canonicos TO service_role;
ALTER TABLE public.vendedores_canonicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendedores_canonicos_select" ON public.vendedores_canonicos;
CREATE POLICY "vendedores_canonicos_select" ON public.vendedores_canonicos
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "vendedores_canonicos_admin" ON public.vendedores_canonicos;
CREATE POLICY "vendedores_canonicos_admin" ON public.vendedores_canonicos
  FOR ALL TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

DROP TRIGGER IF EXISTS vendedores_canonicos_set_updated_at ON public.vendedores_canonicos;
CREATE TRIGGER vendedores_canonicos_set_updated_at
  BEFORE UPDATE ON public.vendedores_canonicos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Seed catalog: prefer accented variant, then most frequent
WITH fuente AS (
  SELECT vendedor AS nombre, count(*)::bigint AS n FROM public.ventas_cupra WHERE vendedor IS NOT NULL GROUP BY 1
  UNION ALL
  SELECT vendedor_actual, count(*) FROM public.clientes WHERE vendedor_actual IS NOT NULL GROUP BY 1
  UNION ALL
  SELECT vendedor_principal, count(*) FROM public.clientes WHERE vendedor_principal IS NOT NULL GROUP BY 1
  UNION ALL
  SELECT unnest(todos_vendedores), 1 FROM public.clientes WHERE todos_vendedores IS NOT NULL
  UNION ALL
  SELECT nombre, 1 FROM public.profiles WHERE rol IN ('vendedor','administrador','asignador')
), agrupado AS (
  SELECT public.vendedor_key(nombre) AS k, nombre, sum(n) AS total
  FROM fuente
  WHERE public.vendedor_key(nombre) IS NOT NULL
  GROUP BY 1, 2
), elegido AS (
  SELECT DISTINCT ON (k) k,
    initcap(regexp_replace(btrim(nombre), '\s+', ' ', 'g')) AS display
  FROM agrupado
  ORDER BY k, (nombre ~ '[^\x00-\x7F]') DESC, total DESC, nombre
)
INSERT INTO public.vendedores_canonicos (vendedor_key, nombre_display)
SELECT k, display FROM elegido
ON CONFLICT (vendedor_key) DO NOTHING;

-- 4. Resolver: returns canonical display, registering unseen names
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

  display := initcap(regexp_replace(btrim(_nombre), '\s+', ' ', 'g'));
  INSERT INTO public.vendedores_canonicos (vendedor_key, nombre_display)
  VALUES (k, display)
  ON CONFLICT (vendedor_key) DO UPDATE SET nombre_display = public.vendedores_canonicos.nombre_display
  RETURNING nombre_display INTO display;

  RETURN display;
END;
$$;

-- 5. Triggers to keep incoming data normalized
CREATE OR REPLACE FUNCTION public.normalize_ventas_vendedor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.vendedor := public.canonical_vendedor(NEW.vendedor);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ventas_cupra_normalize_vendedor ON public.ventas_cupra;
CREATE TRIGGER ventas_cupra_normalize_vendedor
  BEFORE INSERT OR UPDATE ON public.ventas_cupra
  FOR EACH ROW EXECUTE FUNCTION public.normalize_ventas_vendedor();

CREATE OR REPLACE FUNCTION public.normalize_clientes_vendedores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.vendedor_actual := public.canonical_vendedor(NEW.vendedor_actual);
  NEW.vendedor_principal := public.canonical_vendedor(NEW.vendedor_principal);
  IF NEW.todos_vendedores IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT v ORDER BY v), '{}'::text[])
    INTO NEW.todos_vendedores
    FROM (
      SELECT public.canonical_vendedor(x) AS v
      FROM unnest(NEW.todos_vendedores) AS x
    ) s
    WHERE v IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clientes_normalize_vendedores ON public.clientes;
CREATE TRIGGER clientes_normalize_vendedores
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.normalize_clientes_vendedores();

-- 6. Backfill existing rows
UPDATE public.ventas_cupra
SET vendedor = public.canonical_vendedor(vendedor)
WHERE vendedor IS DISTINCT FROM public.canonical_vendedor(vendedor);

UPDATE public.clientes SET vendedor_actual = vendedor_actual;