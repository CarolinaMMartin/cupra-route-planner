-- Habilitar RLS en las tablas que no lo tienen
ALTER TABLE public.cliente_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recomendaciones_ia ENABLE ROW LEVEL SECURITY;

-- Crear políticas RLS para cliente_feedbacks solo si no existen
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_feedbacks' AND policyname = 'Authenticated users can view cliente_feedbacks'
    ) THEN
        CREATE POLICY "Authenticated users can view cliente_feedbacks"
        ON public.cliente_feedbacks
        FOR SELECT
        USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_feedbacks' AND policyname = 'Authenticated users can insert cliente_feedbacks'
    ) THEN
        CREATE POLICY "Authenticated users can insert cliente_feedbacks"
        ON public.cliente_feedbacks
        FOR INSERT
        WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_feedbacks' AND policyname = 'Authenticated users can update cliente_feedbacks'
    ) THEN
        CREATE POLICY "Authenticated users can update cliente_feedbacks"
        ON public.cliente_feedbacks
        FOR UPDATE
        USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_feedbacks' AND policyname = 'Authenticated users can delete cliente_feedbacks'
    ) THEN
        CREATE POLICY "Authenticated users can delete cliente_feedbacks"
        ON public.cliente_feedbacks
        FOR DELETE
        USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- Crear políticas RLS para recomendaciones_ia solo si no existen
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recomendaciones_ia' AND policyname = 'Authenticated users can view recomendaciones_ia'
    ) THEN
        CREATE POLICY "Authenticated users can view recomendaciones_ia"
        ON public.recomendaciones_ia
        FOR SELECT
        USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recomendaciones_ia' AND policyname = 'Authenticated users can insert recomendaciones_ia'
    ) THEN
        CREATE POLICY "Authenticated users can insert recomendaciones_ia"
        ON public.recomendaciones_ia
        FOR INSERT
        WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recomendaciones_ia' AND policyname = 'Authenticated users can update recomendaciones_ia'
    ) THEN
        CREATE POLICY "Authenticated users can update recomendaciones_ia"
        ON public.recomendaciones_ia
        FOR UPDATE
        USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recomendaciones_ia' AND policyname = 'Authenticated users can delete recomendaciones_ia'
    ) THEN
        CREATE POLICY "Authenticated users can delete recomendaciones_ia"
        ON public.recomendaciones_ia
        FOR DELETE
        USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- Arreglar el search_path de la función update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;