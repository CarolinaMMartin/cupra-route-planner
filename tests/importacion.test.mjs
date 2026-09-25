import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseImportWorkbook } from '../src/lib/excelImport.ts';
import { currencyNumber, coordinateNumber, importDate, joinStreet } from '../supabase/functions/_shared/import-values.ts';
import { preciseArgentinaResult, locationFields } from '../supabase/functions/_shared/geocoding-values.ts';
import { allClients, beginImport } from '../supabase/functions/_shared/import-batch.ts';
const workbook = (entries, date1904=false) => {
  const book=XLSX.utils.book_new();
  for (const [name, rows] of entries) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);
  book.Workbook={WBProps:{date1904}};
  return XLSX.write(book,{type:'array',bookType:'xlsx'});
};
const header=['Ticket','Fecha Emisión','Razón Social','Precio Total Final','CUIT / DNI'];
test('detecta encabezados por contenido y conserva números físicos de fila con blancos y títulos', () => {
  const {sheets}=parseImportWorkbook(workbook([['Ventas',[['Informe de ventas','CUPRA','Septiembre'],[],[],header,['A',46266,'Comercio',1234,'30111111118']]]]));
  assert.equal(sheets[0].headerRow,4);assert.equal(sheets[0].rows[0].__fila_excel,5);assert.equal(sheets[0].rows[0].Ticket,'A');
});
test('no ignora en silencio hojas reconocidas ni inventa ventas de una hoja cualquiera', () => {
  const {sheets,ignored}=parseImportWorkbook(workbook([['Enero',[header,['1','01/01/2026','A',10,'1']]],['Febrero',[header,['2','01/02/2026','A',20,'1']]],['Notas de crédito',[header,['NC','01/02/2026','A',5,'1']]],['Resumen',[['Mes','Neto','IVA'],['Feb',100,21]]]]));
  assert.equal(sheets.length,3);assert.equal(sheets[2].kind,'notas');assert.deepEqual(ignored,['Resumen']);
  assert.throws(()=>parseImportWorkbook(workbook([['Otra',[['A','B','C'],[1,2,3]]]])),/No se reconoció/);
});
test('prospectos con GPS siguen siendo prospectos', () => {
  const {sheets}=parseImportWorkbook(workbook([['Prospectos',[['Cliente','Dir. Entrega','Latitud','Longitud'],['Negocio','Calle 100',-34.6,-58.4]]]]));
  assert.equal(sheets[0].kind,'prospectos');assert.equal(sheets[0].rows[0].Latitud,-34.6);
});
test('encabezados duplicados se rechazan antes de pisar columnas', () => {
  assert.throws(()=>parseImportWorkbook(workbook([['Ventas',[[...header,'precio total final'],['1','01/01/2026','A',1,'1',2]]]])),/duplicados/);
});
test('Excel con calendario 1904 se convierte con el calendario correcto', () => {
  const {sheets}=parseImportWorkbook(workbook([['Ventas',[header,['A',1,'A',12,'1']]]],true));
  assert.equal(sheets[0].rows[0]['Fecha Emisión'],'1904-01-02');
});
test('importes argentinos, negativos contables, valores numéricos y coordenadas decimales', () => {
  for (const [value,want] of [['$ 1.234,56',1234.56],['1.234',1234],['(1.234,56)',-1234.56],['1234.56',1234.56],[1234.567,1234.567],['1,234.56',1234.56],['sin dato',null],['',null]]) assert.equal(currencyNumber(value),want,String(value));
  assert.equal(coordinateNumber('-34,603712'),-34.603712);assert.equal(coordinateNumber(null),null);assert.equal(coordinateNumber('1.234.567'),null);
});
test('fechas inválidas no se convierten silenciosamente en el mes siguiente', () => {
  assert.equal(importDate('31/02/2026'),null);assert.equal(importDate('29/02/2025'),null);assert.equal(importDate('29/02/2024'),'2024-02-29');
  assert.equal(importDate('2026-13-01'),null);assert.equal(importDate(60),null);assert.equal(importDate(61),'1900-03-01');
});
test('altura de calle literal no se evalúa como expresión regular', () => {
  assert.equal(joinStreet('Calle','12('),'Calle 12(');assert.equal(joinStreet('Calle 120','120'),'Calle 120');
});
const precise={geometry:{location:{lat:-34.6,lng:-58.4},location_type:'ROOFTOP'},types:['street_address'],formatted_address:'Calle 100, Argentina',address_components:[{long_name:'Argentina',short_name:'AR',types:['country']},{long_name:'100',types:['street_number']},{long_name:'Palermo',types:['sublocality_level_1']}]};
test('geocodificación exige puerta precisa en Argentina y rechaza coincidencias parciales', () => {
  assert.equal(preciseArgentinaResult(precise,true),true);
  assert.equal(preciseArgentinaResult({...precise,partial_match:true},true),false);
  assert.equal(preciseArgentinaResult({...precise,geometry:{...precise.geometry,location_type:'APPROXIMATE'}},true),false);
  assert.equal(preciseArgentinaResult({...precise,types:['locality']},true),false);
  assert.equal(preciseArgentinaResult({...precise,address_components:[{long_name:'Uruguay',short_name:'UY',types:['country']}]},false),false);
});
test('Buenos Aires no se inventa como barrio y una comuna no se presenta como barrio', () => {
  assert.equal(locationFields(precise).barrio,'Palermo');
  assert.equal(locationFields({...precise,address_components:[{long_name:'Buenos Aires',types:['locality']},{long_name:'Comuna 14',types:['administrative_area_level_2']}]}).barrio,null);
});
test('la conciliación lee más de 1.000 clientes y propaga errores de lectura', async () => {
  const clients=Array.from({length:1234},(_,i)=>({client_id:String(i)}));let pages=0;
  const db={from(){return {select(){return this},order(){return this},async range(a,b){pages++;return {data:clients.slice(a,b+1),error:null}}}}};
  assert.equal((await allClients(db)).length,1234);assert.equal(pages,3);
  const broken={from(){return {select(){return this},order(){return this},async range(){return {error:{message:'sin conexión'}}}}}};
  await assert.rejects(allClients(broken),/sin conexión/);
});
test('reintento recibe el resultado confirmado sin volver a importar', async () => {
  const response={success:true,batch_id:'same'};
  const record={usuario_id:'u',tipo:'ventas',archivo_sha256:'hash'};
  const db={from(){return {async insert(){return {error:{code:'23505'}}},select(){return this},eq(){return this},async single(){return {data:{...record,respuesta:response}}}}}};
  const r=await beginImport(db,'11111111-1111-4111-8111-111111111111',record);assert.deepEqual(r.response,response);
});

const { getGoogleMapsUrl } = await import('../src/lib/googleMapsLinks.ts');
test('los enlaces de Google nunca envían IDs internos de Excel ni coordenadas 0,0', () => {
  const saved = new URL(getGoogleMapsUrl('excel-123',-34.6,-58.4));
  assert.equal(saved.searchParams.get('query'),'-34.6,-58.4');assert.equal(saved.searchParams.has('query_place_id'),false);
  const pending = new URL(getGoogleMapsUrl('excel-123',0,0,'Calle 100, CABA, Argentina'));
  assert.equal(pending.searchParams.get('query'),'Calle 100, CABA, Argentina');assert.equal(pending.searchParams.has('query_place_id'),false);
  assert.equal(getGoogleMapsUrl('manual-abc',0,0),null);
  const real = new URL(getGoogleMapsUrl('ChIJ&x=1'));
  assert.equal(real.searchParams.get('query_place_id'),'ChIJ&x=1');assert.equal(real.searchParams.has('x'),false);
});
