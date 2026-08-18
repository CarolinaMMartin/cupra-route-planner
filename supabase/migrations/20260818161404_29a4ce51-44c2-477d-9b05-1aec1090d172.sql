DELETE FROM public.areas_vendedores WHERE area_id IN (SELECT id FROM public.areas WHERE lower(nombre) = 'lomas de zamora');
DELETE FROM public.areas_places WHERE area_id IN (SELECT id FROM public.areas WHERE lower(nombre) = 'lomas de zamora');
DELETE FROM public.areas WHERE lower(nombre) = 'lomas de zamora';
DELETE FROM public.recomendaciones_ia;
DELETE FROM public.visita_briefings;
UPDATE public.clientes SET last_recommendation_at = NULL WHERE last_recommendation_at IS NOT NULL;
UPDATE public.prospectos SET last_recommendation_at = NULL WHERE last_recommendation_at IS NOT NULL;