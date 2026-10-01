import { strict as assert } from "node:assert";
import { calcularCaminata } from "../_shared/walking-route.ts";

const puntos=Array.from({length:8},(_,i)=>({id:`P:${i}`,lat:-34.6,lng:-58.4+i*0.0001}));
Deno.test("caminata: suma tramos reales, conserva ocho paradas y muestra avisos del proveedor",async()=>{
  const fetchOriginal=globalThis.fetch,key=Deno.env.get("GOOGLE_MAPS_API_KEY");
  Deno.env.set("GOOGLE_MAPS_API_KEY","test");
  globalThis.fetch=async(input)=>{
    const url=new URL(String(input));assert.equal(url.searchParams.get("mode"),"walking");
    assert.equal(url.searchParams.get("waypoints")?.split("|").length,6);
    return Response.json({status:"OK",routes:[{legs:Array.from({length:7},()=>({distance:{value:110},duration:{value:90}})),warnings:["<b>Precaución</b> al cruzar"],copyrights:"Google Maps"}]});
  };
  try {
    const r=await calcularCaminata(puntos);assert.equal(r.verificada,true);assert.equal(r.metros,770);assert.equal(r.minutos,11);
    assert.equal(new Set(r.orden).size,8);assert.deepEqual(r.avisos,["Precaución al cruzar"]);assert.equal(r.atribucion,"Google Maps");
  }finally{globalThis.fetch=fetchOriginal;if(key===undefined)Deno.env.delete("GOOGLE_MAPS_API_KEY");else Deno.env.set("GOOGLE_MAPS_API_KEY",key);}
});
Deno.test("caminata: sin datos del proveedor no inventa kilómetros ni minutos",async()=>{
  const fetchOriginal=globalThis.fetch,key=Deno.env.get("GOOGLE_MAPS_API_KEY");
  Deno.env.set("GOOGLE_MAPS_API_KEY","test");globalThis.fetch=async()=>Response.json({status:"ZERO_RESULTS",routes:[]});
  try {
    const r=await calcularCaminata(puntos);assert.equal(r.verificada,false);assert.equal(r.metros,null);assert.equal(r.minutos,null);
    assert.equal(new Set(r.orden).size,8);assert.match(r.avisos[0],/el radio no es la distancia total/);
  }finally{globalThis.fetch=fetchOriginal;if(key===undefined)Deno.env.delete("GOOGLE_MAPS_API_KEY");else Deno.env.set("GOOGLE_MAPS_API_KEY",key);}
});
