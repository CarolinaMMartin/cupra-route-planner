CREATE OR REPLACE FUNCTION public.is_assignor_like(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = _user_id
      AND rol IN ('asignador'::public.app_role, 'administrador'::public.app_role)
      AND activo IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_assignor_like(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_assignor_like(uuid) TO authenticated, service_role;