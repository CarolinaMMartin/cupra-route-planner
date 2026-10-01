import { authorize,corsHeaders,failure,json,RequestError } from "../_shared/location-service.ts";
import type { ParadaCercana } from "../_shared/compact-route.ts";
import { calcularCaminata } from "../_shared/walking-route.ts";
import { coordenadaMapaValida } from "../_shared/map-selection.ts";

export async function handler(req:Request) {
  if(req.method==="OPTIONS")return new Response(null,{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try {
    const {db}=await authorize(req,true);
    const body=await req.json();
    if(!Array.isArray(body.puntos)||body.puntos.length!==8||new Set(body.puntos).size!==8
      ||body.puntos.some((p:unknown)=>typeof p!=="string"||!/^[CP]:.{1,250}$/.test(p)))throw new RequestError("Seleccioná ocho visitas únicas",400,"INVALID_ROUTE");
    const clientIds=body.puntos.filter((p:string)=>p.startsWith("C:")).map((p:string)=>p.slice(2));
    const prospectIds=body.puntos.filter((p:string)=>p.startsWith("P:")).map((p:string)=>p.slice(2));
    const [lugares,prospectos]=await Promise.all([
      clientIds.length?db.from("client_places").select("id,client_id,lat,long,is_primary,direccion_verificada").in("client_id",clientIds).order("is_primary",{ascending:false}).order("direccion_verificada",{ascending:false}).order("id"):Promise.resolve({data:[],error:null}),
      prospectIds.length?db.from("prospectos").select("place_id,latitud,longitud").in("place_id",prospectIds):Promise.resolve({data:[],error:null})]);
    if(lugares.error||prospectos.error)throw new Error("No se pudieron cargar las ubicaciones");
    const puntos: ParadaCercana[]=body.puntos.map((id:string)=>{
      if(id.startsWith("C:")) {
        const p=lugares.data?.find(p=>p.client_id===id.slice(2));
        return {id,lat:Number(p?.lat??NaN),lng:Number(p?.long??NaN)};
      }
      const p=prospectos.data?.find(p=>p.place_id===id.slice(2));
      return {id,lat:Number(p?.latitud??NaN),lng:Number(p?.longitud??NaN)};
    });
    if(puntos.some(p=>!coordenadaMapaValida(p)))throw new RequestError("Hay ubicaciones incompletas",422,"INVALID_LOCATION");
    return json(await calcularCaminata(puntos));
  }catch(e){return failure(e);}
}
if(import.meta.main)Deno.serve(handler);
