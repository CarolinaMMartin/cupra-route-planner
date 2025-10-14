-- Desactivar Row Level Security de todas las tablas públicas

-- Tabla: asignaciones_vendedores_clientes
ALTER TABLE public.asignaciones_vendedores_clientes DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can delete asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Anyone authenticated can view asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Anyone authenticated can insert asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Anyone authenticated can update asignaciones" ON public.asignaciones_vendedores_clientes;

-- Tabla: cliente_feedbacks
ALTER TABLE public.cliente_feedbacks DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view cliente_feedbacks" ON public.cliente_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can insert cliente_feedbacks" ON public.cliente_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can update cliente_feedbacks" ON public.cliente_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can delete cliente_feedbacks" ON public.cliente_feedbacks;

-- Tabla: clientes
ALTER TABLE public.clientes DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view clientes" ON public.clientes;

-- Tabla: clientes_recomendaciones_temporal
ALTER TABLE public.clientes_recomendaciones_temporal DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view clientes_unificados" ON public.clientes_recomendaciones_temporal;

-- Tabla: profiles
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Asignadores can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Asignadores can view all profiles" ON public.profiles;

-- Tabla: recomendaciones_ia
ALTER TABLE public.recomendaciones_ia DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can insert recomendaciones_ia" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Authenticated users can update recomendaciones_ia" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Authenticated users can delete recomendaciones_ia" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Authenticated users can view recomendaciones_ia" ON public.recomendaciones_ia;

-- Tabla: sucursales
ALTER TABLE public.sucursales DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view sucursales" ON public.sucursales;

-- Tabla: visitas
ALTER TABLE public.visitas DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Asignadores can view all visitas" ON public.visitas;
DROP POLICY IF EXISTS "Asignadores can insert visitas" ON public.visitas;