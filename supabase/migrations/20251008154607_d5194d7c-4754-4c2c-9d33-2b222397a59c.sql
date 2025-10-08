-- Disable RLS on all remaining public tables for development/debugging
alter table clientes_unificados disable row level security;
alter table sucursales disable row level security;
alter table vendedores disable row level security;
alter table ventas_cupra disable row level security;