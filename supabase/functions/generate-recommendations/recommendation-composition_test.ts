import { strictEqual as eq,ok } from "node:assert/strict";
import { composeRoute,type CompositionCandidate } from "./recommendation-composition.ts";
const point=(id:string,meters:number,client=false,state="ACTIVO"):CompositionCandidate=>({
  client_id:id,es_prospecto:!client,estado_comercial:client?state:"POTENCIAL",lat:-34.58+meters/111320,long:-58.44,prioridad_comercial:client?80:10});
const centro={lat:-34.58,lng:-58.44};
Deno.test("un cliente prioritario y siete vecinos prevalecen sobre cartera dispersa",()=>{
  const clients=[point('referencia',0,true),...Array.from({length:7},(_,i)=>point(`c${i}`,700+i*90,true))];
  const prospects=Array.from({length:7},(_,i)=>point(`p${i}`,10+i*12));
  const r=composeRoute({clients,prospects,preferredIds:clients.map(c=>c.client_id),centro});
  eq(r.ids.length,8);ok(r.ids.includes('referencia'));eq(r.ids.filter(id=>id.startsWith('p')).length,7);
});
Deno.test("misma calle: conserva ocho comercios distintos aunque estén muy próximos",()=>{
  const r=composeRoute({clients:[],prospects:Array.from({length:8},(_,i)=>point(`p${i}`,i*8)),preferredIds:[],centro});
  eq(r.ids.length,8);eq(new Set(r.ids).size,8);
});
Deno.test("una preferencia de IA no impone un salto hacia el candidato lejano",()=>{
  const r=composeRoute({clients:[point('c',0,true)],prospects:[point('lejano',1400),...Array.from({length:7},(_,i)=>point(`p${i}`,20+i*10))],preferredIds:['lejano'],centro});
  ok(!r.ids.includes('lejano'));
});
Deno.test("los estados guían la referencia y los prospectos completan sin cupos",()=>{
  const r=composeRoute({clients:[point('activo',10,true),point('perdido',0,true,'PERDIDO')],prospects:Array.from({length:7},(_,i)=>point(`p${i}`,20+i*10)),estados:new Set(['PERDIDO']),preferredIds:[],centro});
  ok(r.ids.includes('perdido'));ok(!r.ids.includes('activo'));eq(r.fueraDeSeleccion.length,7);
});
Deno.test("no repite ocupados, no admite coordenadas ausentes ni supera 1,5 km",()=>{
  const r=composeRoute({clients:[point('c',0,true)],prospects:[point('ocupado',10),point('lejano',1700),{...point('sin-ubicacion',0),lat:null},point('p',20)],unavailableIds:new Set(['ocupado']),preferredIds:[],centro});
  eq(r.ids.length,2);ok(r.ids.includes('c'));ok(r.ids.includes('p'));
});
Deno.test("ocho clientes cercanos funcionan sin obligar a incluir prospectos",()=>{
  const r=composeRoute({clients:Array.from({length:8},(_,i)=>point(`c${i}`,i*10,true)),prospects:[],preferredIds:[],centro});eq(r.ids.length,8);
});
