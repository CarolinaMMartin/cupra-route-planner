import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

/** Fetch every page; PostgREST's default cap must not truncate identity resolution. */
export async function allClients(db: SupabaseClient) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("clientes").select("*").order("client_id").range(offset, offset + 499);
    if (error) throw new Error(`No se pudo leer el maestro de clientes: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function beginImport(db: SupabaseClient, requestId: unknown, record: Record<string, unknown>) {
  const id = typeof requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
    ? requestId : crypto.randomUUID();
  const { error } = await db.from("import_batches").insert({ ...record, id });
  if (!error) return { id, response: null };
  if (error.code !== "23505") throw new Error(`No se pudo iniciar el lote: ${error.message}`);
  const { data: existing, error: readError } = await db.from("import_batches").select("*").eq("id", id).single();
  if (readError || existing.usuario_id !== record.usuario_id || existing.tipo !== record.tipo || existing.archivo_sha256 !== record.archivo_sha256) {
    throw new Error("El identificador de carga ya pertenece a otra operación. Volvé a seleccionar el archivo.");
  }
  if (existing.revertido_at) throw new Error("Esta carga fue revertida. Volvé a seleccionar el archivo para iniciar una carga nueva.");
  if (existing.respuesta) return { id, response: existing.respuesta };
  const cutoff = new Date(Date.now() - 180_000).toISOString();
  if (existing.estado === "procesando" && existing.started_at > cutoff) throw new Error("La carga sigue en curso. Esperá antes de reintentar.");
  const { data: claimed, error: claimError } = await db.from("import_batches")
    .update({ estado: "procesando", error_message: null, started_at: new Date().toISOString() })
    .eq("id", id).is("respuesta", null).eq("started_at", existing.started_at).select("id").maybeSingle();
  if (claimError || !claimed) throw new Error("La carga sigue en curso. Esperá antes de reintentar.");
  return { id, response: null };
}
