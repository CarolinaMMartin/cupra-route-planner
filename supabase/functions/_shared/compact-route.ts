import { distanciaKm, RADIO_RUTA_KM, type Coordenada } from "./ruta.ts";

export const RADIOS_CERCANIA = [0.15, 0.3, 0.6, 1, RADIO_RUTA_KM];
export interface ParadaCercana extends Coordenada { id: string; prioridad?: number; cliente?: boolean }
export function longitudRuta(puntos: Coordenada[]): number {
  return puntos.slice(1).reduce((s,p,i)=>s+distanciaKm(puntos[i],p),0);
}
export function ordenarRecorrido<T extends ParadaCercana>(puntos: T[]): T[] {
  if (puntos.length < 2) return [...puntos];
  let mejor: T[] = [], longitud = Infinity;
  for (const inicio of puntos) {
    const ruta=[inicio], resto=puntos.filter(p=>p.id!==inicio.id);
    while(resto.length) {
      resto.sort((a,b)=>distanciaKm(ruta[ruta.length-1],a)-distanciaKm(ruta[ruta.length-1],b)||a.id.localeCompare(b.id));
      ruta.push(resto.shift()!);
    }
    // Dos intercambios evitan cruces sin alterar el conjunto de visitas.
    for(let pass=0;pass<2;pass++) for(let i=0;i<ruta.length-2;i++) for(let j=i+2;j<ruta.length;j++) {
      const alternativa=[...ruta.slice(0,i),...ruta.slice(i,j+1).reverse(),...ruta.slice(j+1)];
      if(longitudRuta(alternativa)+0.000001<longitudRuta(ruta)) ruta.splice(0,ruta.length,...alternativa);
    }
    const km=longitudRuta(ruta);
    if(km<longitud) { mejor=ruta;longitud=km; }
  }
  return mejor;
}

export function seleccionarCercanos<T extends ParadaCercana>(centro: Coordenada, candidatos: T[], fijos: T[] = [], limite=8): T[] {
  if(fijos.length>limite || fijos.some(p=>distanciaKm(centro,p)>RADIO_RUTA_KM)) throw new Error("La selección fija supera el límite de la ruta");
  const pool=[...new Map(candidatos.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&distanciaKm(centro,p)<=RADIO_RUTA_KM).map(p=>[p.id,p])).values()];
  const elegidos=[...new Map(fijos.map(p=>[p.id,p])).values()];
  const ids=new Set(elegidos.map(p=>p.id));
  const radio=RADIOS_CERCANIA.find(r=>pool.filter(p=>!ids.has(p.id)&&distanciaKm(centro,p)<=r).length+elegidos.length>=limite)??RADIO_RUTA_KM;
  const resto=pool.filter(p=>!ids.has(p.id)&&distanciaKm(centro,p)<=radio);
  while(elegidos.length<limite && resto.length) {
    const costo=(p:T)=>elegidos.length ? Math.min(...elegidos.map(q=>distanciaKm(p,q))) : distanciaKm(centro,p);
    resto.sort((a,b)=>Math.round(costo(a)*1000)-Math.round(costo(b)*1000)
      || (b.prioridad??0)-(a.prioridad??0) || Number(Boolean(b.cliente))-Number(Boolean(a.cliente)) || a.id.localeCompare(b.id));
    elegidos.push(resto.shift()!);
  }
  return ordenarRecorrido(elegidos);
}

export interface Caminata {
  orden: string[]; metros: number | null; minutos: number | null;
  avisos: string[]; atribucion: string; verificada: boolean;
}
