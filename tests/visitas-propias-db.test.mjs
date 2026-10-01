import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const admin='00000000-0000-4000-8000-000000000001', seller='00000000-0000-4000-8000-000000000002', other='00000000-0000-4000-8000-000000000003', inactive='00000000-0000-4000-8000-000000000004';
let db;
const sqlFile=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
before(async()=>{
 db=new PGlite();
 await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TYPE estado_asignacion AS ENUM ('Asignado', 'Por visitar', 'Visitado');
    CREATE TABLE profiles (user_id uuid PRIMARY KEY, nombre text, rol text, activo boolean, perfil_ventas boolean);
    CREATE TABLE clientes (client_id text PRIMARY KEY, razon_social text, vendedor_actual text,
      vendedor_principal text, etiquetas text[], last_recommendation_at timestamptz, excluir_recomendaciones boolean DEFAULT false);
    CREATE TABLE client_places (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id text REFERENCES clientes(client_id),
      lat numeric,long numeric,is_primary boolean DEFAULT true,direccion_verificada boolean DEFAULT false);
    CREATE TABLE prospectos (place_id text PRIMARY KEY, client_id text, es_cliente_cupra boolean DEFAULT false,
      estado_negocio text, tipo_principal text, tipos text[], barrio text, ciudad text, provincia text, latitud float, longitud float, last_recommendation_at timestamptz);
    CREATE TABLE ventas_cupra (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, client_id text, categorias text,
      ticket text, letra text, fecha_emision date, tipo_comprobante text, vendedor text, nombre text, codigo_producto text,
      facturacion_ars numeric, cajas integer, import_batch_id uuid);
    CREATE TABLE asignaciones_vendedores_clientes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendedor_id uuid REFERENCES profiles(user_id),
      client_id text REFERENCES clientes(client_id), prospecto_place_id text REFERENCES prospectos(place_id),
      estado estado_asignacion NOT NULL DEFAULT 'Asignado', es_prospecto boolean NOT NULL DEFAULT false,
      origen_asignacion text DEFAULT 'asignador', created_at timestamptz NOT NULL DEFAULT now(),
      visited_at timestamptz, fecha_programada date,
      CONSTRAINT asignaciones_vendedores_clientes_vendedor_id_cliente_id_key UNIQUE(vendedor_id, client_id),
      CONSTRAINT check_client_or_prospecto CHECK (
        (client_id IS NOT NULL AND prospecto_place_id IS NULL AND es_prospecto = false) OR
        (client_id IS NULL AND prospecto_place_id IS NOT NULL AND es_prospecto = true))
    );
    CREATE UNIQUE INDEX idx_unique_vendedor_cliente ON asignaciones_vendedores_clientes(vendedor_id, client_id) WHERE client_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_unique_vendedor_prospecto ON asignaciones_vendedores_clientes(vendedor_id, prospecto_place_id) WHERE prospecto_place_id IS NOT NULL;
    CREATE TABLE asignaciones_manuales_audit (
      usuario_id uuid, vendedor_anterior text, vendedor_nuevo_id uuid, vendedor_nuevo_nombre text, client_id text, razon_social text);

  ALTER ROLE service_role BYPASSRLS;
  ALTER TABLE clientes ADD fantasia text, ADD direccion_principal text, ADD barrio_principal text, ADD telefonos text[], ADD rubro text;
  ALTER TABLE client_places ADD direccion_principal text, ADD barrio_principal text;
  ALTER TABLE prospectos ADD nombre text, ADD direccion text, ADD telefono text, ADD rubro text;
  CREATE TABLE cliente_feedbacks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendedor_id uuid,client_id text,prospecto_place_id text);
  CREATE TABLE visita_briefings(client_id text,prospecto_place_id text);
  CREATE TABLE notificaciones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendedor_id uuid,tipo text,titulo text,mensaje text,asignacion_id uuid,leida boolean DEFAULT false);
  CREATE FUNCTION is_active_user(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=u AND activo)$$;
  CREATE FUNCTION is_active_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=u AND activo AND rol='administrador')$$;
  CREATE FUNCTION is_assignor_like(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=u AND activo AND rol IN ('administrador','asignador'))$$;
  CREATE FUNCTION rubros_disponibles() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
  CREATE FUNCTION sync_places_catalog() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
  CREATE FUNCTION get_vendedor_barrios_top(uuid,integer) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
  CREATE FUNCTION get_user_role(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT rol FROM profiles WHERE user_id=$1$$;
  GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
  DO $block$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('CREATE POLICY lectura ON %I FOR SELECT TO authenticated USING (true)',t.tablename);
  END LOOP; END $block$;
  CREATE POLICY "Vendedores pueden auto-asignarse" ON asignaciones_vendedores_clientes FOR INSERT TO authenticated WITH CHECK(vendedor_id=auth.uid());
  CREATE POLICY editar ON asignaciones_vendedores_clientes FOR UPDATE TO authenticated USING(vendedor_id=auth.uid()) WITH CHECK(vendedor_id=auth.uid());
  CREATE POLICY quitar ON asignaciones_vendedores_clientes FOR DELETE TO authenticated USING(vendedor_id=auth.uid() AND origen_asignacion='auto');
 `);
 for(const name of ['20260923130000_asignaciones_atomicas.sql','20261001150000_seguridad_prepruebas.sql','20261001160000_visitas_propias_catalogo.sql'])await db.exec(await sqlFile(name));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`TRUNCATE asignaciones_vendedores_clientes,movimientos_visitas,notificaciones,cliente_feedbacks,visita_briefings,clientes,prospectos,profiles CASCADE;
 INSERT INTO profiles VALUES('${admin}','Admin','administrador',true,false),('${seller}','Vendedora','vendedor',true,false),('${other}','Otro','vendedor',true,false),('${inactive}','Inactivo','vendedor',false,false);
 INSERT INTO clientes(client_id,razon_social,vendedor_actual)VALUES('c1','Comercio uno','Otro'),('c2','Comercio dos','Otro');
 INSERT INTO prospectos(place_id,nombre)VALUES('p1','Prospecto');`);
});
async function as(uid,fn,role='authenticated'){
 await db.query("SELECT set_config('test.uid',$1,false)",[uid??'']);await db.exec('SET ROLE '+role);
 try{return await fn();}finally{await db.exec('RESET ROLE');}
}
const take=(uid,client='c1',prospect=null,date=null)=>as(uid,()=>db.query('SELECT autoasignar_visita($1,$2,$3) AS result',[client,prospect,date]));
const count=async table=>(await db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;

test('catálogo compartido sin acceso a fichas ni pendientes ajenos',async()=>{
 await db.query("INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id)VALUES($1,'c1')",[other]);
 await as(seller,async()=>{
  assert.equal((await db.query('SELECT * FROM asignaciones_vendedores_clientes')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM clientes')).rows.length,0);
  const data=(await db.query("SELECT catalogo_visitas('comercio','clientes',0,100) AS data")).rows[0].data;
  assert.equal(data.length,2);assert(!('monto_total_historico' in data[0]));
 });
 await as(inactive,()=>assert.rejects(db.query('SELECT catalogo_visitas()'),/activa/));
 await as(null,()=>assert.rejects(db.query('SELECT catalogo_visitas()'),/permission denied/),'anon');
});
test('tomar una visita transfiere el pendiente, conserva historial y notifica una sola vez',async()=>{
 await db.query("INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id,estado,fecha_programada)VALUES($1,'c1','Visitado',current_date-5),($1,'c1','Por visitar',current_date)",[other]);
 const previo=(await db.query("SELECT id FROM asignaciones_vendedores_clientes WHERE estado='Por visitar'")).rows[0].id;
 const r=await take(seller);assert.equal(r.rows[0].result.id,previo);assert(r.rows[0].result.reasignada);
 assert.equal(await count('asignaciones_vendedores_clientes'),2);assert.equal(await count('movimientos_visitas'),1);assert.equal(await count('notificaciones'),1);
 assert.equal((await take(seller)).rows[0].result.creada,false);assert.equal(await count('notificaciones'),1);
 assert.equal((await db.query("SELECT vendedor_actual FROM clientes WHERE client_id='c1'")).rows[0].vendedor_actual,'Otro');
 await as(seller,async()=>{assert.equal((await db.query('SELECT * FROM asignaciones_vendedores_clientes')).rows.length,1);assert.equal((await db.query('SELECT * FROM clientes')).rows.length,1);});
 await as(other,async()=>{const r=(await db.query('SELECT * FROM asignaciones_vendedores_clientes')).rows;assert.equal(r.length,1);assert.equal(r[0].estado,'Visitado');});
});
test('cuenta inactiva y asignador sin perfil de ventas no pueden tomar visitas',async()=>{
 await assert.rejects(take(inactive),/perfil de ventas/);await assert.rejects(take(admin),/perfil de ventas/);assert.equal(await count('asignaciones_vendedores_clientes'),0);
});
test('no se puede saltar la notificación insertando directamente ni cambiar identidad por UPDATE',async()=>{
 await as(seller,()=>assert.rejects(db.query("INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id)VALUES($1,'c1')",[seller]),/row-level security/));
 await take(seller);
 await as(seller,()=>assert.rejects(db.exec("UPDATE asignaciones_vendedores_clientes SET client_id='c2'"),/operación de asignación/));
 await as(seller,()=>db.exec("UPDATE asignaciones_vendedores_clientes SET estado='Visitado',visited_at=now()"));
 await as(seller,()=>assert.rejects(db.exec("UPDATE asignaciones_vendedores_clientes SET estado='Asignado'"),/historia/));
 await as(seller,async()=>{await db.exec('DELETE FROM asignaciones_vendedores_clientes');assert.equal((await db.query('SELECT * FROM asignaciones_vendedores_clientes')).rows.length,1);});
});
test('un fallo de notificación revierte también la autoasignación',async()=>{
 await db.exec("CREATE FUNCTION fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'notificación de prueba';END$$; CREATE TRIGGER fail_notification BEFORE INSERT ON notificaciones FOR EACH ROW EXECUTE FUNCTION fail_notification();");
 try{await assert.rejects(take(seller),/notificación de prueba/);assert.equal(await count('asignaciones_vendedores_clientes'),0);assert.equal(await count('movimientos_visitas'),0);}
 finally{await db.exec('DROP TRIGGER fail_notification ON notificaciones;DROP FUNCTION fail_notification();');}
});
test('reasignación por baja de vendedor conserva fechas e historial y exige asignador',async()=>{
 await db.query("INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id,estado,fecha_programada)VALUES($1,'c1','Visitado',current_date-5),($1,'c1','Asignado',current_date),($1,'c1','Asignado',current_date+10)",[inactive]);
 await as(seller,()=>assert.rejects(db.query('SELECT reasignar_pendientes($1,$2)',[inactive,seller]),/asignador/));
 const r=await as(admin,()=>db.query('SELECT reasignar_pendientes($1,$2) AS n',[inactive,seller]));assert.equal(r.rows[0].n,2);
 assert.equal(await count('asignaciones_vendedores_clientes'),3);assert.equal(await count('movimientos_visitas'),2);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM asignaciones_vendedores_clientes WHERE vendedor_id=$1 AND estado='Visitado'",[inactive])).rows[0].n,1);
});
test('prospectos convertidos y comercios visitados hoy no crean otra visita',async()=>{
 await db.exec("UPDATE prospectos SET client_id='c1'");await assert.rejects(take(seller,null,'p1'),/disponible/);
 await db.query("INSERT INTO asignaciones_vendedores_clientes(vendedor_id,client_id,estado,visited_at)VALUES($1,'c1','Visitado',now())",[other]);
 await assert.rejects(take(seller),/visitado/);
});

test('baja de perfil conserva su registro aunque exista una política de borrado permisiva',async()=>{
 await db.exec('CREATE POLICY borrado_permisivo_prueba ON profiles FOR DELETE TO authenticated USING(true)');
 try{await as(admin,()=>db.query('DELETE FROM profiles WHERE user_id=$1',[other]));assert.equal(await count('profiles'),4);}
 finally{await db.exec('DROP POLICY borrado_permisivo_prueba ON profiles');}
});
