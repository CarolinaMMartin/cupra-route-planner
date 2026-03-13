import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X, Eye } from "lucide-react";
import cupraLogo from "@/assets/cupra-logo-new.png";
import * as XLSX from "xlsx";

type Step = "upload" | "preview" | "processing" | "done";

interface ProcessResults {
  ventas_procesadas: number;
  ventas_errores: number;
  clientes_actualizados: number;
  clientes_errores: number;
  errores: string[];
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
      const { data, error } = await supabase.functions.invoke("process-ventas-excel", {
        body: { rows },
      });

      setProgress(90);

      if (error) throw new Error(error.message || "Error al procesar");
      if (!data?.success) throw new Error(data?.error || "Error desconocido");

      setResults(data.results);
      setProgress(100);
      setStep("done");
      toast({ title: "Carga completada", description: `${data.results.ventas_procesadas} ventas y ${data.results.clientes_actualizados} clientes procesados` });
    } catch (err: any) {
      toast({ title: "Error en la carga", description: err.message, variant: "destructive" });
      setStep("preview");
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setRows([]);
    setColumns([]);
    setResults(null);
    setProgress(0);
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

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
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
                <p className="text-sm font-medium text-foreground mb-1">
                  Arrastrá el archivo Excel aquí
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Formatos soportados: .xlsx, .xls
                </p>
                <label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    className="hidden"
                  />
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
                      <Badge key={col} variant="secondary" className="text-xs font-normal">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Preview table */}
                <div className="border border-border/60 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30">
                          {columns.slice(0, 8).map((col) => (
                            <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                          {columns.length > 8 && (
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                              +{columns.length - 8} más
                            </th>
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
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Normalizando datos, calculando métricas y actualizando base de datos
                  </p>
                </div>
                <Progress value={progress} className="max-w-xs mx-auto" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP: Done */}
        {step === "done" && results && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
                  <p className="text-lg font-semibold text-foreground">Carga completada</p>
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
                      {results.errores.map((err, i) => (
                        <li key={i}>• {err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={reset}>Cargar otro archivo</Button>
              <Button onClick={() => navigate("/")}>Volver al inicio</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default CargaDatos;
