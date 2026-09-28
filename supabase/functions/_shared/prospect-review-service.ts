import { createIdentityMatcher, type IdentityContext, type IdentityProspect } from "./prospect-identity.ts";

interface ReviewDatabase { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
export class ProspectPersistenceError extends Error {}
export async function loadIdentityContext(db: ReviewDatabase) {
  const { data, error } = await db.rpc("contexto_revision_cupra");
  if (error) throw new Error("No se pudo comprobar la identidad de los prospectos. Reintentá.");
  const context = data as IdentityContext;
  if (!context || ![context.clientes,context.prospectos,context.lugares,context.decisiones].every(Array.isArray)) throw new Error("La revisión de identidades no está disponible.");
  return { context, matcher: createIdentityMatcher(context) };
}
export async function persistFoundProspects<T extends IdentityProspect>(db: ReviewDatabase, rows: T[]): Promise<T[]> {
  if (!rows.length) return [];
  const { data, error } = await db.rpc("incorporar_info_prospectos", { p_filas: rows });
  if (error || !Array.isArray(data)) throw new ProspectPersistenceError("No se pudo guardar la información encontrada. Reintentá antes de asignar.");
  return data as T[];
}
