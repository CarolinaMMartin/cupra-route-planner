-- 1) AREAS
CREATE TABLE IF NOT EXISTS public.areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  color TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_areas_nombre ON public.areas (nombre);

-- 2) RELACIÓN AREAS ↔ PLACES
CREATE TABLE IF NOT EXISTS public.areas_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id UUID NOT NULL REFERENCES public.areas(id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (area_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_areas_places_area ON public.areas_places (area_id);
CREATE INDEX IF NOT EXISTS idx_areas_places_place ON public.areas_places (place_id);

-- 3) RELACIÓN AREAS ↔ VENDEDORES (profiles)
CREATE TABLE IF NOT EXISTS public.areas_vendedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id UUID NOT NULL REFERENCES public.areas(id) ON DELETE CASCADE,
  vendedor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (area_id, vendedor_id)
);
CREATE INDEX IF NOT EXISTS idx_areas_vendedores_area ON public.areas_vendedores (area_id);
CREATE INDEX IF NOT EXISTS idx_areas_vendedores_vend ON public.areas_vendedores (vendedor_id);

-- 4) RLS
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas_vendedores ENABLE ROW LEVEL SECURITY;

-- Lectura para todo usuario autenticado
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas' AND policyname='areas_select_auth'
  ) THEN
    CREATE POLICY areas_select_auth ON public.areas FOR SELECT
      TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas_places' AND policyname='areas_places_select_auth'
  ) THEN
    CREATE POLICY areas_places_select_auth ON public.areas_places FOR SELECT
      TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas_vendedores' AND policyname='areas_vendedores_select_auth'
  ) THEN
    CREATE POLICY areas_vendedores_select_auth ON public.areas_vendedores FOR SELECT
      TO authenticated USING (true);
  END IF;
END $$;

-- Escritura: por ahora permitir a autenticados (lo afinamos luego por rol/owner)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas' AND policyname='areas_write_auth'
  ) THEN
    CREATE POLICY areas_write_auth ON public.areas FOR ALL
      TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas_places' AND policyname='areas_places_write_auth'
  ) THEN
    CREATE POLICY areas_places_write_auth ON public.areas_places FOR ALL
      TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='areas_vendedores' AND policyname='areas_vendedores_write_auth'
  ) THEN
    CREATE POLICY areas_vendedores_write_auth ON public.areas_vendedores FOR ALL
      TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5) TRIGGER updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'areas_set_updated_at'
  ) THEN
    CREATE TRIGGER areas_set_updated_at
      BEFORE UPDATE ON public.areas
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;