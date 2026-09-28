import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const admin = "00000000-0000-0000-0000-000000000001";
const vendedor = "00000000-0000-0000-0000-000000000002";
const otro = "00000000-0000-0000-0000-000000000003";
let db;
const guardar = (filas, cartera = false) => db.query("select guardar_asignaciones($1::jsonb, $2) as total", [JSON.stringify(filas), cartera]);
const visita = (client_id = "c1", extra = {}) => ({ vendedor_id: vendedor, client_id, ...extra });

before(async () => {
  db = new PGlite();
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
  `);
  for (const migration of ["20260923120000_rubro_normalizado.sql", "20260923130000_asignaciones_atomicas.sql", "20260925120000_analisis_ventas.sql", "20260928140000_ruta_mapa.sql", "20260928150000_mapa_sin_cartera.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    TRUNCATE mapa_zonas_prospectos, ventas_cupra, asignaciones_vendedores_clientes, asignaciones_manuales_audit, clientes, prospectos, profiles CASCADE;
    INSERT INTO profiles VALUES ('${admin}', 'Admin', 'administrador', true, false),
      ('${vendedor}', 'Vendedora', 'vendedor', true, false), ('${otro}', 'Otro', 'vendedor', true, false);
    INSERT INTO clientes(client_id, razon_social, vendedor_actual) VALUES ('c1', 'Cuenta 1', 'Otro'), ('c2', 'Cuenta 2', 'Otro');
    INSERT INTO prospectos(place_id) VALUES ('p1');
    SELECT set_config('test.uid', '${admin}', false);
  `);
});

test("una nueva visita conserva todo el historial del mismo vendedor", async () => {
  await db.query("insert into asignaciones_vendedores_clientes(vendedor_id,client_id,estado) values ($1,'c1','Visitado'),($1,'c2','Visitado')", [vendedor]);
  await guardar([visita()]);
  const { rows } = await db.query("select estado, count(*)::int as n from asignaciones_vendedores_clientes group by estado order by estado");
  assert.deepEqual(rows, [{ estado: "Asignado", n: 1 }, { estado: "Visitado", n: 2 }]);
});

test("la agenda propia permite repetir una visita histórica pero bloquea dos pendientes del mismo día", async () => {
  const insertar = (estado, fecha) => db.query(
    "insert into asignaciones_vendedores_clientes(vendedor_id,client_id,estado,fecha_programada,origen_asignacion) values ($1,'c1',$2,$3,'auto')",
    [vendedor, estado, fecha],
  );
  await insertar("Visitado", "2099-01-01");
  await insertar("Por visitar", "2099-01-01");
  await assert.rejects(insertar("Por visitar", "2099-01-01"), { code: "23505" });
  await insertar("Por visitar", "2099-01-02");
  assert.equal((await db.query("select count(*)::int as n from asignaciones_vendedores_clientes")).rows[0].n, 3);
});

test("un fallo en una fila revierte el lote completo y no pierde las pendientes previas", async () => {
  await guardar([visita()]);
  const antes = (await db.query("select * from asignaciones_vendedores_clientes")).rows;
  await assert.rejects(guardar([visita("c1", { vendedor_id: otro }), visita("cuenta-inexistente")]));
  assert.deepEqual((await db.query("select * from asignaciones_vendedores_clientes")).rows, antes);
});

test("reintentar el mismo guardado conserva el ID de la visita", async () => {
  await guardar([visita()]);
  const antes = (await db.query("select id, created_at from asignaciones_vendedores_clientes")).rows;
  await guardar([visita()]);
  assert.deepEqual((await db.query("select id, created_at from asignaciones_vendedores_clientes")).rows, antes);
});

test("asignar hoy conserva una visita programada para otro día", async () => {
  await guardar([visita("c1", { fecha_programada: "2099-01-01" })]);
  await guardar([visita()]);
  assert.equal((await db.query("select count(*)::int as n from asignaciones_vendedores_clientes")).rows[0].n, 2);
});

test("reasignar una pendiente conserva su ID y fecha", async () => {
  await guardar([visita("c1", { fecha_programada: "2099-01-01" })]);
  const anterior = (await db.query("select id from asignaciones_vendedores_clientes")).rows[0];
  await guardar([visita("c1", { asignacion_id: anterior.id, vendedor_id: otro })]);
  assert.deepEqual((await db.query("select id, vendedor_id, fecha_programada::text as fecha from asignaciones_vendedores_clientes")).rows,
    [{ id: anterior.id, vendedor_id: otro, fecha: "2099-01-01" }]);
});

test("una visita completada mientras se edita no se reabre ni se borra", async () => {
  await guardar([visita()]);
  const { rows } = await db.query("update asignaciones_vendedores_clientes set estado='Visitado' returning id");
  await assert.rejects(guardar([visita("c1", { asignacion_id: rows[0].id, vendedor_id: otro })]));
  assert.equal((await db.query("select estado from asignaciones_vendedores_clientes")).rows[0].estado, "Visitado");
});

test("transferencia de cartera y auditoría se guardan juntas; una visita simple no cambia al dueño", async () => {
  await guardar([visita()]);
  assert.equal((await db.query("select vendedor_actual from clientes where client_id='c1'")).rows[0].vendedor_actual, "Otro");
  await guardar([visita()], true);
  assert.equal((await db.query("select vendedor_actual from clientes where client_id='c1'")).rows[0].vendedor_actual, "Vendedora");
  assert.equal((await db.query("select count(*)::int as n from asignaciones_manuales_audit")).rows[0].n, 1);
  await guardar([visita()], true);
  assert.equal((await db.query("select count(*)::int as n from asignaciones_manuales_audit")).rows[0].n, 1);
});

test("rechaza un usuario sin permisos, un vendedor inactivo y cuentas duplicadas", async () => {
  await db.query("select set_config('test.uid', $1, false)", [vendedor]);
  await assert.rejects(guardar([visita()]), /asignador o administrador/);
  await db.query("select set_config('test.uid', $1, false)", [admin]);
  await db.query("update profiles set activo=false where user_id=$1", [vendedor]);
  await assert.rejects(guardar([visita()]), /no está activo/);
  await db.query("update profiles set activo=true where user_id=$1", [vendedor]);
  await assert.rejects(guardar([visita(), visita("c1", { vendedor_id: otro })]), /dos veces/);
});

test("prospectos convertidos o cerrados no se asignan desde una pantalla vieja", async () => {
  const fila = { vendedor_id: vendedor, prospecto_place_id: "p1" };
  await db.exec("update prospectos set estado_negocio='CLOSED_PERMANENTLY'");
  await assert.rejects(guardar([fila]), /dejó de estar disponible/);
  await db.exec("update prospectos set estado_negocio='OPERATIONAL', client_id='c1'");
  await assert.rejects(guardar([fila]), /dejó de estar disponible/);
});

test("la migración normaliza rubros y los triggers actualizan clientes y prospectos", async () => {
  await db.exec("update clientes set etiquetas=ARRAY['vinoteca'] where client_id='c1'; update prospectos set tipo_principal='bar', tipos=ARRAY['restaurant']");
  assert.equal((await db.query("select rubro from clientes where client_id='c1'")).rows[0].rubro, "Vinoteca");
  assert.equal((await db.query("select rubro from prospectos")).rows[0].rubro, "Bar");
  assert.equal((await db.query("select count(*)::int as n from rubros_disponibles()")).rows[0].n, 2);
});

const resumen = async filtros => (await db.query("select resumen_ventas($1::jsonb) as r", [JSON.stringify(filtros)])).rows[0].r;
test("análisis suma todas las filas del Excel, incluso más de 1000, y separa notas de crédito", async () => {
  await db.exec(`INSERT INTO ventas_cupra(client_id,ticket,letra,fecha_emision,tipo_comprobante,vendedor,nombre,facturacion_ars,cajas)
    SELECT 'c1', n::text, 'A', '2026-01-15', 'factura', 'Vendedora', 'Vino', 100, 1 FROM generate_series(1,2505) n;
    INSERT INTO ventas_cupra(client_id,ticket,letra,fecha_emision,tipo_comprobante,vendedor,nombre,facturacion_ars,cajas)
    VALUES ('c2','1','A','2026-02-01','nota_credito','Otro','Vino',-500,-5);`);
  const r = await resumen({});
  assert.equal(r.filas,2506); assert.equal(r.neto,250000); assert.equal(r.ventas,250500); assert.equal(r.notas_credito,500);
  assert.equal(r.comprobantes,2506); assert.equal(r.meses.length,2);
  assert.equal(r.rubros.reduce((s,x)=>s+x.neto,0),r.neto);
});
test("análisis respeta archivo, fechas, vendedor y clientes sin confundir selección vacía con todo", async () => {
  await db.exec(`INSERT INTO ventas_cupra(client_id,ticket,fecha_emision,vendedor,facturacion_ars,import_batch_id)
    VALUES ('c1','1','2026-01-01','Micaela Rocha',100,'${admin}'), ('c2','2','2026-02-01','Otro',200,'${vendedor}'),
      ('c1','3','2026-02-01','Micaela Rocha',300,'${admin}');`);
  assert.equal((await resumen({lote_id:admin,desde:'2026-02-01',hasta:'2026-02-01',vendedor:'  MICAELA   ROCHA ',client_ids:['c1']})).neto,300);
  assert.equal((await resumen({client_ids:[]})).filas,0);
  assert.equal((await resumen({client_ids:['c2']})).neto,200);
});
test("análisis rechaza usuarios sin permiso y filtros inválidos", async () => {
  await db.query("select set_config('test.uid',$1,false)",[vendedor]);
  await assert.rejects(resumen({}),/administrador activo/);
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  await assert.rejects(resumen([]),/Filtros inválidos/);
  await assert.rejects(resumen({client_ids:12}));
  await db.query("update profiles set activo=false where user_id=$1",[admin]);
  await assert.rejects(resumen({}),/administrador activo/);
});

const guardarMapa = (clients=['c1','c2'], prospects=['p1','p2','p3','p4','p5','p6']) => db.query('select guardar_ruta_mapa($1,$2,$3) as total',[vendedor,clients,prospects]);
async function prepararMapa(){
  await db.exec(`INSERT INTO client_places(client_id,lat,long) VALUES ('c1',-34.60,-58.401),('c2',-34.60,-58.399);
    UPDATE prospectos SET latitud=-34.60,longitud=-58.40 WHERE place_id='p1';
    INSERT INTO prospectos(place_id,latitud,longitud) SELECT 'p'||n,-34.60,-58.40 FROM generate_series(2,6) n;`);
}
test('mapa guarda ocho visitas y un reintento no duplica las asignaciones',async()=>{
  await prepararMapa();assert.equal((await guardarMapa()).rows[0].total,8);
  const rows=(await db.query('select id from asignaciones_vendedores_clientes order by id')).rows;
  await guardarMapa();assert.deepEqual((await db.query('select id from asignaciones_vendedores_clientes order by id')).rows,rows);
});
test('mapa rechaza siete, nueve, duplicados y rutas sin clientes ni barrio antes de escribir',async()=>{
  await prepararMapa();
  await assert.rejects(guardarMapa(['c1']),/ocho/);
  await assert.rejects(guardarMapa(['c1','c2','c2']),/ocho/);
  await assert.rejects(guardarMapa(['c1','c1']),/únicas/);
  await assert.rejects(guardarMapa([],['p1','p2','p3','p4','p5','p6','p7','p8']),/barrio/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,0);
});
test('mapa calcula el centro de todos los clientes y no del primer punto',async()=>{
  await prepararMapa();await db.exec("UPDATE client_places SET lat=CASE WHEN client_id='c1' THEN -34.612 ELSE -34.588 END;");
  assert.equal((await guardarMapa()).rows[0].total,8);
});
test('mapa impide que los prospectos desplacen el centro para evadir 1,5 km',async()=>{
  await prepararMapa();await db.exec('UPDATE prospectos SET latitud=-34.584;');
  await assert.rejects(guardarMapa(),/1,5 km/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,0);
});
test('mapa relee la ubicación corregida y revierte todo si quedó fuera de radio',async()=>{
  await prepararMapa();await db.exec("UPDATE client_places SET lat=-34.70 WHERE client_id='c2';");
  await assert.rejects(guardarMapa(),/1,5 km/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,0);
});
test('mapa rechaza un cliente excluido o sin coordenadas válidas',async()=>{
  await prepararMapa();await db.exec("UPDATE clientes SET excluir_recomendaciones=true WHERE client_id='c1';");
  await assert.rejects(guardarMapa(),/disponible/);
  await db.exec("UPDATE clientes SET excluir_recomendaciones=false; UPDATE client_places SET lat=0,long=0 WHERE client_id='c1';");
  await assert.rejects(guardarMapa(),/ubicación/);
});
test('mapa no toma un prospecto que otro vendedor recibió mientras se armaba la ruta',async()=>{
  await prepararMapa();await guardar([{vendedor_id:otro,prospecto_place_id:'p1'}]);
  await assert.rejects(guardarMapa(),/asignado/);
  assert.deepEqual((await db.query('select vendedor_id,prospecto_place_id from asignaciones_vendedores_clientes')).rows,[{vendedor_id:otro,prospecto_place_id:'p1'}]);
});
test('mapa valida permisos y no admite usuarios inactivos',async()=>{
  await prepararMapa();await db.query("select set_config('test.uid',$1,false)",[vendedor]);
  await assert.rejects(guardarMapa(),{code:'42501'});
  await db.query("select set_config('test.uid',$1,false)",[admin]);await db.query('update profiles set activo=false where user_id=$1',[admin]);
  await assert.rejects(guardarMapa(),{code:'42501'});
  assert.equal((await db.query("select has_function_privilege('anon','guardar_ruta_mapa(uuid,text[],text[],text)','EXECUTE') as ok")).rows[0].ok,false);
});

const ochoProspectos = Array.from({length:8},(_,i)=>`p${i+1}`);
const guardarSoloProspectos = (ids=ochoProspectos, zona='palermo') => db.query('select guardar_ruta_mapa($1,$2,$3,$4) as total',[vendedor,[],ids,zona]);
async function prepararBarrio(){
  await prepararMapa();
  await db.exec("INSERT INTO mapa_zonas_prospectos(zona_key,provincia,comuna,barrio,lat,lng) VALUES ('palermo','CABA','Comuna 14','Palermo',-34.6,-58.4); INSERT INTO prospectos(place_id,latitud,longitud) VALUES ('p7',-34.6,-58.4),('p8',-34.6,-58.4);");
  await db.exec("UPDATE prospectos SET barrio='Palermo',ciudad='Buenos Aires',provincia='CABA';");
}
test('sin cartera guarda ocho prospectos y conserva las carteras existentes',async()=>{
  await prepararBarrio();assert.equal((await guardarSoloProspectos()).rows[0].total,8);
  assert.deepEqual((await db.query('select distinct client_id,es_prospecto,vendedor_id from asignaciones_vendedores_clientes')).rows,[{client_id:null,es_prospecto:true,vendedor_id:vendedor}]);
  assert.deepEqual((await db.query('select distinct vendedor_actual from clientes')).rows,[{vendedor_actual:'Otro'}]);
  const antes=(await db.query('select id from asignaciones_vendedores_clientes order by id')).rows;
  await guardarSoloProspectos();assert.deepEqual((await db.query('select id from asignaciones_vendedores_clientes order by id')).rows,antes);
});
test('sin cartera rechaza barrio no verificado, siete, nueve o duplicados sin escribir',async()=>{
  await prepararBarrio();
  await assert.rejects(guardarSoloProspectos(ochoProspectos,'desconocido'),/barrio/);
  await assert.rejects(guardarSoloProspectos(ochoProspectos.slice(0,7)),/ocho/);
  await assert.rejects(guardarSoloProspectos([...ochoProspectos,'p9']),/ocho/);
  await assert.rejects(guardarSoloProspectos([...ochoProspectos.slice(0,7),'p1']),/únicas/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,0);
});
test('sin cartera comprueba 1,5 km desde el barrio, no desde los prospectos',async()=>{
  await prepararBarrio();await db.exec('UPDATE prospectos SET latitud=-34.584;');
  await assert.rejects(guardarSoloProspectos(),/1,5 km/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,0);
});
test('sin cartera rechaza un prospecto convertido o asignado a otro vendedor',async()=>{
  await prepararBarrio();await db.exec("UPDATE prospectos SET es_cliente_cupra=true WHERE place_id='p8';");
  await assert.rejects(guardarSoloProspectos(),/disponible/);
  await db.exec("UPDATE prospectos SET es_cliente_cupra=false WHERE place_id='p8';");await guardar([{vendedor_id:otro,prospecto_place_id:'p8'}]);
  await assert.rejects(guardarSoloProspectos(),/asignado/);
  assert.equal((await db.query('select count(*)::int as n from asignaciones_vendedores_clientes')).rows[0].n,1);
});
test('centro de barrio no puede reemplazar el centro de una ruta con clientes',async()=>{
  await prepararBarrio();await assert.rejects(db.query('select guardar_ruta_mapa($1,$2,$3,$4)',[vendedor,['c1','c2'],ochoProspectos.slice(0,6),'palermo']),/centro de esos clientes/);
});
test('el navegador no puede crear ni modificar centros de barrio',async()=>{
  const {rows}=await db.query("select has_table_privilege('authenticated','mapa_zonas_prospectos','INSERT') as insertar,has_table_privilege('authenticated','mapa_zonas_prospectos','UPDATE') as modificar,has_function_privilege('anon','guardar_ruta_mapa(uuid,text[],text[],text)','EXECUTE') as anon");
  assert.deepEqual(rows,[{insertar:false,modificar:false,anon:false}]);
});
test('sin cartera no confirma negocios de otro barrio aunque estén dentro del radio',async()=>{
  await prepararBarrio();await db.exec("UPDATE prospectos SET barrio='Recoleta' WHERE place_id='p8';");
  await assert.rejects(guardarSoloProspectos(),/barrio/);
  await db.exec("UPDATE prospectos SET barrio='Palermo',provincia='Buenos Aires' WHERE place_id='p8';");
  await assert.rejects(guardarSoloProspectos(),/barrio/);
  await db.exec("UPDATE prospectos SET barrio='Palermo Soho',provincia='Ciudad Autónoma de Buenos Aires' WHERE place_id='p8';");
  assert.equal((await guardarSoloProspectos()).rows[0].total,8);
});
