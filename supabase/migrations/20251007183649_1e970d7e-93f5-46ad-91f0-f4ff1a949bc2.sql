-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('asignador', 'vendedor');

-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nombre text NOT NULL,
  email text NOT NULL,
  rol app_role NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create vendedores table
CREATE TABLE public.vendedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  zona text NOT NULL,
  email text NOT NULL,
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create sucursales table
CREATE TABLE public.sucursales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  direccion text NOT NULL,
  zona text NOT NULL,
  tipo_cliente text NOT NULL,
  score integer DEFAULT 0,
  dias_sin_visita integer DEFAULT 0,
  latitud decimal(10, 8),
  longitud decimal(11, 8),
  created_at timestamptz DEFAULT now()
);

-- Create visitas table
CREATE TABLE public.visitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id uuid REFERENCES public.vendedores(id) ON DELETE CASCADE NOT NULL,
  sucursal_id uuid REFERENCES public.sucursales(id) ON DELETE CASCADE NOT NULL,
  fecha date NOT NULL,
  estado text DEFAULT 'pendiente',
  notas text,
  hora_checkin timestamptz,
  hora_checkout timestamptz,
  geolocalizacion jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM public.profiles WHERE user_id = _user_id;
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for vendedores (asignadores can see all, vendedores see themselves)
CREATE POLICY "Asignadores can view all vendedores"
  ON public.vendedores FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'asignador');

CREATE POLICY "Vendedores can view themselves"
  ON public.vendedores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND email = vendedores.email
    )
  );

-- RLS Policies for sucursales (all authenticated users can view)
CREATE POLICY "Authenticated users can view sucursales"
  ON public.sucursales FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for visitas
CREATE POLICY "Asignadores can view all visitas"
  ON public.visitas FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'asignador');

CREATE POLICY "Vendedores can view their own visitas"
  ON public.visitas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vendedores v
      JOIN public.profiles p ON v.email = p.email
      WHERE v.id = visitas.vendedor_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Asignadores can insert visitas"
  ON public.visitas FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) = 'asignador');

CREATE POLICY "Vendedores can update their own visitas"
  ON public.visitas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.vendedores v
      JOIN public.profiles p ON v.email = p.email
      WHERE v.id = visitas.vendedor_id AND p.user_id = auth.uid()
    )
  );

-- Trigger to create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nombre, email, rol)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nombre', 'Usuario'),
    new.email,
    COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor')
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();