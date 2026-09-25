import { strictEqual as igual } from "node:assert/strict";
import { errorRuta } from "../_shared/ruta.ts";
const centro = {lat:-34.5,lng:-58.5};
const ruta = () => Array.from({length:8},(_,i)=>({id:String(i),...centro,lat:centro.lat+i*0.001}));
Deno.test("contrato de respuesta: exactamente ocho, únicos, con centro y radio estricto",()=>{
  igual(errorRuta(ruta(),centro),null);
  igual(errorRuta(ruta().slice(1),centro),"La ruta debe tener 8 visitas.");
  igual(errorRuta([...ruta(),{id:'extra',...centro}],centro),"La ruta debe tener 8 visitas.");
  const duplicada=ruta();duplicada[7].id=duplicada[0].id;
  igual(errorRuta(duplicada,centro),"La ruta contiene destinos repetidos.");
  igual(errorRuta(ruta(),null),"Falta el centro de la ruta.");
  const borde=ruta();borde[7].lat=centro.lat+1.499/6371*180/Math.PI;
  igual(errorRuta(borde,centro),null);
  borde[7].lat=centro.lat+1.501/6371*180/Math.PI;
  igual(errorRuta(borde,centro),"Hay destinos fuera del radio máximo de 1,5 km.");
});
