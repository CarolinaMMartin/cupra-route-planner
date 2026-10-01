import { seleccionarCercanos } from "../_shared/compact-route.ts";
import { distanciaKm, type Coordenada } from "../_shared/ruta.ts";
export interface CompositionCandidate {
  client_id: string; es_prospecto: boolean; estado_comercial: string;
  lat: number | null; long: number | null; prioridad_comercial?: number; score_total?: number;
}
interface CompositionInput<T extends CompositionCandidate> {
  preferredIds: string[]; clients: T[]; prospects: T[];
  unavailableIds?: ReadonlySet<string>; limit?: number; estados?: ReadonlySet<string>;
  permitirOtrosEstados?: boolean; centro?: Coordenada;
}
export interface CompositionResult { ids: string[]; fueraDeSeleccion: string[] }
export function composeRoute<T extends CompositionCandidate>({clients,prospects,unavailableIds=new Set<string>(),limit=8,
  estados=new Set<string>(),permitirOtrosEstados=false,centro}: CompositionInput<T>): CompositionResult {
  const elegido=(c:T)=>!estados.size || estados.has(c.es_prospecto?"POTENCIAL":c.estado_comercial);
  const valida=(c:T)=>c.lat!=null&&c.long!=null&&Number.isFinite(c.lat)&&Number.isFinite(c.long);
  const cartera=clients.filter(c=>valida(c)&&!unavailableIds.has(c.client_id)&&(elegido(c)||permitirOtrosEstados));
  const candidatas=[...cartera,...prospects.filter(c=>valida(c)&&!unavailableIds.has(c.client_id))];
  if(!candidatas.length) return {ids:[],fueraDeSeleccion:[]};
  const h=centro??{lat:candidatas[0].lat!,lng:candidatas[0].long!};
  const referencia=[...cartera].sort((a,b)=>
    Number(distanciaKm(h,{lat:b.lat!,lng:b.long!})<0.001)-Number(distanciaKm(h,{lat:a.lat!,lng:a.long!})<0.001)
    || Number(elegido(b))-Number(elegido(a)) || (b.prioridad_comercial??b.score_total??0)-(a.prioridad_comercial??a.score_total??0)
    || a.client_id.localeCompare(b.client_id))[0];
  const punto=(c:T)=>({id:c.client_id,lat:c.lat!,lng:c.long!,prioridad:c.prioridad_comercial??0,cliente:!c.es_prospecto});
  const ids=seleccionarCercanos(h,candidatas.map(punto),referencia?[punto(referencia)]:[],limit).map(p=>p.id);
  return {ids,fueraDeSeleccion:ids.filter(id=>!elegido(candidatas.find(c=>c.client_id===id)!))};
}
export function composeRecommendationIds<T extends CompositionCandidate>(input:CompositionInput<T>):string[] {return composeRoute(input).ids;}
