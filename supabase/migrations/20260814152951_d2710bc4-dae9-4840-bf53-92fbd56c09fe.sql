REVOKE ALL ON FUNCTION public.reconciliar_places_primarios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_places_primarios() TO service_role;