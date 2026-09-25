import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { fetchAllRows } from "@/lib/supabaseQuery";

type Filtros = { client_ids?: string[]; vendedor?: string; desde?: string; hasta?: string };
interface Grupo { nombre: string; neto: number }
interface Metricas {
  filas: number; clientes: number; comprobantes: number; neto: number; ventas: number; notas_credito: number;
  desde: string | null; hasta: string | null; sin_fecha: number; sin_cliente: number;
  rubros: Grupo[]; vendedores: Grupo[]; productos: Grupo[];
  meses: { mes: string; neto: number; filas: number }[];
}
interface Resultado { metricas: Metricas; analisis: string | null; modo: string; aviso?: string }
const moneda = (n: number) => Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export default function AnalisisVentas({ filtros }: { filtros: Filtros }) {
  const [lotes, setLotes] = useState<{ id: string; archivo_nombre: string | null }[]>([]);
  const [lote, setLote] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const clave = JSON.stringify({ ...filtros, lote_id: lote || undefined });
  const actual = useRef(clave); actual.current = clave;
  const pedido = useRef(0);
  useEffect(() => { setResultado(null); setError(null); }, [clave]);
  useEffect(() => {
    let activo = true;
    fetchAllRows((from,to) => supabase.from("import_batches").select("id, archivo_nombre")
      .eq("tipo","ventas").in("estado",["completado","completado_con_errores"])
      .is("revertido_at",null).order("created_at",{ascending:false}).order("id").range(from,to))
      .then(rows => { if(activo) setLotes(rows); })
      .catch(() => { if(activo) setError("No se pudo cargar la lista de archivos."); });
    return () => { activo = false; pedido.current++; };
  }, []);
  const analizar = async () => {
    const id = ++pedido.current, alcance = clave;
    setCargando(true); setError(null);
    try {
      const { data, error: fallo } = await supabase.functions.invoke("analyze-sales", { body: { filtros: JSON.parse(alcance) } });
      if (fallo) { const detalle = await fallo.context?.json?.().catch(() => null); throw new Error(detalle?.error || "No se pudo completar el análisis. Reintentá."); }
      if (data?.error) throw new Error(data.error);
      if (actual.current === alcance && pedido.current === id) setResultado(data as Resultado);
    } catch(e) { if(actual.current === alcance) setError(e instanceof Error ? e.message : "Error de análisis"); }
    finally { if(pedido.current === id) setCargando(false); }
  };
  const m = resultado?.metricas;
  return <section className="space-y-5 rounded-lg border p-4 sm:p-6" aria-label="Análisis de ventas">
    <div><h2 className="text-lg font-semibold">Análisis de ventas con IA</h2>
      <p className="text-sm text-muted-foreground">Procesa todas las filas importadas del archivo elegido. Se aplican los filtros de esta pantalla; la IA interpreta las métricas calculadas.</p></div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1"><Label htmlFor="archivo-analisis">Archivo de ventas</Label>
        <select id="archivo-analisis" value={lote} onChange={e=>setLote(e.target.value)} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
          <option value="">Todas las ventas importadas</option>{lotes.map(l=><option key={l.id} value={l.id}>{l.archivo_nombre || l.id}</option>)}
        </select></div>
      <Button onClick={analizar} disabled={cargando} className="gap-2">{cargando?<Loader2 className="h-4 w-4 animate-spin"/>:<Sparkles className="h-4 w-4"/>}{cargando?"Analizando…":"Analizar ventas"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {resultado?.aviso && <p role="status" className="text-sm text-muted-foreground">{resultado.aviso}</p>}
    {m && <>
      <p className="text-sm">{m.filas.toLocaleString("es-AR")} filas · {m.clientes} clientes · {m.desde || "Sin fecha"} a {m.hasta || "Sin fecha"}</p>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 border-y py-4">{[["Venta neta",moneda(m.neto)],["Ventas",moneda(m.ventas)],["Notas de crédito",moneda(m.notas_credito)],["Comprobantes",m.comprobantes]].map(([k,v])=><div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>)}</dl>
      {(m.sin_fecha>0 || m.sin_cliente>0) && <p className="text-sm text-amber-600">Calidad de datos: {m.sin_fecha} filas sin fecha y {m.sin_cliente} sin cliente identificado.</p>}
      {resultado.analisis && <div className="whitespace-pre-wrap text-sm leading-relaxed">{resultado.analisis}</div>}
      <div className="grid gap-6 md:grid-cols-2">{[["Ventas por rubro",m.rubros],["Ventas por vendedor",m.vendedores]] .map(([titulo,filas])=><div key={String(titulo)}><h3 className="font-medium mb-2">{String(titulo)}</h3><div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-muted-foreground"><th className="text-left py-2">Segmento</th><th className="text-right">Venta neta</th></tr></thead><tbody>{(filas as Grupo[]).map(g=><tr key={g.nombre} className="border-b"><td className="py-2">{g.nombre}</td><td className="text-right whitespace-nowrap">{moneda(g.neto)}</td></tr>)}</tbody></table></div></div>)}</div>
    </>}
  </section>;
}
