import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const migration = async name => db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const uid = '11111111-1111-4111-8111-111111111111';
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./import-schema.sql', import.meta.url), 'utf8'));
  await migration('20260814155913_da040c33-da73-413f-a867-2d96c2e7e790.sql');
  await migration('20260814164819_a10c8241-79db-489a-a9f6-ca16ab2a0a66.sql');
  await migration('20260923120000_rubro_normalizado.sql');
  await migration('20260925140000_importaciones_seguras.sql');
  await db.query('INSERT INTO profiles(user_id,rol) VALUES($1,\'asignador\')',[uid]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
after(async () => db?.close());
beforeEach(async () => { await db.exec('TRUNCATE import_prospectos_filas,ventas_cupra,ventas_cupra_eliminadas,client_places,clientes,prospectos,import_batches;'); });
const sale = (ticket='1', extra={}) => ({ client_id:'A',ticket,letra:'A',fecha_emision:'2026-09-01',codigo_producto:'W',tipo_comprobante:'venta',facturacion_ars:100,cajas:1,renglon:1,...extra });
const client = (id='A', extra={}) => ({client_id:id,razon_social:'Comercio',...extra});
async function batch(tipo='ventas') {
  const {rows}=await db.query("INSERT INTO import_batches(tipo,version_etl,archivo_nombre) VALUES($1,'test','test.xlsx') RETURNING id",[tipo]); return rows[0].id;
}
async function save(id, sales, clients=[client()], places=[], replace=false, confirm=false) {
  return (await db.query('SELECT guardar_importacion($1,$2,$3,$4,$5,$6) AS result',[id,JSON.stringify(clients),JSON.stringify(places),sales === null ? null : JSON.stringify(sales),replace,confirm])).rows[0].result;
}
async function rows(table) { return (await db.query(`SELECT * FROM ${table}`)).rows; }

test('una guarda rechazada revierte clientes, ubicaciones y ventas', async () => {
  await save(await batch(),[sale('1'),sale('2')]);
  const before=await rows('clientes');
  await assert.rejects(save(await batch(),[sale('3')],[client('A',{razon_social:'PISADO'})],[{client_id:'A',lat:-34.6,long:-58.4}],true),/confirmación/i);
  assert.deepEqual(await rows('clientes'),before);
  assert.equal((await rows('client_places')).length,0);
  assert.equal((await rows('ventas_cupra')).length,2);
});
test('agregar conserva comprobantes ausentes; reemplazar exige confirmación y guarda respaldo', async () => {
  await save(await batch(),[sale('1'),sale('2')]);
  await save(await batch(),[sale('3')]);
  assert.equal((await rows('ventas_cupra')).length,3);
  const id=await batch(); await save(id,[sale('4')],[client()],[],true,true);
  assert.equal((await rows('ventas_cupra')).length,1);
  assert.equal((await rows('ventas_cupra_eliminadas')).length,3);
});
test('el mismo lote se aplica una sola vez aunque se reintente con otro contenido', async () => {
  const id=await batch(); const first=await save(id,[sale()]);
  assert.deepEqual(await save(id,[sale('otra')],[client('A',{razon_social:'otra'})]),first);
  assert.equal((await rows('ventas_cupra'))[0].ticket,'1');
});
test('fecha o comprobante ausente produce rollback completo', async () => {
  await assert.rejects(save(await batch(),[sale('')]),/comprobante/);
  assert.equal((await rows('clientes')).length,0);
  await assert.rejects(save(await batch(),[sale('1',{fecha_emision:null})]),/fecha/);
});
test('maestro y ventas conservan correcciones manuales y exclusiones', async () => {
  await save(await batch('maestro'),null,[client('A',{direccion_principal:'Manual 1'})]);
  await db.exec("UPDATE clientes SET excluir_recomendaciones=true, ultima_visita=now();");
  await db.query('SELECT guardar_ubicacion_cliente($1,$2,true)',['A',JSON.stringify({lat:-34.6,long:-58.4,direccion_principal:'Manual 1',barrio_principal:'Palermo'})]);
  await save(await batch('maestro'),null,[client('A',{direccion_principal:'Excel 2'})],[{client_id:'A',lat:-34.7,long:-58.5,direccion_principal:'Excel 2'}]);
  const c=(await rows('clientes'))[0]; const p=(await rows('client_places'))[0];
  assert.equal(c.direccion_principal,'Manual 1'); assert.equal(c.excluir_recomendaciones,true); assert.ok(c.ultima_visita);
  assert.equal(Number(p.lat),-34.6); assert.equal(p.direccion_verificada,true);
});
test('ubicación inválida revierte el maestro entero', async () => {
  await assert.rejects(save(await batch('maestro'),null,[client()],[{client_id:'A',lat:0,long:0}]),/Coordenadas/);
  assert.equal((await rows('clientes')).length,0);
});
test('las métricas usan el histórico completo y se limpian al revertir la última venta', async () => {
  const old=await batch(); await save(old,[sale('1',{fecha_emision:'2025-01-01'})]);
  const recent=await batch(); await save(recent,[sale('2',{fecha_emision:'2026-09-01',facturacion_ars:200})]);
  let c=(await rows('clientes'))[0]; assert.equal(c.ultima_compra.toISOString().slice(0,10),'2026-09-01'); assert.equal(Number(c.monto_total_historico),300);
  await db.query('SELECT revertir_import_ventas($1)',[recent]);
  c=(await rows('clientes'))[0]; assert.equal(c.ultima_compra.toISOString().slice(0,10),'2025-01-01'); assert.equal(Number(c.monto_total_historico),100);
  await db.query('SELECT revertir_import_ventas($1)',[old]);
  c=(await rows('clientes'))[0]; assert.equal(c.ultima_compra,null); assert.equal(Number(c.monto_total_historico),0);
});
test('revertir restaura todos los campos de una venta actualizada', async () => {
  const first=await batch(); await save(first,[sale('1',{correo:'antes@test',direccion:'Antes',marca:'Vieja'})]);
  const second=await batch(); await save(second,[sale('1',{correo:'despues@test',direccion:'Después',marca:'Nueva',facturacion_ars:900})]);
  assert.equal((await rows('ventas_cupra'))[0].import_batch_id,second);
  await db.query('SELECT revertir_import_ventas($1)',[second]);
  const v=(await rows('ventas_cupra'))[0];assert.equal(v.correo,'antes@test');assert.equal(v.direccion,'Antes');assert.equal(v.marca,'Vieja');assert.equal(v.import_batch_id,first);
  await assert.rejects(db.query('SELECT revertir_import_ventas($1)',[second]),/revertido/);
});
test('no se puede revertir una carga debajo de otra posterior del mismo período', async () => {
  const first=await batch(); await save(first,[sale()]);
  await save(await batch(),[sale('2')]);
  await assert.rejects(db.query('SELECT revertir_import_ventas($1)',[first]),/posterior/);
});
test('RPC de importación y borrado no tienen permisos públicos ni de usuarios normales', async () => {
  for (const fn of ['guardar_importacion(uuid,jsonb,jsonb,jsonb,boolean,boolean)','commit_ventas_import_rango(jsonb,uuid,boolean)','rebase_ventas_cupra(jsonb,uuid,text)']) {
    const {rows}=await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS a,has_function_privilege('authenticated',$1,'EXECUTE') AS u",[fn]);
    assert.equal(rows[0].a,false,fn); assert.equal(rows[0].u,false,fn);
  }
});
test('usuario inactivo no puede revertir', async () => {
  const id=await batch();await save(id,[sale()]);await db.exec('UPDATE profiles SET activo=false');
  try { await assert.rejects(db.query('SELECT revertir_import_ventas($1)',[id]),/activo/); }
  finally { await db.exec('UPDATE profiles SET activo=true'); }
});
test('reimportar prospectos preserva coordenadas, conversión y estado del negocio', async () => {
  const p={place_id:'excel-key',import_key:'key',nombre:'Comercio',direccion:'Calle 123',ciudad:'CABA',provincia:'CABA',latitud:0,longitud:0};
  const saveP=async payload => db.query('SELECT guardar_prospectos_import($1,$2,$3)',[await batch('prospectos'),JSON.stringify([payload]),'{}']);
  await saveP(p);await db.exec("UPDATE prospectos SET latitud=-34.6,longitud=-58.4,estado_negocio='CLOSED_PERMANENTLY',es_cliente_cupra=true,telefono='11111111';");
  await saveP({...p,telefono:null});const saved=(await rows('prospectos'))[0];
  assert.equal((await rows('prospectos')).length,1);assert.equal(Number(saved.latitud),-34.6);assert.equal(saved.estado_negocio,'CLOSED_PERMANENTLY');assert.equal(saved.es_cliente_cupra,true);assert.equal(saved.telefono,'11111111');
});
test('la geocodificación inversa no mueve un punto ni pisa el barrio verificado', async () => {
  await save(await batch('maestro'),null,[client()],[{client_id:'A',lat:-34.6,long:-58.4,barrio_principal:'Palermo'}]);
  const p=(await rows('client_places'))[0];await db.query('SELECT completar_barrio_ubicacion($1,$2,$3,$4,$5)',[p.id,-34.6,-58.4,'Otro','Comuna 14']);
  assert.equal((await rows('client_places'))[0].barrio_principal,'Palermo');
  await assert.rejects(db.query('SELECT completar_barrio_ubicacion($1,$2,$3,$4,$5)',[p.id,-34.7,-58.4,'Otro',null]),/cambió/);
});

test('reemplazar solo ventas conserva notas de crédito previamente cargadas', async () => {
  await save(await batch(),[sale(),sale('NC',{tipo_comprobante:'nota_credito',letra:'NC',facturacion_ars:-20})]);
  await save(await batch(),[sale('2')],[client()],[],true,true);
  const ventas=await rows('ventas_cupra');assert.equal(ventas.length,2);assert(ventas.some(v=>v.ticket==='NC'));
});
test('una NC de agosto no amplía el período de reemplazo de las ventas de septiembre', async () => {
  await save(await batch(),[sale('ago',{fecha_emision:'2026-08-02'}),sale('sep')]);
  await save(await batch(),[sale('nueva'),sale('NCago',{fecha_emision:'2026-08-01',tipo_comprobante:'nota_credito',letra:'NC',facturacion_ars:-20})],[client()],[],true,true);
  const ventas=await rows('ventas_cupra');assert(ventas.some(v=>v.ticket==='ago'));assert(ventas.some(v=>v.ticket==='NCago'));assert(!ventas.some(v=>v.ticket==='sep'));
});
