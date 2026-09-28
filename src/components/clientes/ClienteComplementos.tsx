import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const labels: Record<string,string> = { nombre:"Nombre encontrado",direccion:"Dirección encontrada",telefono:"Teléfono encontrado",email:"Email",website:"Sitio web",instagram:"Instagram",barrio:"Barrio",ciudad:"Localidad" };
export function ClienteComplementos({ clientId }: { clientId: string }) {
  const [rows,setRows]=useState<{ prospecto_place_id:string; datos:Record<string,unknown>; fuente:string }[]>([]);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let active=true;
    setRows([]); setError(false);
    supabase.from("clientes_informacion_complementaria").select("prospecto_place_id,datos,fuente").eq("client_id",clientId)
      .then(({data,error})=>{ if(active){setError(Boolean(error));setRows((data||[]).map(r=>({...r,datos:r.datos as Record<string,unknown>})));} });
    return ()=>{active=false;};
  },[clientId]);
  if(error) return <p role="alert" className="text-sm text-destructive">No se pudo cargar la información complementaria.</p>;
  if(!rows.length) return null;
  return <section className="border p-4 space-y-3"><h3 className="font-medium">Información complementaria guardada</h3>
    <p className="text-xs text-muted-foreground">Datos de prospectos revisados y vinculados a este cliente. Los valores diferentes se conservan junto a la ficha original.</p>
    {rows.map(r=><div key={r.prospecto_place_id} className="border-t pt-2 space-y-1"><p className="text-xs text-muted-foreground">Fuente: {r.fuente}</p>
      {Object.entries(labels).filter(([k])=>typeof r.datos[k]==="string"&&r.datos[k]).map(([k,label])=><p key={k} className="text-sm break-words"><span className="font-medium">{label}: </span>{String(r.datos[k])}</p>)}
    </div>)}
  </section>;
}
