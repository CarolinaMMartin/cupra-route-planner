import { strictEqual as eq, ok } from 'node:assert/strict';
import { createIdentityMatcher, phoneKey, type IdentityContext, type IdentityProspect } from '../_shared/prospect-identity.ts';
const prospect:IdentityProspect={place_id:'p',nombre:'Hotel Central',telefono:'+54 9 11 5555 1234',direccion:'Av. Santa Fe 100, CABA',ciudad:'CABA',latitud:-34.58,longitud:-58.44,huella:'p1'};
const ctx=():IdentityContext=>({clientes:[{client_id:'c',razon_social:'Servicios del Sur',telefonos:['0111555551234'],direccion_principal:'Avenida Santa Fe 100',ciudad_principal:'CABA',huella:'c1'}],lugares:[],prospectos:[prospect],decisiones:[]});
Deno.test('identidad: compara teléfono argentino y dirección aunque el cliente no tenga coordenadas',()=>{
  const matches=createIdentityMatcher(ctx()).matches(prospect);eq(matches.length,1);ok(matches[0].motivos.includes('Mismo teléfono'));ok(matches[0].motivos.includes('Misma dirección'));eq(matches[0].nivel,'posible');
});
Deno.test('identidad: la cercanía sola exige revisión, nunca unificación automática',()=>{
  const context=ctx();context.clientes[0].telefonos=[];context.clientes[0].direccion_principal='Otra 222';context.lugares=[{client_id:'c',lat:-34.58,long:-58.44}];
  const matches=createIdentityMatcher(context).matches(prospect);eq(matches.length,1);eq(matches[0].nivel,'posible');eq(matches[0].motivos.length,1);
});
Deno.test('identidad: compara todas las sucursales y conserva coincidencias múltiples para revisión',()=>{
  const context=ctx();context.clientes.push({...context.clientes[0],client_id:'c2'});context.lugares=[{client_id:'c',lat:-34.9,long:-58.6},{client_id:'c',lat:-34.58,long:-58.44}];
  const matches=createIdentityMatcher(context).matches(prospect);eq(matches.length,2);eq(matches.find(c=>c.client_id==='c')?.distancia_m,0);
});
Deno.test('identidad: una decisión de negocios distintos persiste hasta que cambia alguno de los datos',()=>{
  const context=ctx();context.decisiones=[{prospecto_place_id:'p',client_id:'c',decision:'distinto',prospecto_huella:'p1',cliente_huella:'c1'}];
  eq(createIdentityMatcher(context).matches(prospect).length,0);eq(createIdentityMatcher(context).matches(prospect,true).length,1);
  eq(createIdentityMatcher(context).matches({...prospect,huella:'p2'}).length,1);
});
Deno.test('identidad: no confunde teléfonos cortos ni una dirección en otra ciudad sin coordenadas',()=>{
  eq(phoneKey('123'), '');const context=ctx();context.clientes[0].telefonos=['22355551234'];context.clientes[0].ciudad_principal='Mar del Plata';
  eq(createIdentityMatcher(context).matches({...prospect,latitud:null,longitud:null}).length,0);
});
Deno.test('identidad: revisa nombres distintivos parciales y teléfonos encontrados aunque difieran del guardado',()=>{
  const context=ctx();context.clientes[0].telefonos=['1133334444'];context.clientes[0].direccion_principal=null;
  const matcher=createIdentityMatcher(context);eq(matcher.matches(prospect).length,0);
  eq(matcher.matches({...prospect,informacion_encontrada:{telefono:'1133334444'}}).length,1);
  context.clientes[0].fantasia='MASIS';context.lugares=[{client_id:'c',lat:-34.582,long:-58.44}];
  ok(createIdentityMatcher(context).matches({...prospect,nombre:'MASIS KINI LITZ'}).some(c=>c.motivos.includes('Nombre similar y ubicación cercana')));
});
