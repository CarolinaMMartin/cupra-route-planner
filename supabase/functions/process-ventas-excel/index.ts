import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// === CONFIGURACIÓN ===
const DIAS_ACTIVO = 30;
const DIAS_INTERMITENTE = 90;
const DIAS_INACTIVO = 180;

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
  const cleaned = String(v).replace(/[^\d,.\- ]/g, '').replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

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

function normalizarGeografia(ciudadRaw: string | null): GeoResult {
  if (!ciudadRaw) return { barrio: null, comuna: null, ciudad: null, provincia: null };
  const ubicacion = ciudadRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  if (BARRIOS_A_COMUNA[ubicacion]) {
    return { barrio: ubicacion, comuna: BARRIOS_A_COMUNA[ubicacion], ciudad: 'CABA', provincia: 'CABA' };
  }
  if (ubicacion === 'CABA' || ubicacion === 'CIUDAD AUTONOMA DE BUENOS AIRES') {
    return { barrio: null, comuna: null, ciudad: 'CABA', provincia: 'CABA' };
  }
  if (ubicacion.includes('LA PLATA')) {
    const match = ubicacion.match(/LA PLATA\s*\(([^)]+)\)/);
    return { barrio: match ? match[1].trim() : null, comuna: null, ciudad: 'LA PLATA', provincia: 'BUENOS AIRES' };
  }
  if (['CITY BELL', 'GONNET', 'ABASTO'].includes(ubicacion)) {
    return { barrio: ubicacion, comuna: null, ciudad: 'LA PLATA', provincia: 'BUENOS AIRES' };
  }
  const zonaVicente = ['OLIVOS', 'FLORIDA', 'MARTINEZ', 'LA LUCILA', 'MUNRO'];
  if (zonaVicente.includes(ubicacion)) {
    return { barrio: null, comuna: null, ciudad: ubicacion, provincia: 'BUENOS AIRES' };
  }
  return { barrio: null, comuna: null, ciudad: ubicacion, provincia: 'BUENOS AIRES' };
}

const countNonEmptyValues = (obj: Record<string, any>): number => {
  return Object.values(obj).reduce((acc, value) => acc + (isEmpty(value) ? 0 : 1), 0);
};

const buildVentaConflictKey = (venta: Record<string, any>): string | null => {
  const targetFields = ['ticket', 'letra', 'fecha_emision', 'client_id', 'codigo_producto'];
  const values = targetFields.map(field => venta[field]);

  if (values.some(value => isEmpty(value))) return null;

  return values
    .map(value => String(value).trim().toUpperCase())
    .join('||');
};

const mergeVentaDuplicate = (current: Record<string, any>, incoming: Record<string, any>) => {
  return countNonEmptyValues(incoming) >= countNonEmptyValues(current) ? incoming : current;
};

// === MAIN ===
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { rows } = await req.json() as { rows: Record<string, any>[] };
    if (!rows || !rows.length) {
      return new Response(JSON.stringify({ success: false, error: 'No rows provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }

    console.log(`📦 Recibidas ${rows.length} filas del Excel`);

    // ============ FASE 1: Normalizar ventas individuales ============
    const ventas: any[] = [];
    const clientesMap = new Map<number, any>();

    for (const row of rows) {
      const client_id = toInt(getFieldValue(row, ['Id', 'id', 'ID', 'client_id']));
      const cuit_dni = toStr(getFieldValue(row, ['CUIT / DNI', 'CUIT/DNI', 'CUIT DNI', 'cuit_dni']));
      const razon_social = toStr(getFieldValue(row, ['Razón Social', 'Razon Social', 'razon_social']));
      const fantasia = toStr(getFieldValue(row, ['Fantasia', 'Fantasía', 'fantasia']));
      const direccion = toStr(getFieldValue(row, ['Dirección', 'Direccion', 'direccion', 'Domicilio']));
      const ciudad_raw = toStr(getFieldValue(row, ['Ciudad', 'ciudad', 'Localidad']));
      const vendedor = toStr(getFieldValue(row, ['Vendedor', 'vendedor']));
      const fecha_emision = getFieldValue(row, ['Fecha Emisión', 'Fecha Emision', 'fecha_emision']);
      const facturacion = toNumberCurrency(getFieldValue(row, ['Facturación Ar$', 'Facturacion Ar$', 'Facturación Ars', 'Facturacion Ars', 'facturacion_ars']));
      const producto = toStr(getFieldValue(row, ['Nombre', 'nombre']));
      const cajas = toInt(getFieldValue(row, ['Cajas', 'cajas']));
      const categorias = toStr(getFieldValue(row, ['Categorías', 'Categorias', 'categorias']));
      const telefono = toStr(getFieldValue(row, ['Teléfono', 'Telefono', 'telefono', 'Tel']));
      const celular = toStr(getFieldValue(row, ['Celular', 'celular', 'Cel', 'Movil', 'Móvil']));
      const correo = toStr(getFieldValue(row, ['Correo', 'correo', 'Email', 'email', 'Mail']));
      const ticket = toStr(getFieldValue(row, ['Ticket', 'ticket']));
      const letra = toStr(getFieldValue(row, ['Letra', 'letra']));
      const codigo_producto = toStr(getFieldValue(row, ['Codigo Producto', 'Código Producto', 'codigo_producto']));
      const marca = toStr(getFieldValue(row, ['Marca', 'marca']));
      const provincia_raw = toStr(getFieldValue(row, ['Provincia', 'provincia']));
      const pais = toStr(getFieldValue(row, ['País', 'Pais', 'pais']));
      const fecha_iso = toYmdFromExcelOrText(fecha_emision);

      // Build venta record
      ventas.push({
        client_id: client_id || cuit_dni || 'UNKNOWN',
        ticket, letra, fecha_emision: fecha_iso, cuit_dni, razon_social, fantasia,
        cajas, codigo_producto, nombre: producto, marca, facturacion_ars: facturacion,
        vendedor, telefono, celular, correo, direccion, ciudad: ciudad_raw,
        provincia: provincia_raw, pais, categorias,
      });

      // Aggregate for client
      if (!client_id) continue;
      const geo = normalizarGeografia(ciudad_raw);

      if (!clientesMap.has(client_id)) {
        clientesMap.set(client_id, {
          client_id, cuit_dni, razon_social, fantasia,
          barrios: new Set<string>(), comunas: new Set<string>(), ciudades: new Set<string>(),
          provincias: new Set<string>(), direcciones: new Set<string>(), vendedores: new Set<string>(),
          productos: new Set<string>(), categorias_set: new Set<string>(),
          telefonos: new Set<string>(), emails: new Set<string>(),
          monto_total: 0, cantidad_ordenes: 0, fechas: [] as Date[],
        });
      }

      const c = clientesMap.get(client_id)!;
      if (geo.barrio) c.barrios.add(geo.barrio);
      if (geo.comuna) c.comunas.add(geo.comuna);
      if (geo.ciudad) c.ciudades.add(geo.ciudad);
      if (geo.provincia) c.provincias.add(geo.provincia);
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
      c.cantidad_ordenes += 1;
      if (fecha_iso) c.fechas.push(new Date(fecha_iso));
      c.razon_social = razon_social || c.razon_social;
      c.fantasia = fantasia || c.fantasia;
    }

    // ============ FASE 2: RFM + scores ============
    const ahora = new Date();
    const totalGlobal = Array.from(clientesMap.values()).reduce((sum, c) => sum + c.monto_total, 0);

    const clientesEnriquecidos = Array.from(clientesMap.values()).map(c => {
      const fechasOrd = c.fechas.sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const primera = fechasOrd[0] || null;
      const ultima = fechasOrd[fechasOrd.length - 1] || null;
      const dias = ultima ? Math.floor((ahora.getTime() - ultima.getTime()) / 86400000) : 9999;

      const ticket_promedio = c.cantidad_ordenes > 0 ? Math.round((c.monto_total / c.cantidad_ordenes) * 100) / 100 : 0;

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
        cantidad_ordenes: c.cantidad_ordenes,
        monto_total_historico: Math.round(c.monto_total * 100) / 100,
        ticket_promedio, categoria_recencia, categoria_volumen,
        score_recencia, score_volumen, score_comercial,
        participacion_mercado: Math.round(participacion * 10000) / 100,
        barrio_principal: mode(c.barrios), ciudad_principal: mode(c.ciudades),
        provincia_principal: mode(c.provincias), direccion_principal: mode(c.direcciones),
        vendedor_principal: mode(c.vendedores),
        productos_comprados: Array.from(c.productos),
        todos_barrios: Array.from(c.barrios), todas_ciudades: Array.from(c.ciudades),
        todas_direcciones: Array.from(c.direcciones), todos_vendedores: Array.from(c.vendedores),
        requiere_visita: dias > 15 ? 'SI' : 'NO', canal, etiquetas: [],
      };
    });

    console.log(`🧮 ${clientesEnriquecidos.length} clientes agregados, $${Math.round(totalGlobal).toLocaleString()} total`);

    // ============ FASE 3: Upsert clientes PRIMERO (para satisfacer FK de ventas) ============
    const results = { ventas_procesadas: 0, ventas_errores: 0, clientes_actualizados: 0, clientes_errores: 0, errores: [] as string[] };

    const allClientIds = clientesEnriquecidos.map(c => String(c.client_id));
    const { data: existingClients } = await supabase
      .from('clientes')
      .select('client_id')
      .in('client_id', allClientIds);

    const existingSet = new Set((existingClients || []).map(c => c.client_id));

    const newClients = clientesEnriquecidos.filter(c => !existingSet.has(String(c.client_id)));
    const updateClients = clientesEnriquecidos.filter(c => existingSet.has(String(c.client_id)));

    // Insert new clients
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
      'participacion_mercado', 'vendedor_principal', 'productos_comprados',
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

    // ============ FASE 4: Upsert ventas (después de clientes para respetar FK) ============
    const ventasByConflictKey = new Map<string, any>();
    const ventasSinClaveConflicto: any[] = [];
    let ventasDuplicadas = 0;

    for (const venta of ventas) {
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

    const ventasParaUpsert = [...ventasByConflictKey.values(), ...ventasSinClaveConflicto];

    if (ventasDuplicadas > 0) {
      console.log(`♻️ ${ventasDuplicadas} filas duplicadas consolidadas`);
    }

    // Batch ventas in chunks of 500
    for (let i = 0; i < ventasParaUpsert.length; i += 500) {
      const batch = ventasParaUpsert.slice(i, i + 500);
      const { error } = await supabase.from('ventas_cupra').upsert(batch, {
        onConflict: 'ticket,letra,fecha_emision,client_id,codigo_producto',
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

    console.log('🎉 Proceso completo:', results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (error) {
    console.error('💥 Error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Error desconocido' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
