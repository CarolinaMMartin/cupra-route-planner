import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

/**
 * ═══════════════════════════════════════════════════════════════
 * ETL: process-ventas-excel — v3.2
 * ═══════════════════════════════════════════════════════════════
 * 
 * MODELO DE DATOS:
 * ────────────────
 * • ventas_cupra: Tabla TRANSACCIONAL. 1 fila = 1 línea de producto.
 *   Granularidad: ticket + letra + fecha + client_id + codigo_producto.
 *   
 * • clientes: Tabla AGREGADA, derivada de ventas_cupra.
 *   1 fila = 1 cliente. Campos calculados desde ventas_cupra.
 *
 * FUENTE DE VERDAD:
 * ─────────────────
 * KPIs monetarios → ventas_cupra (SUM facturacion_ars)
 * Segmentación/filtros → clientes (campos derivados)
 *
 * MÉTRICAS Y GRANULARIDAD:
 * ────────────────────────
 * • monto_total_historico: SUM(facturacion_ars) de líneas deduplicadas. Granularidad: línea.
 * • cantidad_ordenes: COUNT(DISTINCT ticket). Granularidad: ticket único.
 * • ticket_promedio: monto_total_historico / cantidad_ordenes. Granularidad: ticket.
 * • vendedor_actual: Vendedor de la venta MÁS RECIENTE del cliente. Operativo.
 * • vendedor_principal: Vendedor con más ventas históricas (mode). Histórico.
 *
 * COLUMNA DE FACTURACIÓN:
 * ───────────────────────
 * Fuente oficial: "Precio Total Final" (valor con IVA). Confirmado 2026-03-17.
 * Prioridad: Precio Total Final > Precio Total Neto > Facturación Ar$ > facturacion_ars
 * 
 * VERSION: v3.0 — Precio Total Final, tickets DISTINCT, KPIs 100% transaccional
 * ═══════════════════════════════════════════════════════════════
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// === CONFIGURACIÓN ===
const DIAS_ACTIVO = 30;
const DIAS_INTERMITENTE = 90;
const DIAS_INACTIVO = 180;
const ETL_VERSION = 'v3.2';

interface FileMetadata {
  name?: string;
  size?: number;
  lastModified?: number;
  sha256?: string | null;
  sheetName?: string;
  headerRow?: number;
}

type SupabaseAdminClient = SupabaseClient<any, 'public', any>;

// === UMBRALES DE CALIDAD ===
const UMBRAL_PCT_SIN_BARRIO = 10;
const UMBRAL_PCT_SIN_VENDEDOR = 5;

// === MAPEO BARRIOS → COMUNAS DE CABA ===
const BARRIOS_A_COMUNA: Record<string, string> = {
  'RETIRO': 'COMUNA 1', 'SAN NICOLAS': 'COMUNA 1', 'PUERTO MADERO': 'COMUNA 1',
  'SAN TELMO': 'COMUNA 1', 'MONTSERRAT': 'COMUNA 1', 'CONSTITUCION': 'COMUNA 1',
  'RECOLETA': 'COMUNA 2',
  'BALVANERA': 'COMUNA 3', 'SAN CRISTOBAL': 'COMUNA 3',
  'LA BOCA': 'COMUNA 4', 'BARRACAS': 'COMUNA 4', 'PARQUE PATRICIOS': 'COMUNA 4', 'NUEVA POMPEYA': 'COMUNA 4',
  'ALMAGRO': 'COMUNA 5', 'BOEDO': 'COMUNA 5',
  'CABALLITO': 'COMUNA 6',
  'FLORES': 'COMUNA 7', 'PARQUE CHACABUCO': 'COMUNA 7',
  'VILLA SOLDATI': 'COMUNA 8', 'VILLA RIACHUELO': 'COMUNA 8', 'VILLA LUGANO': 'COMUNA 8',
  'LINIERS': 'COMUNA 9', 'MATADEROS': 'COMUNA 9', 'PARQUE AVELLANEDA': 'COMUNA 9',
  'VILLA REAL': 'COMUNA 10', 'MONTE CASTRO': 'COMUNA 10', 'VERSALLES': 'COMUNA 10',
  'FLORESTA': 'COMUNA 10', 'VELEZ SARSFIELD': 'COMUNA 10', 'VILLA LURO': 'COMUNA 10',
  'VILLA GENERAL MITRE': 'COMUNA 11', 'VILLA DEVOTO': 'COMUNA 11',
  'VILLA DEL PARQUE': 'COMUNA 11', 'VILLA SANTA RITA': 'COMUNA 11',
  'COGHLAN': 'COMUNA 12', 'SAAVEDRA': 'COMUNA 12', 'VILLA URQUIZA': 'COMUNA 12', 'VILLA PUEYRREDON': 'COMUNA 12',
  'NUÑEZ': 'COMUNA 13', 'BELGRANO': 'COMUNA 13', 'COLEGIALES': 'COMUNA 13',
  'PALERMO': 'COMUNA 14',
  'CHACARITA': 'COMUNA 15', 'VILLA CRESPO': 'COMUNA 15', 'PATERNAL': 'COMUNA 15',
  'VILLA ORTUZAR': 'COMUNA 15', 'AGRONOMIA': 'COMUNA 15', 'PARQUE CHAS': 'COMUNA 15',
  // Barrios adicionales / alias comunes
  'CONGRESO': 'COMUNA 5', 'ONCE': 'COMUNA 3', 'ABASTO': 'COMUNA 3',
  'MICROCENTRO': 'COMUNA 1', 'TRIBUNALES': 'COMUNA 1',
};

// === HELPERS ===
const isEmpty = (v: any): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const toStr = (v: any): string | null => isEmpty(v) ? null : String(v).trim();
const toInt = (v: any): number | null => {
  if (isEmpty(v)) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};
const toFloat = (v: any): number | null => {
  if (isEmpty(v)) return null;
  const cleaned = String(v).replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};
const toNumberCurrency = (v: any): number | null => {
  if (isEmpty(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const directParse = Number(s);
  if (Number.isFinite(directParse)) return directParse;
  const cleaned = s.replace(/[^\d,.\-]/g, '').replace(/\s+/g, '');
  if (/,\d{1,2}$/.test(cleaned)) {
    const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (/\.\d{1,2}$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(cleaned.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const normalizeClientId = (v: any): string | null => {
  if (isEmpty(v)) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  if (/^[\d.,]+$/.test(raw)) {
    const normalized = raw.replace(/,/g, '.');
    const asNum = Number(normalized);
    if (Number.isFinite(asNum)) {
      return Number.isInteger(asNum) ? String(asNum) : normalized.replace(/\.0+$/, '');
    }
  }
  return raw;
};

const normalizeBusinessName = (v: any): string | null => {
  const s = toStr(v);
  if (!s) return null;
  return s.toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeCuit = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  // El Excel puede traer el CUIT como número (27133820472) o en notación
  // científica al exportar (2.713382e+10). Ambos casos se normalizan a dígitos.
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(Math.round(v)) : null;
  }
  const s = toStr(v);
  if (!s) return null;
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  const digits = s.replace(/\D/g, '');
  return digits || s;
};


/**
 * Busca un valor en un objeto probando múltiples nombres de campo.
 * Prioridad: exacto → case-insensitive → NFD-normalized.
 * 
 * IMPORTANTE: El orden de fieldNames define la prioridad de resolución.
 * Para facturacion_ars, la prioridad es:
 *   'Facturación Ar$' > 'Facturacion Ar$' > etc. > 'Precio Total Final'
 */
function getFieldValue(obj: Record<string, any>, fieldNames: string[]): any {
  for (const f of fieldNames) {
    if (obj[f] !== undefined) return obj[f];
  }
  const keys = Object.keys(obj);
  for (const f of fieldNames) {
    for (const k of keys) {
      if (k.toLowerCase() === f.toLowerCase()) return obj[k];
    }
  }
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  for (const f of fieldNames) {
    const nf = normalize(f);
    for (const k of keys) {
      if (normalize(k) === nf) return obj[k];
    }
  }
  return undefined;
}

/**
 * Resuelve qué columna del Excel se mapeó para un campo dado.
 * Retorna el nombre de la columna encontrada o null.
 */
function resolveFieldName(obj: Record<string, any>, fieldNames: string[]): string | null {
  for (const f of fieldNames) {
    if (obj[f] !== undefined) return f;
  }
  const keys = Object.keys(obj);
  for (const f of fieldNames) {
    for (const k of keys) {
      if (k.toLowerCase() === f.toLowerCase()) return k;
    }
  }
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  for (const f of fieldNames) {
    const nf = normalize(f);
    for (const k of keys) {
      if (normalize(k) === nf) return k;
    }
  }
  return null;
}

const mode = (iterable: Set<string>): string | null => {
  const arr = Array.from(iterable).filter(Boolean).map(v => String(v).trim());
  if (!arr.length) return null;
  const freq: Record<string, number> = {};
  arr.forEach(x => freq[x] = (freq[x] || 0) + 1);
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
};

const toYmdFromExcelOrText = (v: any): string | null => {
  if (isEmpty(v)) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().split('T')[0];
  const maybeNum = Number(v);
  if (Number.isFinite(maybeNum) && String(v).trim() === String(maybeNum)) {
    const ms = (maybeNum - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return d.toISOString().split('T')[0];
  }
  const txt = String(v).trim();
  const m = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyyRaw] = m;
    const yyyy = Number(yyyyRaw.length === 2 ? (Number(yyyyRaw) + 2000) : yyyyRaw);
    const d = new Date(yyyy, Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return d.toISOString().split('T')[0];
  }
  const d2 = new Date(txt);
  return isNaN(d2.getTime()) ? null : d2.toISOString().split('T')[0];
};

// Compat helpers: mantienen nombres usados en el pipeline
const parseDate = (v: any): string | null => toYmdFromExcelOrText(v);
const parseNumericValue = (v: any): number | null => toNumberCurrency(v);

interface GeoResult { barrio: string | null; comuna: string | null; ciudad: string | null; provincia: string | null; }

// === NORMALIZACIÓN DE PROVINCIAS ===
const PROVINCIA_NORM: Record<string, string> = {
  'CABA': 'CABA',
  'CDAD. AUTONOMA DE BUENOS AIRES': 'CABA',
  'CDAD AUTONOMA DE BUENOS AIRES': 'CABA',
  'CIUDAD AUTONOMA DE BUENOS AIRES': 'CABA',
  'C.A.B.A.': 'CABA',
  'CAPITAL FEDERAL': 'CABA',
  'BUENOS AIRES': 'Provincia de Buenos Aires',
  'BS AS': 'Provincia de Buenos Aires',
  'BS. AS.': 'Provincia de Buenos Aires',
  'PBA': 'Provincia de Buenos Aires',
  'PROVINCIA DE BUENOS AIRES': 'Provincia de Buenos Aires',
};

const normalizeProvincia = (prov: string | null): string | null => {
  if (!prov) return null;
  const key = prov.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return PROVINCIA_NORM[key] || prov;
};

function normalizarGeografia(ciudadRaw: string | null): GeoResult {
  if (!ciudadRaw) return { barrio: null, comuna: null, ciudad: null, provincia: null };
  const ubicacionNorm = ciudadRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // Fix 2: Normalizar también las keys del mapa para evitar que NFD rompa Ñ→N
  const barrioKey = Object.keys(BARRIOS_A_COMUNA).find(k =>
    k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === ubicacionNorm
  );
  if (barrioKey) {
    return { barrio: barrioKey, comuna: BARRIOS_A_COMUNA[barrioKey], ciudad: 'CABA', provincia: 'CABA' };
  }
  if (ubicacionNorm === 'CABA' || ubicacionNorm === 'CIUDAD AUTONOMA DE BUENOS AIRES') {
    return { barrio: null, comuna: null, ciudad: 'CABA', provincia: 'CABA' };
  }
  if (ubicacionNorm.includes('LA PLATA')) {
    const match = ubicacionNorm.match(/LA PLATA\s*\(([^)]+)\)/);
    return { barrio: match ? match[1].trim() : null, comuna: null, ciudad: 'LA PLATA', provincia: 'BUENOS AIRES' };
  }
  if (['CITY BELL', 'GONNET', 'ABASTO'].includes(ubicacionNorm)) {
    return { barrio: ubicacionNorm, comuna: null, ciudad: 'LA PLATA', provincia: 'BUENOS AIRES' };
  }
  const zonaVicente = ['OLIVOS', 'FLORIDA', 'MARTINEZ', 'LA LUCILA', 'MUNRO'];
  if (zonaVicente.includes(ubicacionNorm)) {
    return { barrio: null, comuna: null, ciudad: ubicacionNorm, provincia: 'BUENOS AIRES' };
  }
  return { barrio: null, comuna: null, ciudad: ubicacionNorm, provincia: 'BUENOS AIRES' };
}

const countNonEmptyValues = (obj: Record<string, any>): number => {
  return Object.values(obj).reduce((acc, value) => acc + (isEmpty(value) ? 0 : 1), 0);
};

// OT8-fix: la identidad de la línea NO incluye el importe. Incluye la bonificación,
// porque un mismo ticket trae habitualmente dos renglones del mismo producto:
// el pagado (bonif. parcial) y el regalado (bonif. 100%, importe $0).
const buildVentaConflictKey = (venta: Record<string, any>): string | null => {
  const ticket = venta.ticket;
  if (isEmpty(ticket)) return null;
  const parts = [
    String(ticket).trim().toUpperCase(),
    String(venta.letra ?? '').trim().toUpperCase(),
    String(venta.fecha_emision ?? '').trim(),
    String(venta.client_id ?? '').trim().toUpperCase(),
    String(venta.codigo_producto ?? '').trim().toUpperCase(),
    String(venta.tipo_comprobante ?? 'venta'),
    venta.bonificacion === null || venta.bonificacion === undefined ? '-1' : String(venta.bonificacion),
  ];
  return parts.join('||');
};

// Último desempate determinístico: dos renglones que comparten hasta la bonificación
// se numeran por (cantidad, importe). Nunca se fusionan silenciosamente.
const asignarRenglones = (ventas: Record<string, any>[]) => {
  const grupos = new Map<string, Record<string, any>[]>();
  const sinClave: Record<string, any>[] = [];
  for (const v of ventas) {
    const key = buildVentaConflictKey(v);
    if (!key) { v.renglon = 1; sinClave.push(v); continue; }
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(v);
  }
  let colisiones = 0;
  for (const grupo of grupos.values()) {
    if (grupo.length > 1) colisiones += grupo.length - 1;
    grupo
      .sort((a, b) =>
        (Number(a.cajas ?? 0) - Number(b.cajas ?? 0)) ||
        (Number(a.facturacion_ars ?? 0) - Number(b.facturacion_ars ?? 0)))
      .forEach((v, i) => { v.renglon = i + 1; });
  }
  return { total: ventas.length, colisiones, sinClave: sinClave.length };
};

// === Campo de facturación: nombres de columna en orden de prioridad ===
// PRIORIDAD: Precio Total Final (con IVA, ~$511M) es la fuente oficial.
const FACTURACION_FIELD_NAMES = [
  'Precio Total Final', 'Precio Total Neto',
  'Facturación Ar$', 'Facturacion Ar$', 'Facturación Ars', 'Facturacion Ars',
  'facturacion_ars',
];

// OT8-fix: la bonificación distingue el renglón pagado del renglón de regalo (100%).
const BONIFICACION_FIELD_NAMES = [
  'Bonificación', 'Bonificacion', 'bonificacion',
  '% Bonificación', '% Bonificacion', '% Bonif', '% Bonif.',
  'Bonif', 'Bonif.', 'Bonif %', 'Descuento %', '% Descuento',
];


// === MAIN ===
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let supabase: SupabaseAdminClient | null = null;
  let batchId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    const accessToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, error: 'Sesión requerida' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ success: false, error: 'Sesión inválida o vencida' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from('profiles')
      .select('rol')
      .eq('user_id', authData.user.id)
      .single();
    // Roles en cascada: administrador ⊇ asignador
    if (profileError || (callerProfile?.rol !== 'asignador' && callerProfile?.rol !== 'administrador')) {
      return new Response(JSON.stringify({ success: false, error: 'Solo un asignador o administrador puede importar datos' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }

    const body = await req.json() as {
      rows: Record<string, any>[];
      replaceExisting?: boolean;
      notasCredito?: Record<string, any>[];
      fileMetadata?: FileMetadata;
      modoCarga?: 'rango' | 'rebase';
      confirmarEliminaciones?: boolean;
      confirmacionRebase?: string;
    };
    const rawRows = body.rows;
    const rawNotasCredito = Array.isArray(body.notasCredito) ? body.notasCredito : [];
    const replaceExisting = body.replaceExisting !== false; // default true
    const modoCarga: 'rango' | 'rebase' = body.modoCarga === 'rebase' ? 'rebase' : 'rango';
    const confirmarEliminaciones = body.confirmarEliminaciones === true;
    const confirmacionRebase = typeof body.confirmacionRebase === 'string' ? body.confirmacionRebase : '';

    if (modoCarga === 'rebase' && callerProfile?.rol !== 'administrador' && callerProfile?.rol !== 'asignador') {
      return new Response(JSON.stringify({ success: false, error: 'El reemplazo total solo lo puede ejecutar un administrador' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }


    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No rows provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }
    if (rawRows.length > 50_000 || rawNotasCredito.length > 50_000) {
      return new Response(JSON.stringify({ success: false, error: 'Cada hoja puede contener hasta 50.000 filas' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 413,
      });
    }

    const fileMetadata = body.fileMetadata || {};
    const lastModified = typeof fileMetadata.lastModified === 'number' && fileMetadata.lastModified > 0
      ? new Date(fileMetadata.lastModified).toISOString()
      : null;
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        tipo: 'ventas',
        version_etl: ETL_VERSION,
        archivo_nombre: fileMetadata.name || 'archivo_sin_nombre',
        archivo_sha256: fileMetadata.sha256 || null,
        archivo_tamano: fileMetadata.size ?? null,
        archivo_ultima_modificacion: lastModified,
        hoja: fileMetadata.sheetName || null,
        fila_encabezado: fileMetadata.headerRow ?? null,
        filas_origen: rawRows.length,
        filas_notas_credito: rawNotasCredito.length,
        reemplaza_existentes: replaceExisting,
        usuario_id: authData.user.id,
        usuario_email: authData.user.email || null,
      })
      .select('id')
      .single();
    if (batchError || !batch) throw new Error(`No se pudo crear el lote de importación: ${batchError?.message || 'sin detalle'}`);
    batchId = batch.id;

    const stageRows = async (sourceRows: Record<string, any>[], tipoFila: 'principal' | 'nota_credito') => {
      for (let i = 0; i < sourceRows.length; i += 500) {
        const stagingRows = sourceRows.slice(i, i + 500).map((payload, offset) => ({
          batch_id: batchId,
          tipo_fila: tipoFila,
          numero_fila: i + offset + 1,
          payload,
        }));
        const { error: stagingError } = await supabase!.from('import_staging_rows').insert(stagingRows);
        if (stagingError) throw new Error(`No se pudo preparar el lote: ${stagingError.message}`);
      }
    };
    await stageRows(rawRows, 'principal');
    if (rawNotasCredito.length > 0) {
      await stageRows(rawNotasCredito, 'nota_credito');
    }

    // Conciliación: toda fila que no llega a la base queda registrada con su motivo
    const filasDescartadas: { origen: 'venta' | 'nota_credito'; motivo: string; payload: Record<string, any> }[] = [];

    // OT8-fix: NO se descartan filas idénticas. Dos renglones iguales en el archivo
    // son dos renglones reales en la base (se distinguen con el ordinal de renglón).
    const rows = rawRows;
    const exactDuplicates = 0;

    console.log(`📦 ETL ${ETL_VERSION} — Recibidas ${rawRows.length} filas, procesando ${rows.length} únicas`);

    // ── TAREA 8: Log de columna de facturación resuelta ──
    const facturacionColumnResolved = rows.length > 0
      ? resolveFieldName(rows[0], FACTURACION_FIELD_NAMES)
      : null;
    console.log(`💰 Columna facturación: resuelta="${facturacionColumnResolved}" | evaluadas=${JSON.stringify(FACTURACION_FIELD_NAMES)}`);

    // ============ FASE 0: identidad comercial contra el maestro ============
    // El campo "ID" del informe de ventas NO es el Id oficial del maestro.
    // La identidad se resuelve por CUIT y nombre; "Número Externo" sólo se usa
    // cuando coincide con un client_id ya existente.
    const { data: clientesPersistidosData, error: clientesPersistidosError } = await supabase
      .from('clientes')
      .select('client_id, cuit_dni, razon_social, fantasia, telefonos, emails, direccion_principal, ciudad_principal, provincia_principal, vendedor_actual, vendedor_principal, etiquetas');
    if (clientesPersistidosError) {
      throw new Error(`No se pudo cargar el maestro para resolver clientes: ${clientesPersistidosError.message}`);
    }
    const clientesPersistidos = clientesPersistidosData || [];
    const existingClientIds = new Set<string>();
    const cuitToClientIds = new Map<string, string[]>();
    const nameToClientId = new Map<string, string>();
    const ambiguousNames = new Set<string>();

    for (const c of clientesPersistidos) {
      existingClientIds.add(c.client_id);
      if (c.cuit_dni) {
        const ids = cuitToClientIds.get(c.cuit_dni) || [];
        if (!ids.includes(c.client_id)) ids.push(c.client_id);
        cuitToClientIds.set(c.cuit_dni, ids);
      }
      for (const rawName of [c.razon_social, c.fantasia]) {
        const normalized = normalizeBusinessName(rawName);
        if (!normalized || ambiguousNames.has(normalized)) continue;
        const previous = nameToClientId.get(normalized);
        if (previous && previous !== c.client_id) {
          nameToClientId.delete(normalized);
          ambiguousNames.add(normalized);
        } else {
          nameToClientId.set(normalized, c.client_id);
        }
      }
    }
    console.log(`🔍 Fase 0: ${clientesPersistidos.length} clientes del maestro disponibles para conciliación`);

    // ============ FASE 1: Normalizar ventas individuales ============
    const ventasRaw: any[] = [];
    const clientesMap = new Map<string, any>();
    // Coordenadas reales que vienen en el propio informe de ventas (Latitud/Longitud)
    const coordsPorCliente = new Map<string, { lat: number; long: number; direccion: string | null; codigo_postal: string | null; ciudad: string | null; provincia: string | null }>();
    let ventasSinClientId = 0;
    let ventasCuitAmbiguo = 0;
    let facturacionNullCount = 0;
    // TAREA 12: Track descartados sin client_id
    const descartados: { cuit_dni: string | null; razon_social: string | null }[] = [];

    // Identidad estable dentro del propio archivo: filas con el mismo CUIT (o la
    // misma razón social cuando no hay CUIT) deben caer en el mismo client_id.
    const localCuitToId = new Map<string, string>();
    const localNameToId = new Map<string, string>();

    // Resolución de identidad reutilizable: la usan la hoja de producto y la de
    // comprobantes, para que ambas caigan exactamente en el mismo client_id.
    const resolverIdentidad = (row: Record<string, any>) => {
      const externalClientId = normalizeClientId(getFieldValue(row, ['client_id', 'Número Externo', 'Numero Externo']));
      const cuit_dni = normalizeCuit(getFieldValue(row, ['CUIT / DNI', 'CUIT/DNI', 'CUIT DNI', 'cuit_dni']));
      const razon_social = toStr(getFieldValue(row, ['Razón Social', 'Razon Social', 'razon_social']));
      const fantasia = toStr(getFieldValue(row, ['Fantasía', 'Fantasia', 'fantasia']));
      const nameKey = normalizeBusinessName(razon_social) || normalizeBusinessName(fantasia) || null;
      const nameMatch = nameToClientId.get(normalizeBusinessName(razon_social) || '')
        || nameToClientId.get(normalizeBusinessName(fantasia) || '');
      const cuitMatches = cuit_dni ? (cuitToClientIds.get(cuit_dni) || []) : [];
      let client_id: string | null = null;
      let cuitAmbiguo = false;

      // El CUIT manda sobre el "Número Externo": ese Id viene por comprobante y
      // usarlo primero crea un cliente nuevo por cada factura.
      if (cuitMatches.length === 1) {
        client_id = cuitMatches[0];
      } else if (cuit_dni && localCuitToId.has(cuit_dni)) {
        client_id = localCuitToId.get(cuit_dni)!;
      } else if (nameMatch && (cuitMatches.length === 0 || cuitMatches.includes(nameMatch))) {
        client_id = nameMatch;
      } else if (cuitMatches.length > 1) {
        cuitAmbiguo = true;
      } else if (nameMatch) {
        client_id = nameMatch;
      } else if (!cuit_dni && nameKey && localNameToId.has(nameKey)) {
        client_id = localNameToId.get(nameKey)!;
      } else if (cuit_dni) {
        client_id = cuit_dni;
      } else if (externalClientId && existingClientIds.has(externalClientId)) {
        client_id = externalClientId;
      }

      // Fix 1: identidad sintética desde la razón social cuando no hay Id ni CUIT
      if (!client_id && razon_social) {
        client_id = `RS_${razon_social.trim().toUpperCase().replace(/\s+/g, ' ')}`;
      }

      if (client_id) {
        if (cuit_dni && !localCuitToId.has(cuit_dni)) localCuitToId.set(cuit_dni, client_id);
        if (!cuit_dni && nameKey && !localNameToId.has(nameKey)) localNameToId.set(nameKey, client_id);
      }

      return { client_id, cuit_dni, razon_social, fantasia, cuitAmbiguo };
    };

    for (const row of rows) {
      const identidad = resolverIdentidad(row);
      const { cuit_dni, razon_social, fantasia } = identidad;
      const client_id = identidad.client_id;
      if (identidad.cuitAmbiguo) ventasCuitAmbiguo++;

      const ticket = toStr(getFieldValue(row, ['Ticket', 'ticket', 'Comprobante', 'comprobante']));
      const letra = toStr(getFieldValue(row, ['Letra', 'letra']));
      const fecha_raw = getFieldValue(row, ['Fecha Emisión', 'Fecha Emision', 'fecha_emision', 'Fecha', 'fecha']);
      const fecha_iso = parseDate(fecha_raw);
      const cajas = parseNumericValue(getFieldValue(row, ['Cajas', 'cajas', 'Cantidad', 'cantidad']));
      const codigo_producto = toStr(getFieldValue(row, ['Código Producto', 'Codigo Producto', 'codigo_producto', 'Código', 'Codigo']));
      const producto = toStr(getFieldValue(row, ['Nombre', 'nombre', 'Producto', 'producto', 'Descripción', 'Descripcion']));
      const marca = toStr(getFieldValue(row, ['Marca', 'marca']));
      // El informe nuevo puede traer el vendedor vacío y el nombre en "Operador"
      const vendedor = toStr(getFieldValue(row, ['Vendedor', 'vendedor']))
        || toStr(getFieldValue(row, ['Operador', 'operador']));

      const telefono = toStr(getFieldValue(row, ['Teléfono', 'Telefono', 'telefono']));
      const celular = toStr(getFieldValue(row, ['Celular', 'celular']));
      const correo = toStr(getFieldValue(row, ['Correo', 'correo', 'Email', 'email']));
      // R7: la dirección útil es Calle + Número (la altura viene en su propia columna)
      const calleRaw = toStr(getFieldValue(row, ['Dirección', 'Direccion', 'direccion', 'Calle']));
      const numeroCalleRaw = toStr(getFieldValue(row, ['Número', 'Numero', 'numero', 'Altura', 'Nro', 'N°']));
      const codigoPostalRaw = toStr(getFieldValue(row, ['Código Postal', 'Codigo Postal', 'CP', 'cp', 'codigo_postal']));
      const direccion = calleRaw
        ? ((numeroCalleRaw && new RegExp(`(^|\\s)${numeroCalleRaw}(\\s|$)`).test(calleRaw)
            ? calleRaw
            : [calleRaw, numeroCalleRaw].filter(Boolean).join(' ')).trim() || null)
        : null;
      const ciudad_raw = toStr(getFieldValue(row, ['Ciudad', 'ciudad', 'Localidad', 'localidad']));
      const provincia_raw = toStr(getFieldValue(row, ['Provincia', 'provincia']));
      const pais = toStr(getFieldValue(row, ['País', 'Pais', 'pais']));
      const categorias = toStr(getFieldValue(row, ['Categorías', 'Categorias', 'categorias']));
      const facturacion = parseNumericValue(getFieldValue(row, FACTURACION_FIELD_NAMES));
      if (facturacion === null || facturacion === undefined) facturacionNullCount++;
      const bonificacion = parseNumericValue(getFieldValue(row, BONIFICACION_FIELD_NAMES));

      if (!client_id) {
        ventasSinClientId += 1;
        descartados.push({ cuit_dni, razon_social });
        filasDescartadas.push({ origen: 'venta', motivo: 'sin_identidad_cliente', payload: row });
        continue;
      }

      // OT8-fix: el renglón de regalo factura $0 por definición y SIEMPRE se ingesta.
      ventasRaw.push({
        client_id,
        ticket, letra, fecha_emision: fecha_iso, cuit_dni, razon_social, fantasia,
        cajas, codigo_producto, nombre: producto, marca,
        facturacion_ars: facturacion === null || facturacion === undefined ? 0 : facturacion,
        bonificacion,
        vendedor, telefono, celular, correo, direccion, ciudad: ciudad_raw,
        provincia: provincia_raw, pais, categorias,
        tipo_comprobante: 'venta',
      });


      // Coordenadas del informe (si vienen y son válidas para Argentina)
      const latRaw = parseNumericValue(getFieldValue(row, ['Latitud', 'latitud', 'Lat', 'lat']));
      const lngRaw = parseNumericValue(getFieldValue(row, ['Longitud', 'longitud', 'Lng', 'lng', 'Long', 'long']));
      if (
        latRaw !== null && lngRaw !== null &&
        Number.isFinite(latRaw) && Number.isFinite(lngRaw) &&
        latRaw >= -56 && latRaw <= -21 && lngRaw >= -74 && lngRaw <= -53
      ) {
        coordsPorCliente.set(client_id, {
          lat: latRaw,
          long: lngRaw,
          direccion,
          codigo_postal: codigoPostalRaw,
          ciudad: ciudad_raw,
          provincia: normalizeProvincia(provincia_raw),
        });
      }
    }


    // ============ FASE 1a: Notas de crédito (importes negativos) ============
    // Las hojas de NC no traen CUIT, sólo Razón Social. Primero se cruzan
    // contra las ventas del archivo y luego contra el maestro persistido. Esto
    // permite netear notas de clientes que no tuvieron una venta en el período.
    let notasCreditoAplicadas = 0;
    let notasCreditoSinMatch = 0;
    let notasCreditoDuplicadas = 0;
    let notasCreditoSinImporte = 0;
    let montoNCProducto = 0;
    let montoNCConcepto = 0;
    let montoNotasCredito = 0;

    if (rawNotasCredito.length > 0) {
      const rsToClient = new Map<string, any>();
      for (const v of ventasRaw) {
        const key = normalizeBusinessName(v.razon_social);
        if (key && !rsToClient.has(key)) {
          rsToClient.set(key, v);
        }
      }

      for (const c of clientesPersistidos) {
        const base = {
          client_id: c.client_id,
          cuit_dni: c.cuit_dni,
          razon_social: c.razon_social,
          fantasia: c.fantasia,
          vendedor: c.vendedor_actual || c.vendedor_principal,
          telefono: c.telefonos?.[0] || null,
          celular: c.telefonos?.[1] || null,
          correo: c.emails?.[0] || null,
          direccion: c.direccion_principal,
          ciudad: c.ciudad_principal,
          provincia: c.provincia_principal,
          pais: 'Argentina',
          categorias: Array.isArray(c.etiquetas) ? c.etiquetas.join(', ') : null,
        };
        for (const nombre of [c.razon_social, c.fantasia]) {
          const key = normalizeBusinessName(nombre);
          if (key && !rsToClient.has(key)) rsToClient.set(key, base);
        }
      }

      // OT8-fix: no se descartan NC idénticas; el ordinal de renglón las distingue.
      for (const row of rawNotasCredito) {
        const razon_social = toStr(getFieldValue(row, ['Razón Social', 'Razon Social', 'razon_social']));
        if (!razon_social) {
          notasCreditoSinMatch++;
          filasDescartadas.push({ origen: 'nota_credito', motivo: 'sin_razon_social', payload: row });
          continue;
        }
        const base = rsToClient.get(normalizeBusinessName(razon_social) || '');
        if (!base) {
          notasCreditoSinMatch++;
          filasDescartadas.push({ origen: 'nota_credito', motivo: 'cliente_no_conciliado', payload: row });
          continue;
        }

        const importe = parseNumericValue(
          getFieldValue(row, ['Total Final', 'Precio Total Final', 'Importe No Gravado', 'Importe Neto'])
        );
        // OT8-fix: importe 0 es válido (renglón bonificado al 100%). Solo se descarta si NO hay importe.
        if (importe === null || importe === undefined) {
          notasCreditoSinImporte++;
          filasDescartadas.push({ origen: 'nota_credito', motivo: 'sin_importe', payload: row });
          continue;
        }
        const monto = -Math.abs(importe);
        // OT3: la columna "Tipo" separa devolución de mercadería (dispara flag de recupero)
        // de las notas por concepto (pronto pago, descuentos), que NO son un problema comercial.
        const tipoNC = toStr(getFieldValue(row, ['Tipo', 'tipo', 'Tipo Comprobante', 'Concepto'])) || '';
        const esConcepto = /concepto|pronto\s*pago|descuento|bonific|financier|interes|inter\u00e9s/i.test(tipoNC);
        if (esConcepto) montoNCConcepto += Math.abs(importe); else montoNCProducto += Math.abs(importe);

        ventasRaw.push({
          client_id: base.client_id,
          ticket: toStr(getFieldValue(row, ['Ticket', 'ticket'])),
          letra: 'NC',
          fecha_emision: parseDate(getFieldValue(row, ['Fecha Emisión', 'Fecha Emision', 'fecha_emision'])),
          cuit_dni: base.cuit_dni,
          razon_social,
          fantasia: base.fantasia,
          cajas: parseNumericValue(getFieldValue(row, ['Cajas', 'cajas', 'Cantidad', 'cantidad'])),
          bonificacion: parseNumericValue(getFieldValue(row, BONIFICACION_FIELD_NAMES)),
          codigo_producto: toStr(getFieldValue(row, ['Código', 'Codigo', 'Código Producto'])),
          nombre: toStr(getFieldValue(row, ['Nombre', 'nombre'])),
          marca: null,
          facturacion_ars: monto,
          vendedor: base.vendedor || toStr(getFieldValue(row, ['Operador', 'operador'])),
          telefono: base.telefono, celular: base.celular, correo: base.correo,
          direccion: base.direccion, ciudad: base.ciudad, provincia: base.provincia,
          pais: base.pais, categorias: base.categorias,
          tipo_comprobante: esConcepto ? 'nota_credito_concepto' : 'nota_credito',
        });
        notasCreditoAplicadas++;
        montoNotasCredito += monto;
      }
      console.log(`🧾 Notas de crédito: ${notasCreditoAplicadas} aplicadas, ${notasCreditoSinMatch} sin match, ${notasCreditoDuplicadas} duplicadas, ${notasCreditoSinImporte} sin importe, monto ${Math.round(montoNotasCredito)}`);

    }

    if (facturacionNullCount > 0) {
      console.log(`⚠️ ${facturacionNullCount} filas con facturación null (columna: ${facturacionColumnResolved})`);
    }

    if (replaceExisting && (ventasSinClientId > 0 || facturacionNullCount > 0 || notasCreditoSinMatch > 0)) {
      throw new Error(
        `Carga completa rechazada por integridad: ${ventasSinClientId} filas sin cliente, ` +
        `${facturacionNullCount} sin facturación y ${notasCreditoSinMatch} notas de crédito sin conciliar. ` +
        'No se modificaron las ventas existentes.'
      );
    }


    // ============ FASE 1b: Numerar renglones (OT8-fix, ya NO se fusiona nada) ============
    const renglonStats = asignarRenglones(ventasRaw);
    const ventasDuplicadas = renglonStats.colisiones;
    const ventasDeduplicadas = ventasRaw;

    if (ventasDeduplicadas.length === 0) {
      throw new Error('El archivo no produjo ninguna venta válida. No se modificaron las ventas existentes.');
    }

    if (ventasDuplicadas > 0) {
      console.log(`🔢 ${ventasDuplicadas} renglones comparten clave natural: se numeran con ordinal determinístico (total ${ventasDeduplicadas.length})`);
    }

    // ── TAREA 2: Validación de unicidad de tickets cross-client ──
    const ticketToClients = new Map<string, Set<string>>();
    for (const venta of ventasDeduplicadas) {
      if (venta.ticket && venta.client_id) {
        const tKey = `${venta.ticket}||${venta.letra || ''}||${venta.fecha_emision || ''}`;
        if (!ticketToClients.has(tKey)) ticketToClients.set(tKey, new Set());
        ticketToClients.get(tKey)!.add(venta.client_id);
      }
    }
    const ticketsCompartidos = Array.from(ticketToClients.entries())
      .filter(([, clients]) => clients.size > 1);
    if (ticketsCompartidos.length > 0) {
      console.log(`⚠️ ${ticketsCompartidos.length} tickets compartidos entre múltiples clientes`);
      ticketsCompartidos.slice(0, 5).forEach(([tk, cls]) => {
        console.log(`  ticket=${tk} → clientes: ${Array.from(cls).join(', ')}`);
      });
    }

    // ============ FASE 2: Agregar clientes desde ventas DEDUPLICADAS ============
    for (const venta of ventasDeduplicadas) {
      const { client_id, cuit_dni, razon_social, fantasia, direccion, ciudad: ciudad_raw,
              vendedor, facturacion_ars: facturacion, nombre: producto, cajas,
              categorias, telefono, celular, correo, fecha_emision: fecha_iso } = venta;

      const geo = normalizarGeografia(ciudad_raw);
      // Fix 6: Normalizar provincia del Excel Y de la geo
      const provinciaFinal = normalizeProvincia(geo.provincia) || normalizeProvincia(venta.provincia) || geo.provincia;

      if (!clientesMap.has(client_id)) {
        clientesMap.set(client_id, {
          client_id, cuit_dni, razon_social, fantasia,
          barrios: new Set<string>(), comunas: new Set<string>(), ciudades: new Set<string>(),
          provincias: new Set<string>(), direcciones: new Set<string>(), vendedores: new Set<string>(),
          productos: new Set<string>(), categorias_set: new Set<string>(),
          telefonos: new Set<string>(), emails: new Set<string>(),
          monto_total: 0,
          // TAREA 1: Set para tickets únicos en vez de contador
          tickets_set: new Set<string>(),
          cantidad_lineas: 0,
          fechas: [] as Date[],
          // Track vendedor de la venta más reciente
          ultima_fecha_venta: null as Date | null,
          vendedor_ultima_venta: null as string | null,
        });
      }

      const c = clientesMap.get(client_id)!;
      if (geo.barrio) c.barrios.add(geo.barrio);
      if (geo.comuna) c.comunas.add(geo.comuna);
      if (geo.ciudad) c.ciudades.add(geo.ciudad);
      if (provinciaFinal) c.provincias.add(provinciaFinal);
      if (direccion) c.direcciones.add(direccion);
      if (vendedor) c.vendedores.add(vendedor);
      if (telefono) c.telefonos.add(telefono);
      if (celular) c.telefonos.add(celular);
      if (correo) c.emails.add(correo);
      if (producto) {
        c.productos.add(cajas ? `${producto} (${cajas} u.)` : producto);
      }
      if (categorias) {
        categorias.split(/[/|,;]/).forEach((cat: string) => { const t = cat.trim(); if (t) c.categorias_set.add(t); });
      }
      // R4: el monto histórico es BRUTO. Las notas de crédito viven en columnas aparte
      // (monto_nc_producto / monto_nc_concepto) y nunca se restan acá.
      const esNotaCredito = String(venta.tipo_comprobante || '').startsWith('nota_credito');
      if (!esNotaCredito) c.monto_total += facturacion || 0;
      if (!esNotaCredito) c.cantidad_lineas += 1;

      // TAREA 1: Contar comprobantes únicos (ticket + letra + fecha) via Set.
      // Las notas de crédito netean el monto pero NO cuentan como órdenes
      if (venta.ticket && !esNotaCredito) {
        c.tickets_set.add(`${venta.ticket}|${venta.letra || ''}|${venta.fecha_emision || ''}`);
      }


      if (fecha_iso && !esNotaCredito) {
        const d = new Date(fecha_iso);
        c.fechas.push(d);
        // Track vendedor de la venta más reciente para vendedor_actual
        if (vendedor && (!c.ultima_fecha_venta || d > c.ultima_fecha_venta)) {
          c.ultima_fecha_venta = d;
          c.vendedor_ultima_venta = vendedor;
        }
      }

      c.razon_social = razon_social || c.razon_social;
      c.fantasia = fantasia || c.fantasia;
    }

    // ============ FASE 3: RFM + scores ============
    const ahora = new Date();

    const totalGlobal = Array.from(clientesMap.values()).reduce((sum, c) => sum + c.monto_total, 0);

    const clientesEnriquecidos = Array.from(clientesMap.values()).map(c => {
      const fechasOrd = [...c.fechas].sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const primera = fechasOrd[0] || null;
      const ultima = fechasOrd[fechasOrd.length - 1] || null;
      const dias = ultima ? Math.floor((ahora.getTime() - ultima.getTime()) / 86400000) : 9999;

      const montoTotal = c.monto_total;
      const cantidadOrdenes = c.tickets_set.size > 0 ? c.tickets_set.size : (c.cantidad_lineas > 0 ? 1 : 0);
      const ticket_promedio = cantidadOrdenes > 0 ? Math.round((montoTotal / cantidadOrdenes) * 100) / 100 : 0;

      let categoria_recencia = 'PERDIDO', score_recencia = 10;
      if (dias <= DIAS_ACTIVO) { categoria_recencia = 'ACTIVO'; score_recencia = 100; }
      else if (dias <= DIAS_INTERMITENTE) { categoria_recencia = 'INTERMITENTE'; score_recencia = 70; }
      else if (dias <= DIAS_INACTIVO) { categoria_recencia = 'INACTIVO'; score_recencia = 40; }

      const participacion = totalGlobal > 0 ? montoTotal / totalGlobal : 0;
      let categoria_volumen = 'BAJO', score_volumen = 25;
      if (participacion >= 0.10) { categoria_volumen = 'TOP_10'; score_volumen = 100; }
      else if (participacion >= 0.05) { categoria_volumen = 'ALTO'; score_volumen = 75; }
      else if (participacion >= 0.02) { categoria_volumen = 'MEDIO'; score_volumen = 50; }

      const score_comercial = Math.round(score_volumen * 0.4 + score_recencia * 0.6);

      let canal = 'OFF_TRADE';
      const catStr = Array.from(c.categorias_set).join(' ').toUpperCase();
      if (catStr.includes('RESTAURANT') || catStr.includes('HOTEL') || catStr.includes('GASTRONOMIA') || catStr.includes('ONTRADE')) {
        canal = 'ON_TRADE';
      }

      return {
        client_id: c.client_id,
        cuit_dni: c.cuit_dni, razon_social: c.razon_social, fantasia: c.fantasia,
        telefonos: Array.from(c.telefonos), emails: Array.from(c.emails),
        primera_compra: primera ? primera.toISOString().split('T')[0] : null,
        ultima_compra: ultima ? ultima.toISOString().split('T')[0] : null,
        dias_desde_ultima_compra: dias === 9999 ? null : dias,
        cantidad_ordenes: cantidadOrdenes,
        monto_total_historico: Math.round(montoTotal * 100) / 100,
        monto_total_cupra: Math.round(montoTotal * 100) / 100,
        share_cupra: 100,
        fuente_monto: 'producto',
        ticket_promedio, categoria_recencia, categoria_volumen,
        score_recencia, score_volumen, score_comercial,
        participacion_mercado: Math.round(participacion * 10000) / 100,
        barrio_principal: mode(c.barrios), ciudad_principal: mode(c.ciudades),
        provincia_principal: mode(c.provincias), direccion_principal: mode(c.direcciones),
        vendedor_principal: mode(c.vendedores),
        // TAREA 3: vendedor_actual = vendedor de la venta más reciente
        vendedor_actual: c.vendedor_ultima_venta || mode(c.vendedores),
        productos_comprados: Array.from(c.productos),
        todos_barrios: Array.from(c.barrios), todas_ciudades: Array.from(c.ciudades),
        todas_direcciones: Array.from(c.direcciones), todos_vendedores: Array.from(c.vendedores),
        requiere_visita: dias > 15 ? 'SI' : 'NO', canal, etiquetas: [],
      };
    });

    // ── TAREA 9: Reconciliación — totales para validación ──
    const totalFacturacionProcesada = Math.round(totalGlobal * 100) / 100;
    const totalTicketsUnicos = Array.from(clientesMap.values()).reduce((sum, c) => sum + c.tickets_set.size, 0);
    const totalClientesUnicos = clientesMap.size;
    // Fix 3: Count clients by normalized razon_social
    const razonSocialSet = new Set<string>();
    for (const c of clientesMap.values()) {
      if (c.razon_social) {
        razonSocialSet.add(c.razon_social.trim().toUpperCase().replace(/\s+/g, ' '));
      }
    }
    const totalClientesRazonSocial = razonSocialSet.size;

    console.log(`🧮 ${clientesEnriquecidos.length} clientes | ${ventasDeduplicadas.length} líneas deduplicadas | ${totalTicketsUnicos} tickets únicos | $${Math.round(totalGlobal).toLocaleString()} total`);

    // ── TAREA 7: Umbrales de calidad ──
    const sinBarrio = clientesEnriquecidos.filter(c => !c.barrio_principal).length;
    const sinVendedor = clientesEnriquecidos.filter(c => !c.vendedor_actual && !c.vendedor_principal).length;
    const pctSinBarrio = totalClientesUnicos > 0 ? Math.round(sinBarrio / totalClientesUnicos * 100) : 0;
    const pctSinVendedor = totalClientesUnicos > 0 ? Math.round(sinVendedor / totalClientesUnicos * 100) : 0;

    const calidad = {
      pct_sin_barrio: pctSinBarrio,
      pct_sin_vendedor: pctSinVendedor,
      pct_sin_client_id: rows.length > 0 ? Math.round(ventasSinClientId / rows.length * 100) : 0,
      clientes_sin_barrio: sinBarrio,
      clientes_sin_vendedor: sinVendedor,
      alerta: pctSinBarrio > UMBRAL_PCT_SIN_BARRIO || pctSinVendedor > UMBRAL_PCT_SIN_VENDEDOR,
    };

    if (calidad.alerta) {
      console.log(`🚨 ALERTA CALIDAD: ${pctSinBarrio}% sin barrio (umbral ${UMBRAL_PCT_SIN_BARRIO}%), ${pctSinVendedor}% sin vendedor (umbral ${UMBRAL_PCT_SIN_VENDEDOR}%)`);
    }

    // ============ FASE 4: Upsert clientes PRIMERO (para satisfacer FK de ventas) ============
    const results = { ventas_procesadas: 0, ventas_errores: 0, clientes_actualizados: 0, clientes_errores: 0, errores: [] as string[] };

    if (ventasSinClientId > 0) {
      results.ventas_errores += ventasSinClientId;
      results.errores.push(`Filas omitidas sin identidad de cliente resoluble: ${ventasSinClientId}`);
    }
    if (ventasCuitAmbiguo > 0) {
      results.errores.push(`Filas con CUIT duplicado en el maestro y nombre sin coincidencia: ${ventasCuitAmbiguo}`);
    }

    const allClientIds = clientesEnriquecidos.map(c => String(c.client_id));
    let existingSet = new Set<string>();

    if (allClientIds.length > 0) {
      const { data: existingClients } = await supabase
        .from('clientes')
        .select('client_id')
        .in('client_id', allClientIds);
      existingSet = new Set((existingClients || []).map(c => c.client_id));
    }

    const newClients = clientesEnriquecidos.filter(c => !existingSet.has(String(c.client_id)));
    const updateClients = clientesEnriquecidos.filter(c => existingSet.has(String(c.client_id)));

    if (newClients.length > 0) {
      const { error } = await supabase.from('clientes').insert(
        newClients.map(c => ({
          ...c, client_id: String(c.client_id),
          excluir_recomendaciones: false, last_recommendation_at: null, ultima_visita: null,
        }))
      );
      if (error) {
        console.error('❌ New clients:', error.message);
        results.clientes_errores += newClients.length;
        results.errores.push(`New clients: ${error.message}`);
      } else {
        results.clientes_actualizados += newClients.length;
      }
    }

    // Update existing clients (protect internal fields)
    const camposVentas = [
      'cuit_dni', 'razon_social', 'fantasia', 'telefonos', 'emails',
      'primera_compra', 'ultima_compra', 'dias_desde_ultima_compra',
      'cantidad_ordenes', 'monto_total_historico', 'monto_total_cupra', 'share_cupra', 'fuente_monto', 'ticket_promedio',
      'categoria_recencia', 'categoria_volumen', 'score_recencia', 'score_volumen', 'score_comercial',
      'participacion_mercado', 'vendedor_principal', 'vendedor_actual', 'productos_comprados',
      'todos_barrios', 'todas_ciudades', 'todas_direcciones', 'todos_vendedores',
      'requiere_visita', 'canal', 'etiquetas',
      'barrio_principal', 'ciudad_principal', 'provincia_principal', 'direccion_principal',
    ];

    // El maestro de clientes manda sobre el vendedor de cartera y las etiquetas:
    // si ya hay valor cargado desde el maestro, las ventas no lo pisan.
    const maestroPorCliente = new Map<string, { vendedor_actual: string | null; etiquetas: string[] | null }>();
    {
      const idsUpdate = updateClients.map((c: any) => String(c.client_id));
      for (let i = 0; i < idsUpdate.length; i += 400) {
        const batch = idsUpdate.slice(i, i + 400);
        const { data } = await supabase
          .from('clientes')
          .select('client_id, vendedor_actual, etiquetas')
          .in('client_id', batch);
        for (const c of data || []) {
          maestroPorCliente.set(c.client_id, {
            vendedor_actual: c.vendedor_actual,
            etiquetas: c.etiquetas as string[] | null,
          });
        }
      }
    }

    for (const c of updateClients) {
      const updateData: Record<string, any> = {};
      for (const campo of camposVentas) {
        updateData[campo] = (c as any)[campo];
      }
      const prev = maestroPorCliente.get(String(c.client_id));
      // Regla de negocio: manda el ÚLTIMO que vendió. Sólo se conserva el
      // vendedor del maestro cuando las ventas no permiten determinarlo.
      if (!updateData.vendedor_actual && prev?.vendedor_actual) delete updateData.vendedor_actual;

      // No borrar etiquetas/categorías del maestro con un array vacío
      if (!updateData.etiquetas || updateData.etiquetas.length === 0) {
        if (prev?.etiquetas && prev.etiquetas.length > 0) delete updateData.etiquetas;
      }
      const { error } = await supabase.from('clientes').update(updateData).eq('client_id', String(c.client_id));
      if (error) {
        results.clientes_errores++;
        results.errores.push(`Update ${c.client_id}: ${error.message}`);
      } else {
        results.clientes_actualizados++;
      }
    }

    // ============ FASE 4b: Coordenadas del ERP → client_places (R7 / OT7) ============
    // Prioridad: corrección manual > coordenadas del ERP > geocoding por texto.
    // No se marca primario acá: al final `reconciliar_places_primarios()` deja
    // un único primario por cliente eligiendo la fuente más confiable.
    let coordenadasGuardadas = 0;
    if (coordsPorCliente.size > 0) {
      const idsValidos = new Set(clientesEnriquecidos.map(c => String(c.client_id)));
      const candidatos = Array.from(coordsPorCliente.entries())
        .filter(([cid]) => idsValidos.has(String(cid)));

      // Nunca pisar una corrección manual con el Excel
      const verificadosSet = new Set<string>();
      const idsCandidatos = candidatos.map(([cid]) => String(cid));
      for (let i = 0; i < idsCandidatos.length; i += 200) {
        const batch = idsCandidatos.slice(i, i + 200);
        const { data: verificados } = await supabase
          .from('client_places')
          .select('client_id')
          .in('client_id', batch)
          .eq('direccion_verificada', true);
        (verificados || []).forEach((v: any) => verificadosSet.add(String(v.client_id)));
      }

      const places = candidatos
        .filter(([cid]) => !verificadosSet.has(String(cid)))
        .map(([cid, p]) => ({
          client_id: String(cid),
          lat: p.lat,
          long: p.long,
          direccion_principal: p.direccion,
          codigo_postal: p.codigo_postal,
          provincia_principal: p.provincia,
          fuente_geocoding: 'excel',
          is_primary: false,
        }));

      for (let i = 0; i < places.length; i += 300) {
        const batch = places.slice(i, i + 300);
        const { error } = await supabase
          .from('client_places')
          .upsert(batch, { onConflict: 'client_id,lat,long', ignoreDuplicates: false });
        if (error) {
          console.error(`❌ client_places batch ${i}:`, error.message);
          results.errores.push(`Coordenadas batch ${i}: ${error.message}`);
        } else {
          coordenadasGuardadas += batch.length;
        }
      }
      console.log(`📍 Coordenadas del informe guardadas: ${coordenadasGuardadas}/${places.length}`);
    }
    (results as any).coordenadas_guardadas = coordenadasGuardadas;

    {
      const { error: reconError } = await supabase.rpc('reconciliar_places_primarios');
      if (reconError) {
        console.error('⚠️ No se pudo reconciliar ubicaciones primarias:', reconError.message);
        results.errores.push(`Ubicaciones primarias: ${reconError.message}`);
      }
    }


    console.log(`👥 Clientes procesados: ${results.clientes_actualizados} ok, ${results.clientes_errores} errores`);

    if (results.clientes_errores > 0) {
      throw new Error(
        `La carga se detuvo porque ${results.clientes_errores} clientes no pudieron actualizarse. No se modificaron las ventas existentes.`
      );
    }

    // ============ FASE 5: Insert/Upsert ventas (R8: reemplazo por rango) ============
    // El archivo es la verdad SOLO para su propio rango de fechas.
    // Nunca se borra el histórico completo desde acá: eso es una acción de admin (rebase_ventas_cupra).
    const { data: previaRango } = await supabase.rpc('preview_ventas_import', {
      p_rows: ventasDeduplicadas,
    });

    let rangoCarga: Record<string, any> | null = null;

    if (modoCarga === 'rebase') {
      const { data: rebased, error: rebaseError } = await supabase.rpc('rebase_ventas_cupra', {
        p_rows: ventasDeduplicadas,
        p_batch_id: batchId,
        p_confirmacion: confirmacionRebase || '',
      });
      if (rebaseError) throw new Error(rebaseError.message);
      rangoCarga = { ...(previaRango || {}), ...(rebased || {}), modo: 'rebase' };
      results.ventas_procesadas = Number((rebased as any)?.filas_insertadas || 0);
    } else {
      const { data: committed, error: commitError } = await supabase.rpc('commit_ventas_import_rango', {
        p_rows: ventasDeduplicadas,
        p_batch_id: batchId,
        p_confirmar_eliminaciones: confirmarEliminaciones,
      });
      if (commitError) {
        const err: any = new Error(commitError.message);
        err.previa = previaRango || null;
        throw err;
      }
      rangoCarga = { ...(previaRango || {}), ...((committed as any) || {}), modo: 'rango' };
      results.ventas_procesadas = Number((committed as any)?.total_procesadas || 0);
    }


    // ── TAREA 11: Consistencia clientes ↔ ventas_cupra (post-carga check) ──
    // Solo reportamos las discrepancias, no corregimos aquí
    const discrepancias: string[] = [];
    if (Math.abs(totalFacturacionProcesada - totalGlobal) > 1) {
      discrepancias.push('Discrepancia interna en facturación total procesada');
    }

    console.log('🎉 Proceso completo:', results);

    // ── TAREA 10, 12: Metadata y descartados ──
    // OT3: única fuente de verdad de cadencia, precio por caja y notas de crédito.
    // Se recalcula al final de CADA importación, no en un backfill manual.
    let metricasRecalculadas = 0;
    try {
      const { data: recomputed, error: recomputeError } = await supabase.rpc('recompute_client_metrics');
      if (recomputeError) {
        console.error('⚠️ No se pudieron recalcular las métricas de clientes:', recomputeError.message);
        results.errores.push(`No se pudieron recalcular métricas de clientes: ${recomputeError.message}`);
      } else {
        metricasRecalculadas = Number(recomputed) || 0;
        console.log(`📐 Métricas recalculadas para ${metricasRecalculadas} clientes.`);
      }
    } catch (err) {
      console.error('⚠️ Error recalculando métricas:', err);
    }

    const metadata = {
      fecha_carga: new Date().toISOString(),
      version_etl: ETL_VERSION,
      columna_facturacion: facturacionColumnResolved,
      columnas_evaluadas: FACTURACION_FIELD_NAMES,
      filas_origen: rows.length,
      filas_facturacion_null: facturacionNullCount,
    };

    // Fix 4: Per-vendor breakdown for reconciliation
    const vendedorBreakdown: { vendedor: string; monto: number; registros: number }[] = [];
    const vendedorAgg = new Map<string, { monto: number; registros: number }>();
    for (const v of ventasDeduplicadas) {
      const vend = v.vendedor || 'Sin vendedor';
      if (!vendedorAgg.has(vend)) vendedorAgg.set(vend, { monto: 0, registros: 0 });
      const entry = vendedorAgg.get(vend)!;
      entry.monto += v.facturacion_ars || 0;
      entry.registros += 1;
    }
    for (const [vendedor, data] of vendedorAgg.entries()) {
      vendedorBreakdown.push({ vendedor, monto: Math.round(data.monto * 100) / 100, registros: data.registros });
    }
    vendedorBreakdown.sort((a, b) => b.monto - a.monto);

    const ventasInsertadas = ventasDeduplicadas.filter(v => !String(v.tipo_comprobante || '').startsWith('nota_credito')).length;
    const notasInsertadas = ventasDeduplicadas.length - ventasInsertadas;
    const motivosDescarte = filasDescartadas.reduce((acc, f) => {
      const key = `${f.origen}:${f.motivo}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const reconciliacion = {
      filas_excel: rows.length,
      filas_excel_recibidas: rawRows.length,
      filas_excel_notas_credito: rawNotasCredito.length,
      notas_credito_aplicadas: notasCreditoAplicadas,
      notas_credito_sin_match: notasCreditoSinMatch,
      notas_credito_duplicadas: notasCreditoDuplicadas,
      notas_credito_sin_importe: notasCreditoSinImporte,
      monto_notas_credito: Math.round(montoNotasCredito * 100) / 100,
      monto_nc_producto: Math.round(montoNCProducto * 100) / 100,
      monto_nc_concepto: Math.round(montoNCConcepto * 100) / 100,
      metricas_recalculadas: metricasRecalculadas,

      filas_procesadas: ventasRaw.length,
      filas_deduplicadas: ventasDeduplicadas.length,
      renglones_con_ordinal: renglonStats.colisiones,
      filas_bonificadas_100: ventasDeduplicadas.filter(v => Number(v.bonificacion) === 100).length,
      cajas_bonificadas_100: ventasDeduplicadas
        .filter(v => Number(v.bonificacion) === 100)
        .reduce((s, v) => s + (Number(v.cajas) || 0), 0),
      filas_venta_insertadas: ventasInsertadas,
      filas_nota_credito_insertadas: notasInsertadas,
      filas_descartadas_total: filasDescartadas.length,
      filas_descartadas_por_motivo: motivosDescarte,
      filas_descartadas_sin_id: ventasSinClientId,
      filas_cuit_ambiguo: ventasCuitAmbiguo,
      facturacion_total_procesada: totalFacturacionProcesada,
      tickets_unicos: totalTicketsUnicos,
      clientes_unicos: totalClientesUnicos,
      clientes_razon_social: totalClientesRazonSocial,
      tickets_compartidos: ticketsCompartidos.length,
      vendedor_breakdown: vendedorBreakdown,
      rango: rangoCarga,

    };

    const integridad = {
      descartados_sin_client_id: descartados.slice(0, 20),
      total_descartados: descartados.length,
      total_cuit_ambiguo: ventasCuitAmbiguo,
    };

    const estado = results.ventas_errores > 0 || results.errores.length > 0 || calidad.alerta || notasCreditoSinMatch > 0
      ? 'completado_con_errores'
      : 'completado';
    const { error: closeBatchError } = await supabase
      .from('import_batches')
      .update({
        estado,
        resultado: { ...results, metadata, integridad },
        calidad,
        reconciliacion,
        completed_at: new Date().toISOString(),
      })
      .eq('id', batchId);
    if (closeBatchError) throw new Error(`Las ventas se procesaron pero no se pudo cerrar el lote: ${closeBatchError.message}`);

    // Persistimos en staging solo las filas descartadas (con motivo) y limpiamos el resto
    if (filasDescartadas.length > 0) {
      for (let i = 0; i < filasDescartadas.length; i += 500) {
        const chunk = filasDescartadas.slice(i, i + 500).map((f, offset) => ({
          batch_id: batchId,
          tipo_fila: 'descartada',
          numero_fila: i + offset + 1,
          payload: { origen: f.origen, motivo: f.motivo, fila: f.payload },
        }));
        const { error: descartError } = await supabase.from('import_staging_rows').insert(chunk);
        if (descartError) console.error('No se pudieron guardar filas descartadas:', descartError.message);
      }
    }

    const { error: cleanupError } = await supabase
      .from('import_staging_rows')
      .delete()
      .eq('batch_id', batchId)
      .in('tipo_fila', ['principal', 'nota_credito']);
    if (cleanupError) console.error('No se pudo limpiar staging:', cleanupError.message);


    return new Response(JSON.stringify({
      success: true,
      batch_id: batchId,
      results,
      calidad,
      reconciliacion,
      metadata,
      integridad,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (error) {
    console.error('💥 Error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido';
    if (supabase && batchId) {
      const { error: auditError } = await supabase
        .from('import_batches')
        .update({ estado: 'fallido', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', batchId);
      if (auditError) console.error('No se pudo registrar el fallo del lote:', auditError.message);
    }
    const previa = (error as any)?.previa ?? null;
    const requiereConfirmacion = Boolean(previa?.requiere_confirmacion) && !/otra empresa/i.test(message);
    return new Response(JSON.stringify({
      success: false,
      error: message,
      batch_id: batchId,
      previa,
      requiere_confirmacion: requiereConfirmacion,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });

  }
});
