import { googleMapsFetch } from "./google-maps.ts";
import { ordenarRecorrido, type ParadaCercana } from "./compact-route.ts";

import type { Caminata } from "./compact-route.ts";
export async function calcularCaminata(puntos: ParadaCercana[]): Promise<Caminata> {
  const ruta=ordenarRecorrido(puntos);
  const base:Caminata={orden:ruta.map(p=>p.id),metros:null,minutos:null,avisos:[],atribucion:"",verificada:false};
  if(ruta.length<2) return base;
  const coord=(p:ParadaCercana)=>`${p.lat},${p.lng}`;
  const params=new URLSearchParams({origin:coord(ruta[0]),destination:coord(ruta[ruta.length-1]),
    mode:"walking",language:"es",region:"ar"});
  if(ruta.length>2)params.set("waypoints",ruta.slice(1,-1).map(coord).join("|"));
  try {
    const response=await googleMapsFetch(`/maps/api/directions/json?${params}`,{signal:AbortSignal.timeout(10_000)});
    const data=await response.json();const r=data.routes?.[0];
    if(!response.ok || data.status!=="OK" || r?.legs?.length!==ruta.length-1
      || r.legs.some((l:{distance?:{value:number};duration?:{value:number}})=>!Number.isFinite(l.distance?.value)||!Number.isFinite(l.duration?.value))) throw new Error("Sin recorrido peatonal");
    return {...base,verificada:true,metros:r.legs.reduce((s:number,l:{distance:{value:number}})=>s+l.distance.value,0),
      minutos:Math.ceil(r.legs.reduce((s:number,l:{duration:{value:number}})=>s+l.duration.value,0)/60),
      avisos:Array.isArray(r.warnings)?r.warnings.map((s:unknown)=>String(s).replace(/<[^>]*>/g,"")):[],atribucion:r.copyrights||"Google Maps"};
  } catch {
    return {...base,avisos:["No se pudo medir el recorrido por calles. Reintentá o revisalo en Google Maps; el radio no es la distancia total a pie."]};
  }
}
