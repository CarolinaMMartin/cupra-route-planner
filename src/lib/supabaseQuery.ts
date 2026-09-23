/**
 * Helpers de lectura sin techos silenciosos.
 * PostgREST devuelve como máximo 1000 filas por pedido y una lista larga de IDs
 * en `.in()` puede superar el largo máximo de la URL.
 */

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Trae todas las filas paginando de a `pageSize`. */
export async function fetchAllRows<T>(build: (from: number, to: number) => Page<T>, pageSize = 1000, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) return out;
    if (from + pageSize >= max) throw new Error(`La consulta supera el límite de ${max} filas. Acotá los filtros.`);
  }
  return out;
}

/** Ejecuta un `.in()` en tandas de `chunkSize` IDs. */
export async function fetchInChunks<T>(ids: string[], build: (chunk: string[]) => Page<T>, chunkSize = 150): Promise<T[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < unicos.length; i += chunkSize) {
    const { data, error } = await build(unicos.slice(i, i + chunkSize));
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

/** Consultas uno-a-muchos: pagina también dentro de cada tanda de IDs. */
export async function fetchInPages<T>(ids: string[], build: (chunk: string[], from: number, to: number) => Page<T>, chunkSize = 150): Promise<T[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < unicos.length; i += chunkSize) {
    const chunk = unicos.slice(i, i + chunkSize);
    out.push(...await fetchAllRows((from, to) => build(chunk, from, to)));
  }
  return out;
}
