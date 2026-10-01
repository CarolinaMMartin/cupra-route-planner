ALTER ROLE service_role SET statement_timeout = '140s';
NOTIFY pgrst, 'reload config';