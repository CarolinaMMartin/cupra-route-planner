import { useState, useEffect, useCallback } from "react";
import { isAssignorLike, canViewSalesDashboard } from "@/lib/roles";
import AppNav from "@/components/AppNav";
import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X, Eye, MapPin, AlertTriangle, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import cupraLogo from "@/assets/cupra-logo-new.png";
import * as XLSX from "xlsx";
import { toTitleCase } from "@/lib/format";

type Step = "upload" | "preview" | "processing" | "done";
type FileKind = "ventas" | "maestro";
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type SpreadsheetRow = Record<string, unknown>;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Error inesperado";

interface MaestroResults {
  clientes_nuevos: number;
  clientes_actualizados: number;
  clientes_errores: number;
  coordenadas_actualizadas: number;
  sin_vendedor: number;
  sin_resolver: number;
  errores: string[];
}


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
  filas_excel_recibidas?: number;
  filas_excel_notas_credito?: number;
  notas_credito_aplicadas?: number;
  notas_credito_sin_match?: number;
  notas_credito_duplicadas?: number;
  notas_credito_sin_importe?: number;
  monto_notas_credito?: number;
  filas_procesadas: number;
  filas_deduplicadas: number;
  filas_venta_insertadas?: number;
  filas_nota_credito_insertadas?: number;
  filas_descartadas_total?: number;
  filas_descartadas_por_motivo?: Record<string, number>;
  filas_descartadas_sin_id: number;
  facturacion_total_procesada: number;
  tickets_unicos: number;
  clientes_unicos: number;
  clientes_razon_social?: number;
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
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [results, setResults] = useState<ProcessResults | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(true);

  // Detección automática de archivo (ventas vs maestro de clientes)
  const [fileKind, setFileKind] = useState<FileKind>("ventas");
  const [sheetName, setSheetName] = useState<string>("");
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [notasCredito, setNotasCredito] = useState<SpreadsheetRow[]>([]);
  // Doble ingesta: "Ventas por Comprobante" = verdad monetaria (todas las marcas)
  const [comprobantes, setComprobantes] = useState<SpreadsheetRow[]>([]);
  const [comprobantesSheetName, setComprobantesSheetName] = useState<string>("");
  const [maestroResults, setMaestroResults] = useState<MaestroResults | null>(null);
  const [maestroVendedores, setMaestroVendedores] = useState<{ vendedor: string; clientes: number }[]>([]);


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
          if (!isAssignorLike(data?.rol)) { navigate("/"); return; }
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

  // ── Detección automática de hoja, fila de encabezados y tipo de archivo ──
  const norm = useCallback((s: unknown) =>
    String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""), []);

  const parseSheet = useCallback((sheet: XLSX.WorkSheet) => {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      const cells = (aoa[i] || []).filter((c) => c !== null && String(c).trim() !== "");
      const texto = cells.filter((c) => typeof c === "string" && String(c).trim().length > 1);
      if (cells.length >= 3 && texto.length >= 3) { headerIdx = i; break; }
    }
    if (headerIdx === -1) return { headerIdx: -1, rows: [] as SpreadsheetRow[], keys: [] as string[] };
    const rows = XLSX.utils
      .sheet_to_json<SpreadsheetRow>(sheet, { range: headerIdx, defval: null })
      .filter((r) => Object.values(r).some((v) => v !== null && String(v).trim() !== ""));
    const keys = rows.length > 0 ? Object.keys(rows[0]).map(norm) : [];
    return { headerIdx, rows, keys };
  }, [norm]);

  const classify = useCallback((keys: string[]): "ventas" | "maestro" | "notas" | null => {
    const has = (...c: string[]) => c.some((k) => keys.includes(norm(k)));
    const esVenta = has("Ticket") && (has("Precio Total Final", "Total Final", "Total Bruto", "Facturación Ar$") || has("CUIT / DNI"));
    if (esVenta) return "ventas";
    if (has("Razón Social", "RAZON SOCIAL / NOM. FANTASIA") && (has("Vendedor") || has("Categorías", "Categorías Cliente") || has("Latitud"))) {
      return "maestro";
    }
    return null;
  }, [norm]);

  const parseExcel = useCallback(async (f: File) => {
    const maxFileSize = 15 * 1024 * 1024;
    if (f.size > maxFileSize) {
      toast({
        title: "Archivo demasiado grande",
        description: "El límite de carga es 15 MB.",
        variant: "destructive",
      });
      return;
    }

    try {
    const buffer = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const workbook = XLSX.read(buffer, { type: "array" });

    const parsedSheets = workbook.SheetNames.map((name) => ({ name, ...parseSheet(workbook.Sheets[name]) }));

    // Hojas de notas de crédito (sólo acompañan a un archivo de ventas)
    const ncSheet =
      parsedSheets.find((s) => /nota/i.test(s.name) && /detall/i.test(s.name)) ||
      parsedSheets.find((s) => /nota/i.test(s.name));

    const candidatos = parsedSheets
      .filter((s) => s.rows.length > 0 && !/nota/i.test(s.name))
      .map((s) => ({ ...s, tipo: classify(s.keys) }));

    // Prioridad: hoja de ventas por producto > ventas > maestro > la más grande
    const ventasProducto = candidatos.find((s) => s.tipo === "ventas" && /producto/i.test(s.name));
    const comprobanteSheet = candidatos.find((s) => /comprobante/i.test(s.name) && s.rows.length > 0);
    const ventas = ventasProducto || candidatos.find((s) => s.tipo === "ventas");
    const maestro = candidatos.filter((s) => s.tipo === "maestro").sort((a, b) => b.rows.length - a.rows.length)[0];
    const elegido = ventas || maestro || candidatos.sort((a, b) => b.rows.length - a.rows.length)[0];

    if (!elegido || elegido.rows.length === 0) {
      toast({ title: "Archivo vacío", description: "No se detectaron filas con datos", variant: "destructive" });
      return;
    }
    if (elegido.rows.length > 50_000 || (ncSheet?.rows.length || 0) > 50_000) {
      toast({
        title: "Archivo demasiado extenso",
        description: "Cada hoja puede contener hasta 50.000 filas.",
        variant: "destructive",
      });
      return;
    }

    const tipo: FileKind = (elegido.tipo as FileKind) || "ventas";
    setFile(f);
    setFileHash(sha256);
    setFileKind(tipo);
    setSheetName(elegido.name);
    setHeaderRow(elegido.headerIdx + 1);
    setRows(elegido.rows);
    setColumns(Object.keys(elegido.rows[0]));
    setNotasCredito(tipo === "ventas" && ncSheet ? ncSheet.rows : []);
    const usaComprobantes =
      tipo === "ventas" && comprobanteSheet && comprobanteSheet.name !== elegido.name;
    setComprobantes(usaComprobantes ? comprobanteSheet!.rows : []);
    setComprobantesSheetName(usaComprobantes ? comprobanteSheet!.name : "");
    setStep("preview");
    } catch (error) {
      toast({
        title: "No se pudo leer el archivo",
        description: error instanceof Error ? error.message : "El archivo no tiene un formato válido.",
        variant: "destructive",
      });
    }
  }, [classify, parseSheet, toast]);

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
      const fileMetadata = {
        name: file?.name,
        size: file?.size,
        lastModified: file?.lastModified,
        sha256: fileHash,
        sheetName,
        headerRow,
      };

      if (fileKind === "maestro") {
        const { data, error } = await supabase.functions.invoke("process-clientes-maestro", {
          body: { rows, fileMetadata },
        });
        setProgress(90);
        if (error) throw new Error(error.message || "Error al procesar");
        if (!data?.success) throw new Error(data?.error || "Error desconocido");
        setMaestroResults(data.results);
        setMaestroVendedores(data.vendedor_breakdown || []);
        setBatchId(data.batch_id || null);
        setProgress(100);
        setStep("done");
        toast({
          title: "Maestro de clientes actualizado",
          description: `${data.results.clientes_nuevos} nuevos · ${data.results.clientes_actualizados} actualizados`,
        });
        fetchPendingGeocount();
        return;
      }

      const { data, error } = await supabase.functions.invoke("process-ventas-excel", {
        body: {
          rows,
          replaceExisting,
          notasCredito: notasCredito.length ? notasCredito : undefined,
          comprobantes: comprobantes.length ? comprobantes : undefined,
          fileMetadata: { ...fileMetadata, comprobantesSheetName: comprobantesSheetName || null },
        },
      });
      setProgress(90);
      if (error) throw new Error(error.message || "Error al procesar");
      if (!data?.success) throw new Error(data?.error || "Error desconocido");
      setResults(data.results);
      setBatchId(data.batch_id || null);
      // TAREA 7, 9, 10: Guardar datos extendidos
      if (data.calidad) setCalidad(data.calidad);
      if (data.reconciliacion) setReconciliacion(data.reconciliacion);
      if (data.metadata) setMetadata(data.metadata);
      if (data.integridad) setIntegridad(data.integridad);
      setProgress(100);
      setStep("done");
      toast({ title: "Carga completada", description: `${data.results.ventas_procesadas} ventas y ${data.results.clientes_actualizados} clientes procesados` });
      fetchPendingGeocount();
    } catch (err: unknown) {
      toast({ title: "Error en la carga", description: getErrorMessage(err), variant: "destructive" });
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
    } catch (err: unknown) {
      toast({ title: "Error en geocodificación", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsGeocoding(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setFileHash(null);
    setBatchId(null);
    setRows([]);
    setColumns([]);
    setResults(null);
    setCalidad(null);
    setReconciliacion(null);
    setMetadata(null);
    setIntegridad(null);
    setNotasCredito([]);
    setComprobantes([]);
    setComprobantesSheetName("");
    setMaestroResults(null);
    setMaestroVendedores([]);
    setSheetName("");
    setHeaderRow(1);
    setFileKind("ventas");
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
      <AppNav />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-sans text-foreground tracking-tight">
            Carga de Datos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Subí el archivo de <strong>ventas</strong> o el <strong>maestro de clientes</strong>. El sistema detecta
            automáticamente el tipo, la hoja y la fila de encabezados.
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
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-sans">{file?.name}</CardTitle>
                      <Badge variant={fileKind === "maestro" ? "outline" : "default"} className="text-[10px]">
                        {fileKind === "maestro" ? "Maestro de clientes" : "Ventas"}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs mt-0.5">
                      Hoja "{sheetName}" · encabezados en fila {headerRow} · {rows.length.toLocaleString()} filas · {columns.length} columnas
                      {notasCredito.length > 0 && ` · ${notasCredito.length.toLocaleString()} notas de crédito`}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {fileKind === "ventas" ? (
                  <>
                    <Checkbox
                      id="replaceExisting"
                      checked={replaceExisting}
                      onCheckedChange={(checked) => setReplaceExisting(checked === true)}
                    />
                    <label htmlFor="replaceExisting" className="text-sm text-muted-foreground cursor-pointer">
                      Reemplazar datos existentes <span className="text-xs">(recomendado para carga completa)</span>
                    </label>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground max-w-md">
                    El maestro actualiza cartera, contacto, categorías, vendedor asignado y coordenadas.
                    No modifica el histórico de ventas ni el feedback de los vendedores.
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={reset}>Cancelar</Button>
                <Button onClick={handleProcess}>
                  <Upload className="h-4 w-4 mr-1.5" />
                  Procesar {rows.length.toLocaleString()} filas
                </Button>
              </div>
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
                  <p className="text-sm font-medium text-foreground">
                    {fileKind === "maestro" ? "Procesando maestro de clientes…" : "Procesando ventas…"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Normalizando datos, calculando métricas y actualizando base de datos</p>
                </div>
                <Progress value={progress} className="max-w-xs mx-auto" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP: Done — Maestro de clientes */}
        {step === "done" && maestroResults && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
                  <p className="text-lg font-semibold text-foreground">Maestro de clientes actualizado</p>
                  {batchId && <p className="text-xs text-muted-foreground mt-1">Lote {batchId}</p>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Clientes nuevos", value: maestroResults.clientes_nuevos },
                    { label: "Actualizados", value: maestroResults.clientes_actualizados },
                    { label: "Coordenadas", value: maestroResults.coordenadas_actualizadas },
                    { label: "Sin vendedor", value: maestroResults.sin_vendedor },
                  ].map((m) => (
                    <div key={m.label} className="text-center p-3 rounded-lg bg-muted/20">
                      <p className="text-xl font-semibold text-foreground">{m.value.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>
                {(maestroResults.clientes_errores > 0 || maestroResults.sin_resolver > 0) && (
                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    {maestroResults.clientes_errores} errores · {maestroResults.sin_resolver} filas sin identificador resoluble
                  </p>
                )}
              </CardContent>
            </Card>

            {maestroVendedores.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-sans">Cartera por vendedor</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {maestroVendedores.map((v) => (
                      <div key={v.vendedor} className="flex justify-between text-sm">
                        <span className="text-foreground/80">{toTitleCase(v.vendedor)}</span>
                        <span className="text-muted-foreground">{v.clientes.toLocaleString()} clientes</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={reset}>Cargar otro archivo</Button>
              <Button onClick={() => navigate("/")}>Ir al panel</Button>
            </div>
          </div>
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
                  {batchId && <p className="text-xs text-muted-foreground mt-1">Lote {batchId}</p>}
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
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                      <p className="text-lg font-bold text-foreground">{(reconciliacion.clientes_razon_social ?? reconciliacion.clientes_unicos).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Clientes (razón social)</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/20 text-center">
                      <p className="text-lg font-bold text-foreground">{reconciliacion.clientes_unicos.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Clientes (por ID)</p>
                    </div>
                  </div>
                  <div className="mt-3 p-2.5 rounded-lg bg-accent/5 text-center">
                    <p className="text-xs text-muted-foreground">Facturación total procesada</p>
                    <p className="text-xl font-bold text-accent">{formatCurrency(reconciliacion.facturacion_total_procesada)}</p>
                  </div>

                  {/* Conciliación fila por fila: Excel vs base */}
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Cómo cierra el conteo</p>
                    <div className="border border-border/40 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-border/20">
                          <tr>
                            <td className="px-3 py-1.5 text-foreground/80">Filas de venta leídas del Excel</td>
                            <td className="px-3 py-1.5 text-right font-medium text-foreground">{(reconciliacion.filas_excel_recibidas ?? reconciliacion.filas_excel).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-1.5 text-foreground/80">Notas de crédito leídas del Excel</td>
                            <td className="px-3 py-1.5 text-right font-medium text-foreground">{(reconciliacion.filas_excel_notas_credito ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-1.5 text-foreground/80">Ventas cargadas en la base</td>
                            <td className="px-3 py-1.5 text-right font-medium text-foreground">{(reconciliacion.filas_venta_insertadas ?? reconciliacion.filas_deduplicadas).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-1.5 text-foreground/80">Notas de crédito cargadas (importe negativo)</td>
                            <td className="px-3 py-1.5 text-right font-medium text-foreground">{(reconciliacion.filas_nota_credito_insertadas ?? reconciliacion.notas_credito_aplicadas ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr className="bg-muted/20">
                            <td className="px-3 py-1.5 font-medium text-foreground">Total de filas en la base</td>
                            <td className="px-3 py-1.5 text-right font-bold text-foreground">{reconciliacion.filas_deduplicadas.toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-1.5 text-foreground/80">Filas omitidas</td>
                            <td className="px-3 py-1.5 text-right font-medium text-amber-500">{(reconciliacion.filas_descartadas_total ?? reconciliacion.filas_descartadas_sin_id).toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {reconciliacion.filas_descartadas_por_motivo && Object.keys(reconciliacion.filas_descartadas_por_motivo).length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Motivo de las filas omitidas</p>
                      <div className="border border-border/40 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-border/20">
                            {Object.entries(reconciliacion.filas_descartadas_por_motivo).map(([key, count]) => {
                              const [origen, motivo] = key.split(':');
                              const labels: Record<string, string> = {
                                sin_identidad_cliente: 'Sin cliente identificable',
                                duplicada_exacta: 'Fila duplicada exacta',
                                sin_razon_social: 'Sin razón social',
                                cliente_no_conciliado: 'Cliente no encontrado en la base',
                                sin_importe: 'Sin importe',
                              };
                              return (
                                <tr key={key}>
                                  <td className="px-3 py-1.5 text-foreground/80">
                                    {origen === 'nota_credito' ? 'Nota de crédito' : 'Venta'} — {labels[motivo] || motivo}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-medium text-foreground">{count.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        Las filas omitidas quedan guardadas 7 días con su motivo para poder revisarlas.
                      </p>
                    </div>
                  )}

                  {reconciliacion.tickets_compartidos > 0 && (
                    <p className="text-xs text-amber-500 mt-2">
                      ⚠️ {reconciliacion.tickets_compartidos} tickets compartidos entre múltiples clientes
                    </p>
                  )}

                  {/* Fix 4: Desglose por vendedor */}
                  {reconciliacion.vendedor_breakdown && reconciliacion.vendedor_breakdown.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Monto por vendedor</p>
                      <div className="border border-border/40 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/30">
                              <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Vendedor</th>
                              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Registros</th>
                              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Monto</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {reconciliacion.vendedor_breakdown.map((vb, i) => (
                              <tr key={i} className="hover:bg-muted/10">
                                <td className="px-3 py-1.5 text-foreground">{toTitleCase(vb.vendedor)}</td>
                                <td className="px-3 py-1.5 text-right text-foreground/70">{vb.registros.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right font-medium text-foreground">{formatCurrency(vb.monto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
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
          <h2 className="text-xl font-sans text-foreground tracking-tight">
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
