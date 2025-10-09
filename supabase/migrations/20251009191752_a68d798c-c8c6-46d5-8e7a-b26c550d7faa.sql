-- Agregar campo activo a la tabla profiles
ALTER TABLE public.profiles 
ADD COLUMN activo boolean DEFAULT true;

-- Actualizar la función handle_new_user para NO crear registros en vendedores
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insertar en profiles
  INSERT INTO public.profiles (user_id, nombre, email, rol, activo)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nombre', 'Usuario'),
    new.email,
    COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor'),
    COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor') = 'vendedor'
  );
  
  RETURN new;
END;
$$;

-- Eliminar todas las políticas RLS de vendedores
DROP POLICY IF EXISTS "Asignadores can view all vendedores" ON public.vendedores;
DROP POLICY IF EXISTS "Vendedores can view themselves" ON public.vendedores;
DROP POLICY IF EXISTS "Asignadores can update vendedores" ON public.vendedores;
DROP POLICY IF EXISTS "Asignadores can insert vendedores" ON public.vendedores;

-- Eliminar la tabla vendedores
DROP TABLE IF EXISTS public.vendedores CASCADE;