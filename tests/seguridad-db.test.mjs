import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const admin='11111111-1111-4111-8111-111111111111';
const seller='22222222-2222-4222-8222-222222222222';
const inactive='33333333-3333-4333-8333-333333333333';
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE profiles(user_id uuid PRIMARY KEY,activo boolean,rol text);
    INSERT INTO profiles VALUES('${admin}',true,'administrador'),('${seller}',true,'vendedor'),('${inactive}',false,'vendedor');
    CREATE FUNCTION is_active_user(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=u AND activo)$$;
    CREATE FUNCTION is_active_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=u AND activo AND rol='administrador')$$;
    CREATE FUNCTION rubros_disponibles() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
    CREATE FUNCTION sync_places_catalog() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
    CREATE FUNCTION get_vendedor_barrios_top(uuid,integer) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
    CREATE FUNCTION get_user_role(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT rol FROM profiles WHERE user_id=$1$$;
    CREATE TABLE clientes(client_id text PRIMARY KEY,razon_social text);
    CREATE TABLE prospectos(place_id text PRIMARY KEY,nombre text);
    CREATE TABLE ventas_cupra(id integer PRIMARY KEY,facturacion_ars numeric);
    CREATE TABLE asignaciones_vendedores_clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendedor_id uuid,client_id text,prospecto_place_id text,es_prospecto boolean DEFAULT false,estado text,fecha_programada date,created_at timestamptz DEFAULT now());
    CREATE TABLE notificaciones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendedor_id uuid,tipo text,titulo text,mensaje text,asignacion_id uuid,leida boolean DEFAULT false);
    INSERT INTO clientes VALUES('C1','Cliente de prueba');
    INSERT INTO prospectos VALUES('P1','Prospecto de prueba');
    INSERT INTO ventas_cupra VALUES(1,100);
    ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prospectos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ventas_cupra ENABLE ROW LEVEL SECURITY;
    ALTER TABLE asignaciones_vendedores_clientes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
    CREATE POLICY clientes_legacy ON clientes FOR SELECT TO authenticated USING(true);
    CREATE POLICY prospectos_legacy ON prospectos FOR ALL TO authenticated USING(true) WITH CHECK(true);
    CREATE POLICY ventas_legacy ON ventas_cupra FOR SELECT TO authenticated USING(is_active_user(auth.uid()));
    CREATE POLICY "Service role acceso completo notificaciones" ON notificaciones FOR ALL TO public USING(true) WITH CHECK(true);
    INSERT INTO notificaciones(vendedor_id,tipo,titulo) VALUES('${seller}','recordatorio','Propia'),('${admin}','recordatorio','Ajena');
    CREATE SCHEMA cron;
    CREATE TABLE cron.job(jobid bigint PRIMARY KEY,command text,active boolean);
    INSERT INTO cron.job VALUES(3,'functions/v1/check-pending-assignments',true),(4,'functions/v1/cleanup-visited-assignments',true);
    CREATE FUNCTION cron.alter_job(job_id bigint,command text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET command=coalesce($2,cron.job.command),active=coalesce($3,cron.job.active) WHERE jobid=$1$$;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261001150000_seguridad_prepruebas.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
async function as(role,uid,fn) {
  await db.query("SELECT set_config('test.uid',$1,false)",[uid??'']);
  await db.exec('SET ROLE '+role);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
test('anónimo no puede leer ni escribir notificaciones',async()=>{
  await as('anon',null,async()=>{
    await assert.rejects(db.query('SELECT * FROM notificaciones'),/permission denied/);
    await assert.rejects(db.query("INSERT INTO notificaciones(titulo) VALUES('falsa')"),/permission denied/);
  });
});
test('vendedor lee solo las propias, marca leída y no altera destinatario ni mensaje',async()=>{
  await as('authenticated',seller,async()=>{
    assert.equal((await db.query('SELECT * FROM notificaciones')).rows.length,1);
    assert.equal((await db.query('UPDATE notificaciones SET leida=true RETURNING id')).rows.length,1);
    await assert.rejects(db.query("UPDATE notificaciones SET mensaje='cambiado'"),/permission denied/);
    await assert.rejects(db.query('DELETE FROM notificaciones'),/permission denied/);
    await assert.rejects(db.query('INSERT INTO notificaciones(vendedor_id,tipo) VALUES($1,\'recordatorio\')',[admin]),/row-level security/);
    await db.query('INSERT INTO notificaciones(vendedor_id,tipo) VALUES($1,\'recordatorio\')',[seller]);
  });
});
test('una cuenta inactiva no accede aunque sobrevivan políticas permisivas antiguas',async()=>{
  await as('authenticated',inactive,async()=>{
    for(const table of ['clientes','prospectos','ventas_cupra','notificaciones']) assert.equal((await db.query('SELECT * FROM '+table)).rows.length,0,table);
    await assert.rejects(db.query("INSERT INTO prospectos VALUES('P2','No permitido')"),/row-level security/);
  });
});
test('histórico monetario accesible para administrador y servicio; no para vendedor',async()=>{
  assert.equal(await as('authenticated',seller,async()=>(await db.query('SELECT * FROM ventas_cupra')).rows.length),0);
  assert.equal(await as('authenticated',admin,async()=>(await db.query('SELECT * FROM ventas_cupra')).rows.length),1);
  assert.equal(await as('service_role',null,async()=>(await db.query('SELECT * FROM ventas_cupra')).rows.length),1);
});
test('cron conserva historia y reemplaza el llamado público por SQL interno',async()=>{
  const {rows}=await db.query('SELECT * FROM cron.job ORDER BY jobid');
  assert.equal(rows[0].command,'SELECT public.generar_notificaciones_pendientes();');
  assert.equal(rows[0].active,true);assert.equal(rows[1].active,false);
  for(const role of ['anon','authenticated']) await as(role,seller,()=>assert.rejects(db.query('SELECT generar_notificaciones_pendientes()'),/permission denied/));
});
test('pendientes respeta fecha programada, evita duplicados y conserva visitas completadas',async()=>{
  await db.query(`INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id,estado,fecha_programada,created_at) VALUES
    ($1,'C1','Asignado',current_date-10,now()-interval '20 days'),
    ($1,'C1','Asignado',current_date+5,now()-interval '20 days'),
    ($1,'C1','Visitado',current_date-10,now()-interval '20 days')`,[seller]);
  assert.equal((await db.query('SELECT generar_notificaciones_pendientes() AS n')).rows[0].n,1);
  assert.equal((await db.query('SELECT generar_notificaciones_pendientes() AS n')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM asignaciones_vendedores_clientes')).rows[0].n,3);
});
