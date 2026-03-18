import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X, Eye, MapPin, AlertTriangle, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import cupraLogo from "@/assets/cupra-logo-new.png";

type Step = "upload" | "preview" | "processing" | "done";

interface ProcessResults {
  ventas_procesadas: number;
  ventas_errores: number;
  clientes_actualizados: number;
  clientes_errores: number;
  errores: string[];
}

interface QualityReport {
  pct_sin_barrio: number;
  pct_sin_vendedor: number;
  pct_sin_client_id: number;
  clientes_sin_barrio: number;
  clientes_sin_vendedor: number;
  alerta: boolean;
}

interface VendedorBreakdown {
  vendedor: string;
  monto: number;
  registros: number;
}

interface Reconciliacion {
  filas_excel: number;
  filas_procesadas: number;
  filas_deduplicadas: number;
  filas_descartadas_sin_id: number;
  facturacion_total_procesada: number;
  tickets_unicos: number;
  clientes_unicos: number;
  tickets_compartidos: number;
  vendedor_breakdown?: VendedorBreakdown[];
}

interface ETLMetadata {
  fecha_carga: string;
  version_etl: string;
  columna_facturacion: string | null;
  columnas_evaluadas: string[];
  filas_origen: number;
  filas_facturacion_null: number;
}

interface Integridad {
  descartados_sin_client_id: { cuit_dni: string | null; razon_social: string | null }[];
  total_descartados: number;
}

interface GeocodeResults {
  total: number;
  geocoded: number;
  errors: number;
  skipped: number;
  error_details: string[];
}

const CargaDatos = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [results, setResults] = useState<ProcessResults | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // TAREA 7, 9, 10: Extended ETL response
  const [calidad, setCalidad] = useState<QualityReport | null>(null);
  const [reconciliacion, setReconciliacion] = useState<Reconciliacion | null>(null);
  const [metadata, setMetadata] = useState<ETLMetadata | null>(null);
  const [integridad, setIntegridad] = useState<Integridad | null>(null);

  // Geocoding state
  const [pendingGeocount, setPendingGeocount] = useState<number | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeResults, setGeocodeResults] = useState<GeocodeResults | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) navigate("/auth");
    });
  }, [navigate]);

  useEffect(() => {
    if (session?.user) {
      supabase.from("profiles").select("*").eq("user_id", session.user.id).single()
        .then(({ data }) => {
          if (data?.rol !== "asignador") { navigate("/"); return; }
          setProfile(data);
        });
    }
  }, [session, navigate]);

  const fetchPendingGeocount = useCallback(async () => {
    const { data: allClients } = await supabase
      .from("clientes")
      .select("client_id")
      .not("direccion_principal", "is", null)
      .not("ciudad_principal", "is", null);
    const { data: existingPlaces } = await supabase
      .from("client_places")
      .select("client_id");
    const placedIds = new Set((existingPlaces || []).map((p) => p.client_id));
    const pending = (allClients || []).filter((c) => !placedIds.has(c.client_id));
    setPendingGeocount(pending.length);
  }, []);

  useEffect(() => {
    if (profile) fetchPendingGeocount();
  }, [profile, fetchPendingGeocount]);

  const parseExcel = useCallback(async (f: File) => {
    const buffer = await f.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
    setFile(f);
    setRows(jsonRows);
    setColumns(jsonRows.length > 0 ? Object.keys(jsonRows[0]) : []);
    setStep("preview");
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseExcel(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))) parseExcel(f);
    else toast({ title: "Formato inválido", description: "Solo archivos .xlsx o .xls", variant: "destructive" });
  };

  const handleProcess = async () => {
    setStep("processing");
    setProgress(10);
    try {
      setProgress(30);
      const { data, error } = await supabase.functions.invoke("process-ventas-excel", { body: { rows } });
      setProgress(90);
      if (error) throw new Error(error.message || "Error al procesar");
      if (!data?.success) throw new Error(data?.error || "Error desconocido");
      setResults(data.results);
      // TAREA 7, 9, 10: Guardar datos extendidos
      if (data.calidad) setCalidad(data.calidad);
      if (data.reconciliacion) setReconciliacion(data.reconciliacion);
      if (data.metadata) setMetadata(data.metadata);
      if (data.integridad) setIntegridad(data.integridad);
      setProgress(100);
      setStep("done");
      toast({ title: "Carga completada", description: `${data.results.ventas_procesadas} ventas y ${data.results.clientes_actualizados} clientes procesados` });
      fetchPendingGeocount();
    } catch (err: any) {
      toast({ title: "Error en la carga", description: err.message, variant: "destructive" });
      setStep("preview");
    }
  };

  const handleBatchGeocode = async () => {
    setIsGeocoding(true);
    setGeocodeResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("geocode-clients");
      if (error) throw new Error(error.message || "Error al geocodificar");
      if (!data?.success) throw new Error(data?.error || "Error desconocido");
      setGeocodeResults(data.results);
      toast({
        title: "Geocodificación completada",
        description: `${data.results.geocoded} de ${data.results.total} clientes geocodificados`,
      });
      fetchPendingGeocount();
    } catch (err: any) {
      toast({ title: "Error en geocodificación", description: err.message, variant: "destructive" });
    } finally {
      setIsGeocoding(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setRows([]);
    setColumns([]);
    setResults(null);
    setCalidad(null);
    setReconciliacion(null);
    setMetadata(null);
    setIntegridad(null);
    setProgress(0);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  };

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-background/90 backdrop-blur-xl sticky top-0 z-50 border-b border-border/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <img src={cupraLogo} alt="Cupra" className="h-7 w-auto opacity-70" />
            </div>
            <h1 className="text-sm font-medium text-muted-foreground">Carga de Datos</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-foreground tracking-tight">
            Carga de Ventas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Subí el archivo Excel de ventas para actualizar la base de datos de clientes y transacciones.
          </p>
        </div>

        {/* STEP: Upload */}
        {step === "upload" && (
          <Card>
            <CardContent className="p-8">
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                  isDragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground mb-1">Arrastrá el archivo Excel aquí</p>
                <p className="text-xs text-muted-foreground mb-4">Formatos soportados: .xlsx, .xls</p>
                <label>
                  <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
                  <Button variant="outline" size="sm" asChild>
                    <span className="cursor-pointer">
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Seleccionar archivo
                    </span>
                  </Button>
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP: Preview */}
        {step === "preview" && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-sans">{file?.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {rows.length.toLocaleString()} filas · {columns.length} columnas
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" onClick={reset} className="h-8 w-8">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Eye className="h-3 w-3" /> Columnas detectadas
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {columns.map((col) => (
                      <Badge key={col} variant="secondary" className="text-xs font-normal">{col}</Badge>
                    ))}
                  </div>
                </div>
                <div className="border border-border/60 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30">
                          {columns.slice(0, 8).map((col) => (
                            <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                          ))}
                          {columns.length > 8 && (
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">+{columns.length - 8} más</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {rows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            {columns.slice(0, 8).map((col) => (
                              <td key={col} className="px-3 py-1.5 whitespace-nowrap text-foreground/80 max-w-[160px] truncate">
                                {row[col] !== null && row[col] !== undefined ? String(row[col]) : "—"}
                              </td>
                            ))}
                            {columns.length > 8 && <td className="px-3 py-1.5 text-muted-foreground">…</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 5 && (
                    <div className="px-3 py-1.5 bg-muted/20 text-xs text-muted-foreground text-center">
                      Mostrando 5 de {rows.length.toLocaleString()} filas
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={reset}>Cancelar</Button>
              <Button onClick={handleProcess}>
                <Upload className="h-4 w-4 mr-1.5" />
                Procesar {rows.length.toLocaleString()} filas
              </Button>
            </div>
          </div>
        )}

        {/* STEP: Processing */}
        {step === "processing" && (
          <Card>
            <CardContent className="p-8">
              <div className="text-center space-y-4">
                <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Procesando ventas…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Normalizando datos, calculando métricas y actualizando base de datos</p>
                </div>
                <Progress value={progress} className="max-w-xs mx-auto" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP: Done */}
        {step === "done" && results && (
          <div className="space-y-4">
            {/* Resumen principal */}
            <Card>
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
                  <p className="text-lg font-semibold text-foreground">Carga completada</p>
                  {metadata && (
                    <p className="text-xs text-muted-foreground mt-1">
                      ETL {metadata.version_etl} · Columna: {metadata.columna_facturacion || 'No resuelta'} · {new Date(metadata.fecha_carga).toLocaleString('es-AR')}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-2xl font-bold text-foreground">{results.ventas_procesadas.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Ventas procesadas</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-2xl font-bold text-foreground">{results.clientes_actualizados.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Clientes actualizados</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-2xl font-bold text-foreground">{results.ventas_errores}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Ventas con error</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-2xl font-bold text-foreground">{results.clientes_errores}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Clientes con error</p>
                  </div>
                </div>

                {results.errores.length > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-xs font-medium text-destructive flex items-center gap-1.5 mb-2">
                      <AlertCircle className="h-3.5 w-3.5" /> Errores encontrados
                    </p>
                    <ul className="text-xs text-destructive/80 space-y-1 max-h-32 overflow-y-auto">
                      {results.errores.map((err, i) => <li key={i}>• {err}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* TAREA 9: Reconciliación */}
            {reconciliacion && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    Reconciliación — Verificá contra tu Excel
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-2.5 rounded-lg bg-muted/20 text-center">
                      <p className="text-lg font-bold text-foreground">{reconciliacion.filas_excel.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Filas Excel</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/20 text-center">
                      <p className="text-lg font-bold text-foreground">{reconciliacion.filas_deduplicadas.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Líneas deduplicadas</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/20 text-center">
                      <p className="text-lg font-bold text-foreground">{reconciliacion.tickets_unicos.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Tickets únicos</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/20 text-center">
                      <p className="text-lg font-bold text-foreground">{reconciliacion.clientes_unicos.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Clientes únicos</p>
                    </div>
                  </div>
                  <div className="mt-3 p-2.5 rounded-lg bg-accent/5 text-center">
                    <p className="text-xs text-muted-foreground">Facturación total procesada</p>
                    <p className="text-xl font-bold text-accent">{formatCurrency(reconciliacion.facturacion_total_procesada)}</p>
                  </div>
                  {reconciliacion.filas_descartadas_sin_id > 0 && (
                    <p className="text-xs text-amber-500 mt-2">
                      ⚠️ {reconciliacion.filas_descartadas_sin_id} filas descartadas sin client_id/CUIT válido
                    </p>
                  )}
                  {reconciliacion.tickets_compartidos > 0 && (
                    <p className="text-xs text-amber-500 mt-1">
                      ⚠️ {reconciliacion.tickets_compartidos} tickets compartidos entre múltiples clientes
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* TAREA 7: Alertas de calidad */}
            {calidad && calidad.alerta && (
              <Card className="border-amber-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    Alertas de Calidad de Datos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {calidad.pct_sin_barrio > 10 && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-amber-500/30 text-amber-500">
                          {calidad.pct_sin_barrio}%
                        </Badge>
                        <span className="text-muted-foreground">
                          clientes sin barrio asignado ({calidad.clientes_sin_barrio})
                        </span>
                      </div>
                    )}
                    {calidad.pct_sin_vendedor > 5 && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-amber-500/30 text-amber-500">
                          {calidad.pct_sin_vendedor}%
                        </Badge>
                        <span className="text-muted-foreground">
                          clientes sin vendedor ({calidad.clientes_sin_vendedor})
                        </span>
                      </div>
                    )}
                    {calidad.pct_sin_client_id > 0 && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-amber-500/30 text-amber-500">
                          {calidad.pct_sin_client_id}%
                        </Badge>
                        <span className="text-muted-foreground">
                          filas del Excel sin identificador de cliente
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* TAREA 12: Descartados sin client_id */}
            {integridad && integridad.total_descartados > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    Registros descartados ({integridad.total_descartados})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-32 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="text-left py-1 px-2 text-muted-foreground">CUIT/DNI</th>
                          <th className="text-left py-1 px-2 text-muted-foreground">Razón Social</th>
                        </tr>
                      </thead>
                      <tbody>
                        {integridad.descartados_sin_client_id.map((d, i) => (
                          <tr key={i} className="border-b border-border/20">
                            <td className="py-1 px-2 text-foreground/70">{d.cuit_dni || '—'}</td>
                            <td className="py-1 px-2 text-foreground/70">{d.razon_social || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {integridad.total_descartados > 20 && (
                      <p className="text-xs text-muted-foreground text-center mt-1">
                        Mostrando 20 de {integridad.total_descartados}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={reset}>Cargar otro archivo</Button>
              <Button onClick={() => navigate("/")}>Volver al inicio</Button>
            </div>
          </div>
        )}

        {/* ── Section 2: Batch Geocoding ── */}
        <div className="pt-4 border-t border-border/30">
          <h2 className="text-xl font-serif text-foreground tracking-tight">
            Geocodificación de Clientes
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Clientes con dirección pero sin coordenadas GPS. Necesarios para el motor de recomendaciones geográficas.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            {pendingGeocount === null ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Calculando clientes pendientes…</span>
              </div>
            ) : pendingGeocount === 0 && !geocodeResults ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Todos los clientes tienen coordenadas GPS</span>
              </div>
            ) : (
              <div className="space-y-4">
                {!isGeocoding && !geocodeResults && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <MapPin className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {pendingGeocount} cliente{pendingGeocount !== 1 ? "s" : ""} sin coordenadas
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Se geocodificarán usando Google Maps API (~{Math.ceil(pendingGeocount * 0.2)}s estimado)
                        </p>
                      </div>
                    </div>
                    <Button onClick={handleBatchGeocode} size="sm">
                      <MapPin className="h-3.5 w-3.5 mr-1.5" />
                      Geocodificar
                    </Button>
                  </div>
                )}

                {isGeocoding && (
                  <div className="text-center space-y-3 py-4">
                    <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Geocodificando clientes…</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Consultando Google Maps API para {pendingGeocount} direcciones. Esto puede tomar ~{Math.ceil((pendingGeocount || 0) * 0.2)}s.
                      </p>
                    </div>
                  </div>
                )}

                {geocodeResults && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="text-sm font-medium text-foreground">Geocodificación completada</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="text-center p-2.5 rounded-lg bg-muted/30">
                        <p className="text-xl font-bold text-foreground">{geocodeResults.total}</p>
                        <p className="text-xs text-muted-foreground">Total pendientes</p>
                      </div>
                      <div className="text-center p-2.5 rounded-lg bg-green-500/10">
                        <p className="text-xl font-bold text-green-600">{geocodeResults.geocoded}</p>
                        <p className="text-xs text-muted-foreground">Geocodificados</p>
                      </div>
                      <div className="text-center p-2.5 rounded-lg bg-destructive/10">
                        <p className="text-xl font-bold text-destructive">{geocodeResults.errors}</p>
                        <p className="text-xs text-muted-foreground">Con error</p>
                      </div>
                      <div className="text-center p-2.5 rounded-lg bg-muted/30">
                        <p className="text-xl font-bold text-foreground">{geocodeResults.skipped}</p>
                        <p className="text-xs text-muted-foreground">Sin dirección</p>
                      </div>
                    </div>
                    {geocodeResults.error_details.length > 0 && (
                      <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <p className="text-xs font-medium text-destructive flex items-center gap-1.5 mb-2">
                          <AlertCircle className="h-3.5 w-3.5" /> Detalle de errores
                        </p>
                        <ul className="text-xs text-destructive/80 space-y-1 max-h-32 overflow-y-auto">
                          {geocodeResults.error_details.slice(0, 20).map((err, i) => <li key={i}>• {err}</li>)}
                          {geocodeResults.error_details.length > 20 && (
                            <li className="text-muted-foreground">…y {geocodeResults.error_details.length - 20} más</li>
                          )}
                        </ul>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => { setGeocodeResults(null); fetchPendingGeocount(); }}>
                        Verificar de nuevo
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CargaDatos;
