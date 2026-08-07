import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

/**
 * ═══════════════════════════════════════════════════════════════
 * ETL: process-clientes-maestro — v1.1
 * ═══════════════════════════════════════════════════════════════
 *
 * Ingesta del MAESTRO DE CLIENTES (cartera oficial), independiente de ventas.
 *
 * Soporta dos layouts:
 *  A) Maestro WIWO  → columnas: Id, Código, Razón Social, Fantasia, CUIT,
 *     Provincia, Dirección, Ciudad, Teléfono, Celular, Correo, Categorías, Vendedor
 *  B) Actualización geográfica → columnas: RAZON SOCIAL / NOM. FANTASIA,
 *     CUIT / DNI, Provincia, Calle, Número, Ciudad, Latitud, Longitud,
 *     Categorías Cliente, Vendedor
 *
 * REGLAS:
 * • El maestro es la fuente de verdad del VENDEDOR de cartera → vendedor_actual.
 * • Los clientes sin ventas se crean igual, con métricas en cero
 *   (categoria_recencia = 'SIN_COMPRAS').
 * • NUNCA toca: cliente_feedbacks, excluir_recomendaciones, motivo_exclusion,
 *   last_recommendation_at, ultima_visita, asignaciones ni métricas de ventas.
 * • Las coordenadas del archivo se escriben en client_places como principales.
 * ═══════════════════════════════════════════════════════════════
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ETL_VERSION = 'maestro-v1.1';

interface FileMetadata {
  name?: string;
  size?: number;
  lastModified?: number;
  sha256?: string | null;
  sheetName?: string;
  headerRow?: number;
}

type SupabaseAdminClient = SupabaseClient<any, 'public', any>;

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
  'CONGRESO': 'COMUNA 5', 'ONCE': 'COMUNA 3', 'ABASTO': 'COMUNA 3',
  'MICROCENTRO': 'COMUNA 1', 'TRIBUNALES': 'COMUNA 1',
};

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

// Valores basura que trae el ERP como placeholder
const PLACEHOLDERS = new Set(['', '0', '-', 'N/A', 'NA', 'NULL', '(EN BLANCO)', 'SIN DATOS']);

const isEmpty = (v: any): boolean => {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  return s === '' || PLACEHOLDERS.has(s.toUpperCase());
};

const toStr = (v: any): string | null => (isEmpty(v) ? null : String(v).trim());

const toFloatCoord = (v: any): number | null => {
  if (isEmpty(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
};

/** Normaliza CUIT aunque venga como número o en notación científica (2.713382e+10). */
const normalizeCuit = (v: any): string | null => {
  if (isEmpty(v)) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return String(Math.round(v));
  }
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  const digits = s.replace(/\D/g, '');
  return digits || null;
};

const normalizeClientId = (v: any): string | null => {
  if (isEmpty(v)) return null;
  const raw = String(v).trim();
  if (/^\d+(\.0+)?$/.test(raw)) return String(parseInt(raw, 10));
  return raw;
};

const normalizeName = (v: any): string | null => {
  const s = toStr(v);
  if (!s) return null;
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
};

function getFieldValue(obj: Record<string, any>, fieldNames: string[]): any {
  for (const f of fieldNames) if (obj[f] !== undefined) return obj[f];
  const keys = Object.keys(obj);
  for (const f of fieldNames) {
    for (const k of keys) if (k.toLowerCase() === f.toLowerCase()) return obj[k];
  }
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  for (const f of fieldNames) {
    const nf = norm(f);
    for (const k of keys) if (norm(k) === nf) return obj[k];
  }
  return undefined;
}

const normalizeProvincia = (prov: string | null): string | null => {
  if (!prov) return null;
  const key = prov.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return PROVINCIA_NORM[key] || prov;
};

interface GeoResult { barrio: string | null; comuna: string | null; ciudad: string | null; provincia: string | null; }

function normalizarGeografia(ciudadRaw: string | null): GeoResult {
  if (!ciudadRaw) return { barrio: null, comuna: null, ciudad: null, provincia: null };
  const u = ciudadRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const barrioKey = Object.keys(BARRIOS_A_COMUNA).find(
    (k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === u
  );
  if (barrioKey) return { barrio: barrioKey, comuna: BARRIOS_A_COMUNA[barrioKey], ciudad: 'CABA', provincia: 'CABA' };
  if (u === 'CABA' || u === 'CIUDAD AUTONOMA DE BUENOS AIRES' || u === 'CAPITAL FEDERAL') {
    return { barrio: null, comuna: null, ciudad: 'CABA', provincia: 'CABA' };
  }
  if (u.includes('LA PLATA')) {
    const m = u.match(/LA PLATA\s*\(([^)]+)\)/);
    return { barrio: m ? m[1].trim() : null, comuna: null, ciudad: 'LA PLATA', provincia: 'Provincia de Buenos Aires' };
  }
  if (['CITY BELL', 'GONNET', 'ABASTO'].includes(u)) {
    return { barrio: u, comuna: null, ciudad: 'LA PLATA', provincia: 'Provincia de Buenos Aires' };
  }
  return { barrio: null, comuna: null, ciudad: u, provincia: 'Provincia de Buenos Aires' };
}

const splitCategorias = (v: any): string[] => {
  const s = toStr(v);
  if (!s) return [];
  return Array.from(new Set(
    s.split(/[/|,;]/).map((x) => x.trim().toUpperCase()).filter((x) => x.length > 0)
  ));
};

const canalFromCategorias = (cats: string[]): string => {
  const joined = cats.join(' ');
  return /RESTAURANT|HOTEL|GASTRONOMIA|WINEBAR|BAR|ONTRADE/.test(joined) ? 'ON_TRADE' : 'OFF_TRADE';
};

interface MaestroRow {
  client_id: string | null;
  cuit_dni: string | null;
  razon_social: string | null;
  fantasia: string | null;
  direccion: string | null;
  ciudad: string | null;
  provincia: string | null;
  telefonos: string[];
  emails: string[];
  etiquetas: string[];
  vendedor: string | null;
  lat: number | null;
  long: number | null;
}

function parseRow(row: Record<string, any>): MaestroRow {
  const client_id = normalizeClientId(getFieldValue(row, ['Id', 'ID', 'id', 'client_id', 'Código', 'Codigo']));
  const cuit_dni = normalizeCuit(getFieldValue(row, ['CUIT', 'CUIT / DNI', 'CUIT/DNI', 'CUIT DNI', 'cuit_dni']));

  const razonRaw = toStr(getFieldValue(row, [
    'Razón Social', 'Razon Social', 'RAZON SOCIAL / NOM. FANTASIA', 'razon_social',
  ]));
  const fantasia = toStr(getFieldValue(row, ['Fantasia', 'Fantasía', 'fantasia']));

  // Dirección: campo único o Calle + Número
  let direccion = toStr(getFieldValue(row, ['Dirección', 'Direccion', 'direccion']));
  if (!direccion) {
    const calle = toStr(getFieldValue(row, ['Calle', 'calle']));
    const numero = toStr(getFieldValue(row, ['Número', 'Numero', 'numero']));
    direccion = calle ? [calle, numero].filter(Boolean).join(' ') : null;
  }

  const telefonos = [
    toStr(getFieldValue(row, ['Teléfono', 'Telefono', 'telefono'])),
    toStr(getFieldValue(row, ['Celular', 'celular'])),
  ].filter(Boolean) as string[];

  const emails = [toStr(getFieldValue(row, ['Correo', 'correo', 'Email', 'email', 'E-mail']))].filter(Boolean) as string[];

  return {
    client_id,
    cuit_dni,
    razon_social: razonRaw,
    fantasia,
    direccion,
    ciudad: toStr(getFieldValue(row, ['Ciudad', 'ciudad', 'Localidad'])),
    provincia: toStr(getFieldValue(row, ['Provincia', 'provincia'])),
    telefonos: Array.from(new Set(telefonos)),
    emails: Array.from(new Set(emails)),
    etiquetas: splitCategorias(getFieldValue(row, ['Categorías', 'Categorias', 'Categorías Cliente', 'Categorias Cliente'])),
    vendedor: toStr(getFieldValue(row, ['Vendedor', 'vendedor'])),
    lat: toFloatCoord(getFieldValue(row, ['Latitud', 'latitud', 'lat'])),
    long: toFloatCoord(getFieldValue(row, ['Longitud', 'longitud', 'long', 'lng'])),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let supabase: SupabaseAdminClient | null = null;
  let batchId: string | null = null;
  try {
    supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
    if (profileError || callerProfile?.rol !== 'asignador') {
      return new Response(JSON.stringify({ success: false, error: 'Solo un asignador puede importar datos' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }

    const body = await req.json() as { rows: Record<string, any>[]; fileMetadata?: FileMetadata };
    const rawRows = body?.rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No rows provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }
    if (rawRows.length > 50_000) {
      return new Response(JSON.stringify({ success: false, error: 'La carga supera el límite de 50.000 filas' }), {
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
        tipo: 'maestro',
        version_etl: ETL_VERSION,
        archivo_nombre: fileMetadata.name || 'archivo_sin_nombre',
        archivo_sha256: fileMetadata.sha256 || null,
        archivo_tamano: fileMetadata.size ?? null,
        archivo_ultima_modificacion: lastModified,
        hoja: fileMetadata.sheetName || null,
        fila_encabezado: fileMetadata.headerRow ?? null,
        filas_origen: rawRows.length,
        reemplaza_existentes: false,
        usuario_id: authData.user.id,
        usuario_email: authData.user.email || null,
      })
      .select('id')
      .single();
    if (batchError || !batch) throw new Error(`No se pudo crear el lote de importación: ${batchError?.message || 'sin detalle'}`);
    batchId = batch.id;

    for (let i = 0; i < rawRows.length; i += 500) {
      const stagingRows = rawRows.slice(i, i + 500).map((payload, offset) => ({
        batch_id: batchId,
        tipo_fila: 'principal',
        numero_fila: i + offset + 1,
        payload,
      }));
      const { error: stagingError } = await supabase.from('import_staging_rows').insert(stagingRows);
      if (stagingError) throw new Error(`No se pudo preparar el lote: ${stagingError.message}`);
    }

    console.log(`📦 ${ETL_VERSION} — ${rawRows.length} filas recibidas`);

    // ── FASE 1: Parseo y consolidación por cliente ──
    const parsed: MaestroRow[] = [];
    let sinIdentificador = 0;
    for (const row of rawRows) {
      const p = parseRow(row);
      if (!p.razon_social && !p.cuit_dni && !p.client_id) { sinIdentificador++; continue; }
      parsed.push(p);
    }

    // ── FASE 2: Resolución de client_id (Id → CUIT → Razón Social) ──
    const cuits = Array.from(new Set(parsed.map((p) => p.cuit_dni).filter(Boolean))) as string[];
    const cuitToClientId = new Map<string, string>();
    const nameToClientId = new Map<string, string>();

    for (let i = 0; i < cuits.length; i += 400) {
      const batch = cuits.slice(i, i + 400);
      const { data } = await supabase.from('clientes').select('client_id, cuit_dni').in('cuit_dni', batch);
      for (const c of data || []) if (c.cuit_dni) cuitToClientId.set(c.cuit_dni, c.client_id);
    }

    // Mapa por razón social normalizada (fallback para filas sin Id ni CUIT en DB)
    {
      const { data } = await supabase.from('clientes').select('client_id, razon_social');
      for (const c of data || []) {
        const n = normalizeName(c.razon_social);
        if (n && !nameToClientId.has(n)) nameToClientId.set(n, c.client_id);
      }
    }

    const byClientId = new Map<string, MaestroRow>();
    let sinResolver = 0;
    const noResueltos: { razon_social: string | null; cuit_dni: string | null }[] = [];

    for (const p of parsed) {
      const resolved =
        p.client_id ||
        (p.cuit_dni ? cuitToClientId.get(p.cuit_dni) : undefined) ||
        (p.razon_social ? nameToClientId.get(normalizeName(p.razon_social)!) : undefined) ||
        p.cuit_dni ||
        null;

      if (!resolved) {
        sinResolver++;
        noResueltos.push({ razon_social: p.razon_social, cuit_dni: p.cuit_dni });
        continue;
      }

      const existing = byClientId.get(resolved);
      if (!existing) {
        byClientId.set(resolved, { ...p, client_id: resolved });
      } else {
        // Merge: se completa lo faltante, se agregan teléfonos/emails/etiquetas
        byClientId.set(resolved, {
          client_id: resolved,
          cuit_dni: existing.cuit_dni || p.cuit_dni,
          razon_social: existing.razon_social || p.razon_social,
          fantasia: existing.fantasia || p.fantasia,
          direccion: existing.direccion || p.direccion,
          ciudad: existing.ciudad || p.ciudad,
          provincia: existing.provincia || p.provincia,
          telefonos: Array.from(new Set([...existing.telefonos, ...p.telefonos])),
          emails: Array.from(new Set([...existing.emails, ...p.emails])),
          etiquetas: Array.from(new Set([...existing.etiquetas, ...p.etiquetas])),
          vendedor: existing.vendedor || p.vendedor,
          lat: existing.lat ?? p.lat,
          long: existing.long ?? p.long,
        });
      }
    }

    const clientes = Array.from(byClientId.values());
    console.log(`🧮 ${clientes.length} clientes únicos | ${sinResolver} sin identificador resoluble`);

    // ── FASE 3: Separar nuevos vs existentes ──
    const allIds = clientes.map((c) => String(c.client_id));
    const existingSet = new Set<string>();
    for (let i = 0; i < allIds.length; i += 400) {
      const batch = allIds.slice(i, i + 400);
      const { data } = await supabase.from('clientes').select('client_id').in('client_id', batch);
      for (const c of data || []) existingSet.add(c.client_id);
    }

    const results = {
      clientes_nuevos: 0,
      clientes_actualizados: 0,
      clientes_errores: 0,
      coordenadas_actualizadas: 0,
      sin_vendedor: 0,
      sin_resolver: sinResolver,
      errores: [] as string[],
    };

    const buildCommonFields = (c: MaestroRow) => {
      const geo = normalizarGeografia(c.ciudad);
      const provincia = normalizeProvincia(c.provincia) || geo.provincia;
      const etiquetas = c.etiquetas;
      const data: Record<string, any> = {
        razon_social: c.razon_social,
        cuit_dni: c.cuit_dni,
        fantasia: c.fantasia,
        direccion_principal: c.direccion,
        ciudad_principal: geo.ciudad || (c.ciudad ? c.ciudad.toUpperCase() : null),
        provincia_principal: provincia,
        etiquetas: etiquetas.length ? etiquetas : null,
        canal: etiquetas.length ? canalFromCategorias(etiquetas) : null,
        telefonos: c.telefonos.length ? c.telefonos : null,
        emails: c.emails.length ? c.emails : null,
      };
      if (geo.barrio) data.barrio_principal = geo.barrio;
      // El maestro define el vendedor oficial de cartera
      if (c.vendedor) data.vendedor_actual = c.vendedor.toUpperCase();
      else results.sin_vendedor++;
      // Nunca escribimos null encima de un dato existente
      for (const k of Object.keys(data)) if (data[k] === null || data[k] === undefined) delete data[k];
      return data;
    };

    // ── FASE 4: Insertar nuevos (métricas en cero, sin compras) ──
    const nuevos = clientes.filter((c) => !existingSet.has(String(c.client_id)));
    const insertPayload = nuevos.map((c) => ({
      client_id: String(c.client_id),
      ...buildCommonFields(c),
      cantidad_ordenes: 0,
      monto_total_historico: 0,
      ticket_promedio: 0,
      categoria_recencia: 'SIN_COMPRAS',
      categoria_volumen: 'BAJO',
      score_recencia: 0,
      score_volumen: 0,
      score_comercial: 0,
      participacion_mercado: 0,
      requiere_visita: 'SI',
      excluir_recomendaciones: false,
      last_recommendation_at: null,
      ultima_visita: null,
    }));

    for (let i = 0; i < insertPayload.length; i += 200) {
      const batch = insertPayload.slice(i, i + 200);
      const { error } = await supabase.from('clientes').insert(batch);
      if (error) {
        console.error(`❌ Insert batch ${i}:`, error.message);
        results.clientes_errores += batch.length;
        results.errores.push(`Insert batch ${i}: ${error.message}`);
      } else {
        results.clientes_nuevos += batch.length;
      }
    }

    // ── FASE 5: Actualizar existentes (solo campos del maestro) ──
    const existentes = clientes.filter((c) => existingSet.has(String(c.client_id)));
    for (const c of existentes) {
      const updateData = buildCommonFields(c);
      if (Object.keys(updateData).length === 0) continue;
      updateData.updated_at = new Date().toISOString();
      const { error } = await supabase.from('clientes').update(updateData).eq('client_id', String(c.client_id));
      if (error) {
        results.clientes_errores++;
        results.errores.push(`Update ${c.client_id}: ${error.message}`);
      } else {
        results.clientes_actualizados++;
      }
    }

    // ── FASE 6: Coordenadas → client_places (principal) ──
    const conCoords = clientes.filter((c) => c.lat !== null && c.long !== null);
    if (conCoords.length > 0) {
      const geoRows = conCoords.map((c) => {
        const geo = normalizarGeografia(c.ciudad);
        return {
          client_id: String(c.client_id),
          lat: c.lat as number,
          long: c.long as number,
          direccion_principal: c.direccion,
          barrio_principal: geo.barrio || (c.ciudad ? c.ciudad.toUpperCase() : null),
          provincia_principal: normalizeProvincia(c.provincia) || geo.provincia,
          comuna: geo.comuna,
          is_primary: true,
        };
      });

      // Bajamos el flag primario de los places previos de estos clientes
      const idsConCoords = Array.from(new Set(geoRows.map((g) => g.client_id)));
      for (let i = 0; i < idsConCoords.length; i += 200) {
        const batch = idsConCoords.slice(i, i + 200);
        await supabase.from('client_places').update({ is_primary: false }).in('client_id', batch);
      }

      // Fila por fila: client_places tiene 2 constraints únicos
      // (client_id, lat, long) y (client_id, direccion_principal)
      for (const g of geoRows) {
        const { data: existingPlaces } = await supabase
          .from('client_places')
          .select('id, lat, long, direccion_principal')
          .eq('client_id', g.client_id);

        const match = (existingPlaces || []).find(
          (p) => Number(p.lat) === g.lat && Number(p.long) === g.long
        ) || (g.direccion_principal
          ? (existingPlaces || []).find((p) => p.direccion_principal === g.direccion_principal)
          : undefined);

        const { error } = match
          ? await supabase.from('client_places').update(g).eq('id', match.id)
          : await supabase.from('client_places').insert(g);

        if (error) {
          console.error(`❌ Place ${g.client_id}:`, error.message);
          results.errores.push(`Place ${g.client_id}: ${error.message}`);
        } else {
          results.coordenadas_actualizadas++;
        }
      }

    }

    // ── Resumen por vendedor ──
    const vendedorAgg = new Map<string, number>();
    for (const c of clientes) {
      const v = c.vendedor ? c.vendedor.toUpperCase() : 'SIN VENDEDOR';
      vendedorAgg.set(v, (vendedorAgg.get(v) || 0) + 1);
    }
    const vendedor_breakdown = Array.from(vendedorAgg.entries())
      .map(([vendedor, clientes]) => ({ vendedor, clientes }))
      .sort((a, b) => b.clientes - a.clientes);

    console.log('🎉 Maestro procesado:', results);

    const estado = results.clientes_errores > 0 || results.errores.length > 0 || sinResolver > 0
      ? 'completado_con_errores'
      : 'completado';
    const { error: closeBatchError } = await supabase
      .from('import_batches')
      .update({
        estado,
        resultado: results,
        reconciliacion: {
          filas_origen: rawRows.length,
          clientes_unicos: clientes.length,
          filas_sin_identificador: sinIdentificador,
          filas_sin_resolver: sinResolver,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', batchId);
    if (closeBatchError) throw new Error(`Los datos se procesaron pero no se pudo cerrar el lote: ${closeBatchError.message}`);

    const { error: cleanupError } = await supabase
      .from('import_staging_rows')
      .delete()
      .eq('batch_id', batchId);
    if (cleanupError) console.error('No se pudo limpiar staging:', cleanupError.message);

    return new Response(JSON.stringify({
      success: true,
      batch_id: batchId,
      results,
      metadata: {
        fecha_carga: new Date().toISOString(),
        version_etl: ETL_VERSION,
        filas_origen: rawRows.length,
        clientes_unicos: clientes.length,
        filas_sin_identificador: sinIdentificador,
      },
      vendedor_breakdown,
      no_resueltos: noResueltos.slice(0, 20),
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
    return new Response(JSON.stringify({
      success: false,
      error: message,
      batch_id: batchId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
