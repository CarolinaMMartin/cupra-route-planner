-- Renombrar columna ciudad_principa a ciudad_principal
ALTER TABLE public.clientes 
RENAME COLUMN ciudad_principa TO ciudad_principal;