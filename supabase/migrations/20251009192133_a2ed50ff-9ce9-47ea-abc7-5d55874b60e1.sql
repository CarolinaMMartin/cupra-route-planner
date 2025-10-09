-- Actualizar la función handle_new_user para manejar correctamente el campo activo
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insertar en profiles con activo = false si es vendedor, true si es asignador
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