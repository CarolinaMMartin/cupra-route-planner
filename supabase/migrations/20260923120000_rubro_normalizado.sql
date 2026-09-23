-- ============================================================
-- Rubro normalizado para clientes y prospectos.
--
-- Fuente:
--   clientes   → etiquetas (Categorías del maestro); si están vacías, las
--                categorías de sus líneas de venta (ventas_cupra.categorias).
--   prospectos → tipo_principal + tipos (Google) o el canal/rubro del Excel.
--
-- Una sola función SQL decide el rubro: la usan los triggers, el backfill y
-- `refrescar_rubros()` (que corren los importadores al terminar).
-- Si una categoría no matchea ninguna regla se conserva tal cual (Title Case),
-- así no se pierde información ni se inventa un rubro.
-- ============================================================

ALTER TABLE public.clientes   ADD COLUMN IF NOT EXISTS rubro text;
ALTER TABLE public.prospectos ADD COLUMN IF NOT EXISTS rubro text;

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
  IF s ~ '(CATERING|EVENTOS)' THEN RETURN 'Catering / Eventos'; END IF;
  IF s ~ '(GOURMET|DELI |DELICATESSEN|FIAMBRERIA|FOOD STORE)' THEN RETURN 'Tienda gourmet'; END IF;

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
           'Distribuidor', 'Catering / Eventos', 'Tienda gourmet') THEN
    RETURN r;
  END IF;
  RETURN public.normalizar_rubro(array_prepend(p_tipo, coalesce(p_tipos, '{}'::text[])));
END;
$$;

-- ---------- Triggers ----------
CREATE OR REPLACE FUNCTION public.tg_clientes_rubro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.rubro := public.normalizar_rubro(NEW.etiquetas);
  IF NEW.rubro IS NULL THEN
    SELECT public.normalizar_rubro(array_agg(DISTINCT trim(x))) INTO NEW.rubro
    FROM public.ventas_cupra v,
      LATERAL regexp_split_to_table(coalesce(v.categorias, ''), '[/|,;]') AS x
    WHERE v.client_id = NEW.client_id AND trim(x) <> '';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_rubro ON public.clientes;
CREATE TRIGGER trg_clientes_rubro
  BEFORE INSERT OR UPDATE OF etiquetas ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.tg_clientes_rubro();

CREATE OR REPLACE FUNCTION public.tg_prospectos_rubro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.rubro := public.rubro_prospecto(NEW.tipo_principal, NEW.tipos);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospectos_rubro ON public.prospectos;
CREATE TRIGGER trg_prospectos_rubro
  BEFORE INSERT OR UPDATE OF tipo_principal, tipos ON public.prospectos
  FOR EACH ROW EXECUTE FUNCTION public.tg_prospectos_rubro();

-- ---------- Recalculo completo (lo llaman los importadores) ----------
CREATE OR REPLACE FUNCTION public.refrescar_rubros()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_cli int;
  n_pro int;
BEGIN
  -- 1) Clientes con categorías propias (maestro).
  UPDATE public.clientes c
     SET rubro = public.normalizar_rubro(c.etiquetas)
   WHERE c.etiquetas IS NOT NULL AND array_length(c.etiquetas, 1) IS NOT NULL
     AND c.rubro IS DISTINCT FROM public.normalizar_rubro(c.etiquetas);

  -- 2) Clientes sin categorías: se usan las de sus ventas.
  WITH cat AS (
    SELECT v.client_id, array_agg(DISTINCT trim(x)) AS cats
      FROM public.ventas_cupra v,
           LATERAL regexp_split_to_table(coalesce(v.categorias, ''), '[/|,;]') AS x
     WHERE v.client_id IS NOT NULL AND trim(x) <> ''
     GROUP BY v.client_id
  )
  UPDATE public.clientes c
     SET rubro = public.normalizar_rubro(cat.cats)
    FROM cat
   WHERE c.client_id = cat.client_id
     AND (c.etiquetas IS NULL OR array_length(c.etiquetas, 1) IS NULL)
     AND c.rubro IS DISTINCT FROM public.normalizar_rubro(cat.cats);
  GET DIAGNOSTICS n_cli = ROW_COUNT;

  UPDATE public.prospectos p
     SET rubro = public.rubro_prospecto(p.tipo_principal, p.tipos)
   WHERE p.rubro IS DISTINCT FROM public.rubro_prospecto(p.tipo_principal, p.tipos);
  GET DIAGNOSTICS n_pro = ROW_COUNT;

  RETURN jsonb_build_object('clientes_desde_ventas', n_cli, 'prospectos', n_pro);
END;
$$;

-- Lo ejecutan solo los importadores (service role): recalcula toda la base.
REVOKE ALL ON FUNCTION public.refrescar_rubros() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refrescar_rubros() TO service_role;

-- ---------- Opciones para los filtros ----------
CREATE OR REPLACE FUNCTION public.rubros_disponibles()
RETURNS TABLE (rubro text, clientes bigint, prospectos bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (SELECT rubro, count(*) n FROM public.clientes WHERE rubro IS NOT NULL GROUP BY rubro),
       p AS (SELECT rubro, count(*) n FROM public.prospectos WHERE rubro IS NOT NULL GROUP BY rubro)
  SELECT coalesce(c.rubro, p.rubro), coalesce(c.n, 0), coalesce(p.n, 0)
    FROM c FULL OUTER JOIN p ON p.rubro = c.rubro
   ORDER BY coalesce(c.n, 0) + coalesce(p.n, 0) DESC;
$$;

REVOKE ALL ON FUNCTION public.rubros_disponibles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rubros_disponibles() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_clientes_rubro ON public.clientes (rubro);
CREATE INDEX IF NOT EXISTS idx_prospectos_rubro ON public.prospectos (rubro);
CREATE INDEX IF NOT EXISTS idx_prospectos_lat_lng ON public.prospectos (latitud, longitud);

-- Backfill inicial.
SELECT public.refrescar_rubros();
