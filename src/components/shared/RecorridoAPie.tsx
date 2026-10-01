import { useRef,useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { Caminata } from "../../../supabase/functions/_shared/compact-route";

export function RecorridoAPie({puntos,onOrden}:{puntos:{key:string;nombre:string}[];onOrden?:(ids:string[])=>void}) {
  const [resultado,setResultado]=useState<{clave:string;data:Caminata}|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const clave=puntos.map(p=>p.key).sort().join("|");const vigente=useRef(clave);vigente.current=clave;
  const data=resultado?.clave===clave?resultado.data:null;
  const calcular=async()=>{
    setBusy(true);setError("");
    try {
      const {data,error}=await supabase.functions.invoke<Caminata>("walking-route",{body:{puntos:puntos.map(p=>p.key)}});
      if(vigente.current!==clave)return;
      if(error||!data)throw new Error("No se pudo medir la caminata. Reintentá.");
      setResultado({clave,data});onOrden?.(data.orden);
    }catch(e){if(vigente.current===clave)setError(e instanceof Error?e.message:"No se pudo calcular");}
    finally{setBusy(false);}
  };
  if(puntos.length!==8)return null;
  return <div className="space-y-2 text-sm">
    <Button variant="outline" className="w-full" onClick={calcular} disabled={busy}>{busy?"Midiendo recorrido...":"Calcular recorrido a pie"}</Button>
    {error&&<p role="alert">{error}</p>}
    {data&&<><p>{data.verificada?`${(data.metros!/1000).toFixed(2)} km · ${data.minutos} min caminando, sin contar las visitas.`:"Distancia por calles pendiente de verificar."}</p>
      {data.avisos.map((a,i)=><p key={i} className="text-xs text-muted-foreground">{a}</p>)}
      {data.atribucion&&<p className="text-xs text-muted-foreground">{data.atribucion}</p>}
      <ol className="list-decimal pl-5">{data.orden.map(id=><li key={id}>{puntos.find(p=>p.key===id)?.nombre}</li>)}</ol></>}
  </div>;
}
