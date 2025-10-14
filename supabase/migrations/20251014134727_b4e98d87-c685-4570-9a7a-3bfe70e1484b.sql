-- Habilitar RLS en las tablas que no lo tienen
ALTER TABLE public.cliente_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recomendaciones_ia ENABLE ROW LEVEL SECURITY;

-- Crear políticas RLS para cliente_feedbacks
CREATE POLICY "Authenticated users can view cliente_feedbacks"
ON public.cliente_feedbacks
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert cliente_feedbacks"
ON public.cliente_feedbacks
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update cliente_feedbacks"
ON public.cliente_feedbacks
FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete cliente_feedbacks"
ON public.cliente_feedbacks
FOR DELETE
USING (auth.role() = 'authenticated');

-- Crear políticas RLS para recomendaciones_ia
CREATE POLICY "Authenticated users can view recomendaciones_ia"
ON public.recomendaciones_ia
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert recomendaciones_ia"
ON public.recomendaciones_ia
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update recomendaciones_ia"
ON public.recomendaciones_ia
FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete recomendaciones_ia"
ON public.recomendaciones_ia
FOR DELETE
USING (auth.role() = 'authenticated');

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