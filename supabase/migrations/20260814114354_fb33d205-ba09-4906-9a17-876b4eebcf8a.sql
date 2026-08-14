GRANT SELECT ON public.areas TO authenticated;
GRANT SELECT ON public.areas_vendedores TO authenticated;
GRANT SELECT ON public.areas_places TO authenticated;
GRANT SELECT ON public.places TO authenticated;
GRANT ALL ON public.areas TO service_role;
GRANT ALL ON public.areas_vendedores TO service_role;
GRANT ALL ON public.areas_places TO service_role;
GRANT ALL ON public.places TO service_role;