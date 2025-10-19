-- Drop existing places table and recreate with only needed columns
DROP TABLE IF EXISTS public.places CASCADE;

CREATE TABLE public.places (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  comuna TEXT,
  barrio_principal TEXT,
  provincia_principal TEXT,
  UNIQUE(comuna, barrio_principal, provincia_principal)
);

-- Create index for better query performance
CREATE INDEX idx_places_location ON public.places(provincia_principal, comuna, barrio_principal);

-- Disable RLS on all tables
ALTER TABLE public.places DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_vendedores_clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_feedbacks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_recomendaciones_temporal DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recomendaciones_ia DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursales DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_cupra DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas DISABLE ROW LEVEL SECURITY;