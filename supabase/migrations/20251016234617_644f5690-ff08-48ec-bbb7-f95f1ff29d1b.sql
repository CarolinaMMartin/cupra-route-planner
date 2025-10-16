-- Disable RLS on all tables and drop all policies

-- Drop all policies on profiles
DROP POLICY IF EXISTS "Asignadores can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Drop all policies on clientes
DROP POLICY IF EXISTS "Asignadores can manage clientes" ON public.clientes;
DROP POLICY IF EXISTS "Authenticated users can view clientes" ON public.clientes;

-- Drop all policies on sucursales
DROP POLICY IF EXISTS "Asignadores can manage sucursales" ON public.sucursales;
DROP POLICY IF EXISTS "Authenticated users can view sucursales" ON public.sucursales;

-- Drop all policies on asignaciones_vendedores_clientes
DROP POLICY IF EXISTS "Asignadores can manage all assignments" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Vendedores can update their assignments" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Vendedores can view their own assignments" ON public.asignaciones_vendedores_clientes;

-- Drop all policies on recomendaciones_ia
DROP POLICY IF EXISTS "Asignadores can manage recomendaciones" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Authenticated users can view recomendaciones" ON public.recomendaciones_ia;

-- Drop all policies on ventas_cupra
DROP POLICY IF EXISTS "Asignadores can manage ventas" ON public.ventas_cupra;
DROP POLICY IF EXISTS "Authenticated users can view ventas" ON public.ventas_cupra;

-- Drop all policies on clientes_recomendaciones_temporal
DROP POLICY IF EXISTS "Asignadores can manage temporal recommendations" ON public.clientes_recomendaciones_temporal;
DROP POLICY IF EXISTS "Authenticated users can view temporal recommendations" ON public.clientes_recomendaciones_temporal;

-- Drop all policies on visitas
DROP POLICY IF EXISTS "Asignadores can manage all visits" ON public.visitas;
DROP POLICY IF EXISTS "Vendedores can create their own visits" ON public.visitas;
DROP POLICY IF EXISTS "Vendedores can update their own visits" ON public.visitas;
DROP POLICY IF EXISTS "Vendedores can view their own visits" ON public.visitas;

-- Drop all policies on cliente_feedbacks
DROP POLICY IF EXISTS "Asignadores can manage all feedbacks" ON public.cliente_feedbacks;
DROP POLICY IF EXISTS "Vendedores can create their own feedbacks" ON public.cliente_feedbacks;
DROP POLICY IF EXISTS "Vendedores can view their own feedbacks" ON public.cliente_feedbacks;

-- Disable RLS on all tables
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursales DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_vendedores_clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recomendaciones_ia DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_cupra DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_recomendaciones_temporal DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_feedbacks DISABLE ROW LEVEL SECURITY;