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
      vendedor_principal text, etiquetas text[], last_recommendation_at timestamptz);
    CREATE TABLE prospectos (place_id text PRIMARY KEY, client_id text, es_cliente_cupra boolean DEFAULT false,
      estado_negocio text, tipo_principal text, tipos text[], latitud float, longitud float, last_recommendation_at timestamptz);
    CREATE TABLE ventas_cupra (client_id text, categorias text);
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
  for (const migration of ["20260923120000_rubro_normalizado.sql", "20260923130000_asignaciones_atomicas.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    TRUNCATE asignaciones_vendedores_clientes, asignaciones_manuales_audit, clientes, prospectos, profiles CASCADE;
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
