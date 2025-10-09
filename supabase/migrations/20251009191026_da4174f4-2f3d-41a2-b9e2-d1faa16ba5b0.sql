-- Modificar el campo activo de vendedores para que por defecto sea false
ALTER TABLE public.vendedores 
ALTER COLUMN activo SET DEFAULT false;

-- Modificar la función handle_new_user para crear registro en vendedores
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insertar en profiles
  INSERT INTO public.profiles (user_id, nombre, email, rol)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nombre', 'Usuario'),
    new.email,
    COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor')
  );
  
  -- Si el rol es vendedor, crear registro en vendedores
  IF COALESCE((new.raw_user_meta_data->>'rol')::app_role, 'vendedor') = 'vendedor' THEN
    INSERT INTO public.vendedores (nombre, email, zona, activo)
    VALUES (
      COALESCE(new.raw_user_meta_data->>'nombre', 'Usuario'),
      new.email,
      COALESCE(new.raw_user_meta_data->>'zona', 'Sin asignar'),
      false
    );
  END IF;
  
  RETURN new;
END;
$$;

-- Políticas RLS para que asignadores puedan actualizar vendedores
CREATE POLICY "Asignadores can update vendedores"
ON public.vendedores
FOR UPDATE
USING (get_user_role(auth.uid()) = 'asignador'::app_role);

-- Políticas RLS para que asignadores puedan insertar vendedores
CREATE POLICY "Asignadores can insert vendedores"
ON public.vendedores
FOR INSERT
WITH CHECK (get_user_role(auth.uid()) = 'asignador'::app_role);

-- Políticas RLS para que asignadores puedan ver y actualizar profiles
CREATE POLICY "Asignadores can view all profiles"
ON public.profiles
FOR SELECT
USING (get_user_role(auth.uid()) = 'asignador'::app_role);

CREATE POLICY "Asignadores can update all profiles"
ON public.profiles
FOR UPDATE
USING (get_user_role(auth.uid()) = 'asignador'::app_role);