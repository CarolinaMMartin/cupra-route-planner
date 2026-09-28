import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssignmentDraftStore} from '../src/lib/assignmentDrafts.ts';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),values};};
test('borrador se guarda sin esperar un efecto y se recupera tras recargar',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage);a.set('mapa:pilar','seleccion',['c1','c2','c3','c4'],[]);
 const reloaded=new AssignmentDraftStore('user',storage);assert.deepEqual(reloaded.get('mapa:pilar','seleccion',[]),['c1','c2','c3','c4']);
});
test('borradores separados por cuenta, modo y vendedor',()=>{
 const storage=memory(),a=new AssignmentDraftStore('ana',storage),b=new AssignmentDraftStore('beatriz',storage);
 a.set('mapa:pilar','seleccion',['c1'],[]);a.set('mapa:micaela','seleccion',['m1'],[]);a.set('manual','seleccion',['x'],[]);
 assert.deepEqual(a.get('mapa:pilar','seleccion',[]),['c1']);assert.deepEqual(a.get('mapa:micaela','seleccion',[]),['m1']);assert.deepEqual(b.get('mapa:pilar','seleccion',[]),[]);
});
test('selecciones Set y filtros sobreviven a serialización',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage);a.set('manual','selectedRows',new Set(['a','b']),new Set());a.set('manual','filtros',{rubro:['Hotel'],estado:['ACTIVO']},{});
 const b=new AssignmentDraftStore('user',storage);assert.deepEqual(b.get('manual','selectedRows',new Set()),new Set(['a','b']));assert.deepEqual(b.get('manual','filtros',{}),{rubro:['Hotel'],estado:['ACTIVO']});
});
test('dos pestañas editan campos diferentes sin pisar la selección',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage),b=new AssignmentDraftStore('user',storage);
 a.set('mapa:pilar','seleccion',['c1'],[]);b.get('mapa:pilar','seleccion',[]);
 a.set('mapa:pilar','seleccion',['c1','c2'],[]);b.set('mapa:pilar','zona','Palermo','todas');
 a.acceptExternal(a.prefix+'mapa:pilar');assert.deepEqual(a.get('mapa:pilar','seleccion',[]),['c1','c2']);assert.equal(a.get('mapa:pilar','zona','todas'),'Palermo');
});
test('eventos atrasados consultan el valor vigente y no revierten la última selección',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage),b=new AssignmentDraftStore('user',storage);
 a.set('ruta','ids',['1'],[]);b.acceptExternal(b.prefix+'ruta');a.set('ruta','ids',['1','2'],[]);b.acceptExternal(b.prefix+'ruta');b.acceptExternal(b.prefix+'ruta');
 assert.deepEqual(b.get('ruta','ids',[]),['1','2']);
});
test('fallo de almacenamiento conserva memoria y permite guardar al reintentar',()=>{
 const storage=memory();let blocked=true;const a=new AssignmentDraftStore('user',{getItem:storage.getItem,setItem:(k,v)=>{if(blocked)throw Error('Quota');storage.setItem(k,v);}});
 a.set('ruta','ids',['1','2'],[]);assert.equal(a.hasUnsaved(),true);assert.match(a.status(),/No se pudo guardar/);assert.deepEqual(a.get('ruta','ids',[]),['1','2']);
 blocked=false;a.retry();assert.equal(a.hasUnsaved(),false);assert.equal(a.status(),null);assert.deepEqual(new AssignmentDraftStore('user',storage).get('ruta','ids',[]),['1','2']);
});
test('confirmar o descartar no hace reaparecer una selección vieja en otra pestaña',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage),b=new AssignmentDraftStore('user',storage);
 a.set('ruta','ids',['1','2'],[]);b.get('ruta','ids',[]);a.clear('ruta');b.acceptExternal(b.prefix+'ruta');assert.deepEqual(b.get('ruta','ids',[]),[]);
});
test('volver desde otra pantalla recupera cambios hechos en otra pestaña',()=>{
 const storage=memory(),a=new AssignmentDraftStore('user',storage),b=new AssignmentDraftStore('user',storage);
 a.set('ruta','ids',['1'],[]);b.set('ruta','ids',['1','2'],[]);a.refresh();assert.deepEqual(a.get('ruta','ids',[]),['1','2']);
});
test('borrador ilegible avisa y no rompe la aplicación',()=>{
 const storage=memory();storage.setItem('cupra:assignments:v1:user:ruta','{roto');const a=new AssignmentDraftStore('user',storage);
 assert.deepEqual(a.get('ruta','ids',[]),[]);assert.match(a.status(),/recuperar/);a.set('ruta','ids',['nueva'],[]);assert.equal(a.status(),null);
});
