-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create ENUM types if they don't exist
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('vendedor', 'asignador');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_asignacion AS ENUM ('Asignado', 'Visitado', 'Cerrado', 'Cancelado');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT rol FROM public.profiles WHERE user_id = _user_id;
$$;

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nombre, email, rol, activo)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nombre', 'Usuario'),
    new.email,
    COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor'),
    CASE 
      WHEN COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor') = 'vendedor' THEN false
      ELSE true
    END
  );
  RETURN new;
END;
$$;

-- Create trigger for new user registration if not exists
DO $$ BEGIN
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create function for updating timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_vendedores_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recomendaciones_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_cupra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_recomendaciones_temporal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_feedbacks ENABLE ROW LEVEL SECURITY;

-- Policies for profiles table
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Asignadores can update all profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for clientes table
CREATE POLICY "Authenticated users can view clientes"
ON public.clientes FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Asignadores can manage clientes"
ON public.clientes FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for sucursales table
CREATE POLICY "Authenticated users can view sucursales"
ON public.sucursales FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Asignadores can manage sucursales"
ON public.sucursales FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for asignaciones_vendedores_clientes
CREATE POLICY "Vendedores can view their own assignments"
ON public.asignaciones_vendedores_clientes FOR SELECT
TO authenticated
USING (
  vendedor_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

CREATE POLICY "Asignadores can manage all assignments"
ON public.asignaciones_vendedores_clientes FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

CREATE POLICY "Vendedores can update their assignments"
ON public.asignaciones_vendedores_clientes FOR UPDATE
TO authenticated
USING (vendedor_id = auth.uid());

-- Policies for recomendaciones_ia
CREATE POLICY "Authenticated users can view recomendaciones"
ON public.recomendaciones_ia FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Asignadores can manage recomendaciones"
ON public.recomendaciones_ia FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for ventas_cupra
CREATE POLICY "Authenticated users can view ventas"
ON public.ventas_cupra FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Asignadores can manage ventas"
ON public.ventas_cupra FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for clientes_recomendaciones_temporal
CREATE POLICY "Authenticated users can view temporal recommendations"
ON public.clientes_recomendaciones_temporal FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Asignadores can manage temporal recommendations"
ON public.clientes_recomendaciones_temporal FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for visitas
CREATE POLICY "Vendedores can view their own visits"
ON public.visitas FOR SELECT
TO authenticated
USING (
  vendedor_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

CREATE POLICY "Vendedores can create their own visits"
ON public.visitas FOR INSERT
TO authenticated
WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Vendedores can update their own visits"
ON public.visitas FOR UPDATE
TO authenticated
USING (vendedor_id = auth.uid());

CREATE POLICY "Asignadores can manage all visits"
ON public.visitas FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Policies for cliente_feedbacks
CREATE POLICY "Vendedores can view their own feedbacks"
ON public.cliente_feedbacks FOR SELECT
TO authenticated
USING (
  vendedor_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

CREATE POLICY "Vendedores can create their own feedbacks"
ON public.cliente_feedbacks FOR INSERT
TO authenticated
WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Asignadores can manage all feedbacks"
ON public.cliente_feedbacks FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND rol = 'asignador'
  )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_rol ON public.profiles(rol);
CREATE INDEX IF NOT EXISTS idx_asignaciones_vendedor ON public.asignaciones_vendedores_clientes(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_client ON public.asignaciones_vendedores_clientes(client_id);
CREATE INDEX IF NOT EXISTS idx_visitas_vendedor ON public.visitas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_visitas_sucursal ON public.visitas(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_vendedor ON public.cliente_feedbacks(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_clientes_client_id ON public.clientes(client_id);
CREATE INDEX IF NOT EXISTS idx_sucursales_client_id ON public.sucursales(client_id);