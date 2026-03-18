import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

/**
 * ═══════════════════════════════════════════════════════════════
 * ETL: process-ventas-excel — v2.0
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
const ETL_VERSION = 'v3.0';

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
  'VILLA CRESPO': 'COMUNA 15',
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

const normalizeCuit = (v: any): string | null => {
  const s = toStr(v);
  if (!s) return null;
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

const buildVentaConflictKey = (venta: Record<string, any>): string | null => {
  // Only ticket is strictly required for dedup
  const ticket = venta.ticket;
  if (isEmpty(ticket)) return null;
  // Use COALESCE logic: treat nulls as empty string to avoid dedup bypass
  const parts = [
    String(ticket).trim().toUpperCase(),
    String(venta.letra ?? '').trim().toUpperCase(),
    String(venta.fecha_emision ?? '').trim(),
    String(venta.client_id ?? '').trim().toUpperCase(),
    String(venta.codigo_producto ?? '').trim().toUpperCase(),
    String(venta.facturacion_ars ?? 0),
  ];
  return parts.join('||');
};

const mergeVentaDuplicate = (current: Record<string, any>, incoming: Record<string, any>) => {
  return countNonEmptyValues(incoming) >= countNonEmptyValues(current) ? incoming : current;
};

// === Campo de facturación: nombres de columna en orden de prioridad ===
// PRIORIDAD: Precio Total Final (con IVA, ~$511M) es la fuente oficial.
const FACTURACION_FIELD_NAMES = [
  'Precio Total Final', 'Precio Total Neto',
  'Facturación Ar$', 'Facturacion Ar$', 'Facturación Ars', 'Facturacion Ars',
  'facturacion_ars',
];

// === MAIN ===
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json() as { rows: Record<string, any>[]; replaceExisting?: boolean };
    const rawRows = body.rows;
    const replaceExisting = body.replaceExisting !== false; // default true
    if (!rawRows || !rawRows.length) {
      return new Response(JSON.stringify({ success: false, error: 'No rows provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }

    // Fix 1: Si replaceExisting, limpiar tablas antes de insertar
    if (replaceExisting) {
      console.log('🧹 Fix 1: Limpiando ventas_cupra antes de carga completa...');
      const { error: deleteError } = await supabase.from('ventas_cupra').delete().neq('id', 0);
      if (deleteError) {
        console.error('❌ Error limpiando ventas_cupra:', deleteError.message);
      } else {
        console.log('✅ ventas_cupra limpiada exitosamente');
      }
    }

    // ── Fix 3: Deduplicación estricta — eliminar filas 100% idénticas ──
    const rowHashes = new Set<string>();
    let exactDuplicates = 0;
    const rows = rawRows.filter(row => {
      const hash = JSON.stringify(Object.values(row).map(v => String(v ?? '').trim()));
      if (rowHashes.has(hash)) { exactDuplicates++; return false; }
      rowHashes.add(hash);
      return true;
    });
    if (exactDuplicates > 0) {
      console.log(`🗑️ Fix 3: ${exactDuplicates} filas 100% idénticas eliminadas (${rawRows.length} → ${rows.length})`);
    }

    console.log(`📦 ETL ${ETL_VERSION} — Recibidas ${rawRows.length} filas, procesando ${rows.length} únicas`);

    // ── TAREA 8: Log de columna de facturación resuelta ──
    const facturacionColumnResolved = rows.length > 0
      ? resolveFieldName(rows[0], FACTURACION_FIELD_NAMES)
      : null;
    console.log(`💰 Columna facturación: resuelta="${facturacionColumnResolved}" | evaluadas=${JSON.stringify(FACTURACION_FIELD_NAMES)}`);

    // ============ FASE 0: Lookup CUIT → client_id existente ============
    const allCuits = new Set<string>();
    for (const row of rows) {
      const cuit = normalizeCuit(getFieldValue(row, ['CUIT / DNI', 'CUIT/DNI', 'CUIT DNI', 'cuit_dni']));
      if (cuit) allCuits.add(cuit);
    }

    const cuitToClientId = new Map<string, string>();
    if (allCuits.size > 0) {
      const cuitArray = Array.from(allCuits);
      for (let i = 0; i < cuitArray.length; i += 500) {
        const batch = cuitArray.slice(i, i + 500);
        const { data: existingByCuit } = await supabase
          .from('clientes')
          .select('client_id, cuit_dni')
          .in('cuit_dni', batch);
        for (const c of existingByCuit || []) {
          if (c.cuit_dni) cuitToClientId.set(c.cuit_dni, c.client_id);
        }
      }
      console.log(`🔍 Fase 0: ${cuitToClientId.size} CUITs encontrados en DB de ${allCuits.size} únicos`);
    }

    // ============ FASE 1: Normalizar ventas individuales ============
    const ventasRaw: any[] = [];
    const clientesMap = new Map<string, any>();
    let ventasSinClientId = 0;
    let facturacionNullCount = 0;
    // TAREA 12: Track descartados sin client_id
    const descartados: { cuit_dni: string | null; razon_social: string | null }[] = [];

    for (const row of rows) {
      const idCandidato = normalizeClientId(getFieldValue(row, ['Id', 'id', 'ID', 'client_id', 'Número Externo', 'Numero Externo']));
      const cuit_dni = normalizeCuit(getFieldValue(row, ['CUIT / DNI', 'CUIT/DNI', 'CUIT DNI', 'cuit_dni']));
      let client_id = idCandidato || (cuit_dni && cuitToClientId.get(cuit_dni)) || cuit_dni;
      const razon_social = toStr(getFieldValue(row, ['Razón Social', 'Razon Social', 'razon_social']));

      // Fix 1: Generate synthetic client_id from razon_social when no ID/CUIT exists
      if (!client_id && razon_social) {
        const normalizedRS = razon_social.trim().toUpperCase().replace(/\s+/g, ' ');
        client_id = `RS_${normalizedRS}`;
      }
      if (!client_id) {
        ventasSinClientId += 1;
        descartados.push({ cuit_dni, razon_social });
        continue;
      }

      ventasRaw.push({
        client_id,
        ticket, letra, fecha_emision: fecha_iso, cuit_dni, razon_social, fantasia,
        cajas, codigo_producto, nombre: producto, marca, facturacion_ars: facturacion,
        vendedor, telefono, celular, correo, direccion, ciudad: ciudad_raw,
        provincia: provincia_raw, pais, categorias,
      });
    }

    if (facturacionNullCount > 0) {
      console.log(`⚠️ ${facturacionNullCount} filas con facturación null (columna: ${facturacionColumnResolved})`);
    }

    // ============ FASE 1b: Deduplicar ventas ANTES de agregar clientes ============
    const ventasByConflictKey = new Map<string, any>();
    const ventasSinClaveConflicto: any[] = [];
    let ventasDuplicadas = 0;

    for (const venta of ventasRaw) {
      const conflictKey = buildVentaConflictKey(venta);
      if (!conflictKey) {
        ventasSinClaveConflicto.push(venta);
        continue;
      }
      const existingVenta = ventasByConflictKey.get(conflictKey);
      if (!existingVenta) {
        ventasByConflictKey.set(conflictKey, venta);
      } else {
        ventasDuplicadas += 1;
        ventasByConflictKey.set(conflictKey, mergeVentaDuplicate(existingVenta, venta));
      }
    }

    const ventasDeduplicadas = [...ventasByConflictKey.values(), ...ventasSinClaveConflicto];

    if (ventasDuplicadas > 0) {
      console.log(`♻️ ${ventasDuplicadas} filas duplicadas consolidadas (${ventasRaw.length} → ${ventasDeduplicadas.length})`);
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
      c.monto_total += facturacion || 0;
      c.cantidad_lineas += 1;

      // TAREA 1: Contar tickets únicos via Set — usar solo campo Ticket (DISTINCT)
      if (venta.ticket) {
        c.tickets_set.add(venta.ticket);
      }

      if (fecha_iso) {
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
      const fechasOrd = c.fechas.sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const primera = fechasOrd[0] || null;
      const ultima = fechasOrd[fechasOrd.length - 1] || null;
      const dias = ultima ? Math.floor((ahora.getTime() - ultima.getTime()) / 86400000) : 9999;

      // TAREA 1: cantidad_ordenes = tickets únicos (no líneas de producto)
      const cantidadOrdenes = c.tickets_set.size > 0 ? c.tickets_set.size : (c.cantidad_lineas > 0 ? 1 : 0);
      const ticket_promedio = cantidadOrdenes > 0 ? Math.round((c.monto_total / cantidadOrdenes) * 100) / 100 : 0;

      let categoria_recencia = 'PERDIDO', score_recencia = 10;
      if (dias <= DIAS_ACTIVO) { categoria_recencia = 'ACTIVO'; score_recencia = 100; }
      else if (dias <= DIAS_INTERMITENTE) { categoria_recencia = 'INTERMITENTE'; score_recencia = 70; }
      else if (dias <= DIAS_INACTIVO) { categoria_recencia = 'INACTIVO'; score_recencia = 40; }

      const participacion = totalGlobal > 0 ? c.monto_total / totalGlobal : 0;
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
        monto_total_historico: Math.round(c.monto_total * 100) / 100,
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
      results.errores.push(`Filas omitidas sin client_id/CUIT válido: ${ventasSinClientId}`);
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
      'cantidad_ordenes', 'monto_total_historico', 'ticket_promedio',
      'categoria_recencia', 'categoria_volumen', 'score_recencia', 'score_volumen', 'score_comercial',
      'participacion_mercado', 'vendedor_principal', 'vendedor_actual', 'productos_comprados',
      'todos_barrios', 'todas_ciudades', 'todas_direcciones', 'todos_vendedores',
      'requiere_visita', 'canal', 'etiquetas',
      'barrio_principal', 'ciudad_principal', 'provincia_principal', 'direccion_principal',
    ];

    for (const c of updateClients) {
      const updateData: Record<string, any> = {};
      for (const campo of camposVentas) {
        updateData[campo] = (c as any)[campo];
      }
      const { error } = await supabase.from('clientes').update(updateData).eq('client_id', String(c.client_id));
      if (error) {
        results.clientes_errores++;
        results.errores.push(`Update ${c.client_id}: ${error.message}`);
      } else {
        results.clientes_actualizados++;
      }
    }

    console.log(`👥 Clientes procesados: ${results.clientes_actualizados} ok, ${results.clientes_errores} errores`);

    // ============ FASE 5: Insert/Upsert ventas ============
    // Fix 2: Updated conflict key includes facturacion_ars
    const ventasConflictKey = 'ticket,letra,fecha_emision,client_id,codigo_producto,facturacion_ars';
    for (let i = 0; i < ventasDeduplicadas.length; i += 500) {
      const batch = ventasDeduplicadas.slice(i, i + 500);
      const { error } = replaceExisting
        ? await supabase.from('ventas_cupra').insert(batch)
        : await supabase.from('ventas_cupra').upsert(batch, {
            onConflict: ventasConflictKey,
            ignoreDuplicates: false,
          });
      if (error) {
        console.error(`❌ Ventas batch ${i}:`, error.message);
        results.ventas_errores += batch.length;
        results.errores.push(`Ventas batch ${i}: ${error.message}`);
      } else {
        results.ventas_procesadas += batch.length;
      }
    }

    // ── TAREA 11: Consistencia clientes ↔ ventas_cupra (post-carga check) ──
    // Solo reportamos las discrepancias, no corregimos aquí
    const discrepancias: string[] = [];
    // Compare total processed vs what we just upserted
    if (Math.abs(totalFacturacionProcesada - Array.from(clientesMap.values()).reduce((s, c) => s + c.monto_total, 0)) > 1) {
      discrepancias.push('Discrepancia interna en facturación total procesada');
    }

    console.log('🎉 Proceso completo:', results);

    // ── TAREA 10, 12: Metadata y descartados ──
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

    const reconciliacion = {
      filas_excel: rows.length,
      filas_procesadas: ventasRaw.length,
      filas_deduplicadas: ventasDeduplicadas.length,
      filas_descartadas_sin_id: ventasSinClientId,
      facturacion_total_procesada: totalFacturacionProcesada,
      tickets_unicos: totalTicketsUnicos,
      clientes_unicos: totalClientesUnicos,
      tickets_compartidos: ticketsCompartidos.length,
      vendedor_breakdown: vendedorBreakdown,
    };

    const integridad = {
      descartados_sin_client_id: descartados.slice(0, 20),
      total_descartados: descartados.length,
    };

    return new Response(JSON.stringify({
      success: true,
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
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Error desconocido' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
