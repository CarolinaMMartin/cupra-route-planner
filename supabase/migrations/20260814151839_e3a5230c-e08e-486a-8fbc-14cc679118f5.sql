REVOKE EXECUTE ON FUNCTION public.recompute_client_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_client_metrics() TO service_role;