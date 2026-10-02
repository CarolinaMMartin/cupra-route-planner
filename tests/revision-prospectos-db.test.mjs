import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const admin='00000000-0000-0000-0000-000000000001', vendedor='00000000-0000-0000-0000-000000000002';
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE TABLE profiles(user_id uuid PRIMARY KEY,activo bool,rol text);
    CREATE TABLE clientes(client_id text PRIMARY KEY,razon_social text,fantasia text,telefonos text[],emails text[],direccion_principal text,todas_direcciones text[],barrio_principal text,ciudad_principal text,provincia_principal text,rubro text,vendedor_actual text,ultima_compra date,monto_total_historico numeric);
    CREATE TABLE prospectos(place_id text PRIMARY KEY,client_id text,es_cliente_cupra bool DEFAULT false,nombre text,direccion text,ciudad text,provincia text,barrio text,comuna text,latitud float,longitud float,telefono text,email text,website text,instagram text,rating numeric,total_ratings int,tipo_principal text,tipos text[],estado_negocio text,google_place_id text,rubro text,resumen_google text,nivel_precio text,sirve_vinos bool);
    CREATE TABLE client_places(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id text REFERENCES clientes(client_id),lat float,long float,is_primary bool,direccion_principal text,barrio_principal text,provincia_principal text,comuna text,google_maps_link text,fuente_geocoding text);
    CREATE TABLE visitas(id int PRIMARY KEY,prospecto_place_id text REFERENCES prospectos(place_id),estado text);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260928220000_revision_prospectos.sql',import.meta.url),'utf8'));
  await db.exec("ALTER TABLE clientes ADD COLUMN etiquetas text[]; CREATE TABLE ventas_cupra(client_id text,categorias text);");
  await db.exec(await readFile(new URL('../supabase/migrations/20260923120000_rubro_normalizado.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261002123000_prospeccion_empresarial.sql',import.meta.url),'utf8'));

});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec(`TRUNCATE prospecto_revision_historial,clientes_informacion_complementaria,prospectos_informacion_encontrada,prospecto_cliente_revisiones,client_places,visitas,prospectos,clientes,profiles CASCADE;
    INSERT INTO profiles VALUES('${admin}',true,'administrador'),('${vendedor}',true,'vendedor');
    INSERT INTO clientes(client_id,razon_social,telefonos,vendedor_actual,ultima_compra,monto_total_historico) VALUES('c1','Servicios del Sur',ARRAY['01155551234'],'Vendedor original','2026-08-10',125000);
    INSERT INTO prospectos(place_id,nombre,direccion,ciudad,provincia,barrio,latitud,longitud,telefono,email,website,rubro)
      VALUES('p1','Hotel Central','Calle 100','CABA','CABA','Palermo',-34.58,-58.44,'+54 11 5555 1234','nuevo@ejemplo.test','https://ejemplo.test','Hotel');
    INSERT INTO visitas VALUES(1,'p1','Visitado');`);
});
const fingerprints=async()=> (await db.query("SELECT huella_prospecto_cupra('p1') AS p,huella_cliente_cupra('c1') AS c")).rows[0];
const resolve=async(decision='unificado',user=admin,fp)=>{fp??=await fingerprints();return db.query('SELECT resolver_revision_cupra($1,$2,$3,$4,$5,$6) AS r',[user,'p1','c1',decision,fp.p,fp.c]);};
const found=async(extra={})=>(await db.query('SELECT incorporar_info_prospectos($1::jsonb) AS r',[JSON.stringify([{place_id:'p1',nombre:'Hotel Central',direccion:'Calle 100',ciudad:'CABA',provincia:'CABA',latitud:-34.58,longitud:-58.44,tipos:['hotel'],...extra}])])).rows[0].r;

test('unifica de forma atómica, agrega información y conserva dueño, ventas e historial',async()=>{
  await resolve();
  const c=(await db.query("SELECT * FROM clientes WHERE client_id='c1'")).rows[0];
  assert.equal(c.fantasia,'Hotel Central');assert.equal(c.direccion_principal,'Calle 100');
  assert.deepEqual(c.telefonos,['01155551234']);assert.deepEqual(c.emails,['nuevo@ejemplo.test']);
  assert.equal(c.vendedor_actual,'Vendedor original');assert.equal(Number(c.monto_total_historico),125000);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM visitas')).rows[0].n,1);
  assert.equal((await db.query("SELECT client_id FROM prospectos WHERE place_id='p1'")).rows[0].client_id,'c1');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM client_places')).rows[0].n,1);
  assert.equal((await db.query('SELECT datos FROM clientes_informacion_complementaria')).rows[0].datos.website,'https://ejemplo.test');
});
test('conserva datos en conflicto y coordenadas válidas; persiste los alternativos con su fuente',async()=>{
  await db.exec("UPDATE clientes SET fantasia='Nombre original',direccion_principal='Otra 22',emails=ARRAY['anterior@ejemplo.test']; INSERT INTO client_places(client_id,lat,long,is_primary) VALUES('c1',-34.62,-58.49,true)");
  await resolve();
  const c=(await db.query('SELECT * FROM clientes')).rows[0];
  assert.equal(c.fantasia,'Nombre original');assert.equal(c.direccion_principal,'Otra 22');assert.equal(c.emails.length,2);
  assert.equal((await db.query('SELECT lat FROM client_places')).rows[0].lat,-34.62);
  assert.equal((await db.query('SELECT datos FROM clientes_informacion_complementaria')).rows[0].datos.direccion,'Calle 100');
});
test('reintentar unificación no duplica teléfonos, ubicación ni auditoría',async()=>{
  await resolve();const n=(await db.query('SELECT count(*)::int AS n FROM prospecto_revision_historial')).rows[0].n;
  await resolve();assert.equal((await db.query('SELECT count(*)::int AS n FROM prospecto_revision_historial')).rows[0].n,n);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM client_places')).rows[0].n,1);
});
test('rechaza datos cambiados antes de unir y revierte sin modificar al prospecto',async()=>{
  const fp=await fingerprints();await db.exec("UPDATE clientes SET telefonos=ARRAY['1133334444']");
  await assert.rejects(resolve('unificado',admin,fp),/datos cambiaron/);
  assert.equal((await db.query('SELECT client_id FROM prospectos')).rows[0].client_id,null);
});
test('la decisión distinto persiste con huellas y se invalida si cambia la identidad',async()=>{
  await resolve('distinto');const d=(await db.query('SELECT * FROM prospecto_cliente_revisiones')).rows[0];
  assert.equal(d.prospecto_huella,(await fingerprints()).p);
  await db.exec("UPDATE prospectos SET telefono='1133334444'");assert.notEqual(d.prospecto_huella,(await fingerprints()).p);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM clientes_informacion_complementaria')).rows[0].n,0);
});
test('nuevos datos de Google completan vacíos, preservan conflictos y enriquecen un cliente ya unificado',async()=>{
  await resolve();await found({telefono:'1133334444',website:'https://nueva.test',instagram:'@hotel',email:'segundo@ejemplo.test'});
  const p=(await db.query('SELECT * FROM prospectos')).rows[0];assert.equal(p.telefono,'+54 11 5555 1234');assert.equal(p.instagram,'@hotel');assert.equal(p.client_id,'c1');
  const c=(await db.query('SELECT * FROM clientes')).rows[0];assert.ok(c.telefonos.includes('1133334444'));assert.ok(c.emails.includes('segundo@ejemplo.test'));
  assert.equal((await db.query('SELECT datos FROM clientes_informacion_complementaria')).rows[0].datos.website,'https://nueva.test');
});
test('resolver e incorporar son inaccesibles al navegador y la revisión exige rol habilitado',async()=>{
  await assert.rejects(resolve('unificado',vendedor),/asignador activo/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT contexto_revision_cupra()'),/permission denied/);
  await db.exec('RESET ROLE');
});
test('la incorporación no reabre negocios cerrados ni cambia vinculación y usa el ID canónico',async()=>{
  await db.exec("UPDATE prospectos SET google_place_id='google-p1',estado_negocio='CLOSED_PERMANENTLY'");
  const rows=await found({place_id:'google-p1',estado_negocio:'OPERATIONAL'});
  assert.equal(rows.length,1);assert.equal(rows[0].place_id,'p1');assert.equal(rows[0].estado_negocio,'CLOSED_PERMANENTLY');
});
test('conserva las variantes encontradas y los vacíos no borran datos; la huella detecta contactos alternativos',async()=>{
  await found({telefono:'1133334444',website:'https://primera.test',tipos:null});
  const fp=await fingerprints();await resolve('distinto');
  await found({telefono:'1166667777',website:''});
  assert.notEqual(fp.p,(await fingerprints()).p);
  const context=(await db.query('SELECT contexto_revision_cupra() AS r')).rows[0].r;
  assert.equal(context.prospectos[0].informacion_encontrada.telefono,'1166667777');
  assert.equal(context.prospectos[0].informacion_encontrada.website,'https://primera.test');
  assert.equal(context.prospectos[0].telefono,'+54 11 5555 1234');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM prospectos_informacion_historial')).rows[0].n,2);
});

test('empresas: clasificación persistente, enriquecimiento y reintento conservan el ID y datos propios',async()=>{
  const rows=await found({place_id:'empresa-google',nombre:'Empresa de prueba',tipo_principal:'corporate_office',tipos:['corporate_office','establishment'],rating:null,total_ratings:null});
  assert.equal(rows[0].rubro,'Empresa');
  await found({place_id:'empresa-google',nombre:'Empresa de prueba',tipo_principal:'corporate_office',website:'https://empresa.example',telefono:'1123456789'});
  const saved=(await db.query("SELECT * FROM prospectos WHERE place_id='empresa-google'")).rows[0];
  assert.equal(saved.rubro,'Empresa');assert.equal(saved.website,'https://empresa.example');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM prospectos WHERE place_id='empresa-google'")).rows[0].n,1);
  await db.exec("UPDATE prospectos SET tipo_principal='Manual',tipos='{}' WHERE place_id='p1'");
  await found({tipo_principal:'hotel',tipos:['hotel','restaurant']});
  assert.equal((await db.query("SELECT rubro FROM prospectos WHERE place_id='p1'")).rows[0].rubro,'Hotel');
  await found({tipo_principal:'restaurant',tipos:['restaurant']});
  assert.equal((await db.query("SELECT rubro FROM prospectos WHERE place_id='p1'")).rows[0].rubro,'Hotel');
});
test('rubros de empresas, hoteles y profesionales se normalizan en clientes, prospectos y Excel',async()=>{
  for(const [tipo,rubro] of [['corporate_office','Empresa'],['business_center','Empresa'],['coworking_space','Empresa'],['manufacturer','Empresa'],['Empresa','Empresa'],['lawyer','Estudio jurídico'],['accounting','Estudio contable'],['real_estate_agency','Inmobiliaria'],['insurance_agency','Agencia de seguros'],['event_venue','Catering / Eventos'],['hotel','Hotel']]){
    assert.equal((await db.query("SELECT rubro_prospecto($1,ARRAY[$1,'restaurant']) AS r",[tipo])).rows[0].r,rubro);
    await db.query("UPDATE clientes SET etiquetas=ARRAY[$1] WHERE client_id='c1'",[tipo]);
    assert.equal((await db.query("SELECT rubro FROM clientes WHERE client_id='c1'")).rows[0].rubro,rubro);
  }
});
