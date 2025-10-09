-- Crear tabla recomendaciones_ia
CREATE TABLE public.recomendaciones_ia (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contacto TEXT,
  comuna TEXT,
  justificacion TEXT NOT NULL,
  barrio TEXT,
  longitud TEXT,
  subzona TEXT,
  vendedor_asignado TEXT,
  ultima_visita TEXT,
  mapa TEXT,
  estado TEXT,
  provincia TEXT,
  ultima_sugerencia TIMESTAMP WITH TIME ZONE,
  notas TEXT,
  direccion TEXT,
  latitud TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on recomendaciones_ia
ALTER TABLE public.recomendaciones_ia ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view recomendaciones_ia
CREATE POLICY "Authenticated users can view recomendaciones_ia"
ON public.recomendaciones_ia
FOR SELECT
USING (auth.role() = 'authenticated');

-- Policy: Asignadores can insert recomendaciones_ia
CREATE POLICY "Asignadores can insert recomendaciones_ia"
ON public.recomendaciones_ia
FOR INSERT
WITH CHECK (get_user_role(auth.uid()) = 'asignador');

-- Policy: Asignadores can update recomendaciones_ia
CREATE POLICY "Asignadores can update recomendaciones_ia"
ON public.recomendaciones_ia
FOR UPDATE
USING (get_user_role(auth.uid()) = 'asignador');

-- Crear tabla asignaciones_vendedores_clientes
CREATE TABLE public.asignaciones_vendedores_clientes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendedor_id UUID NOT NULL REFERENCES public.vendedores(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(vendedor_id, cliente_id)
);

-- Enable RLS on asignaciones_vendedores_clientes
ALTER TABLE public.asignaciones_vendedores_clientes ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view asignaciones
CREATE POLICY "Authenticated users can view asignaciones"
ON public.asignaciones_vendedores_clientes
FOR SELECT
USING (auth.role() = 'authenticated');

-- Policy: Asignadores can manage asignaciones
CREATE POLICY "Asignadores can insert asignaciones"
ON public.asignaciones_vendedores_clientes
FOR INSERT
WITH CHECK (get_user_role(auth.uid()) = 'asignador');

CREATE POLICY "Asignadores can delete asignaciones"
ON public.asignaciones_vendedores_clientes
FOR DELETE
USING (get_user_role(auth.uid()) = 'asignador');