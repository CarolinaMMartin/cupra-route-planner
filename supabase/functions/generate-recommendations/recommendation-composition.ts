export interface CompositionCandidate {
  client_id: string;
  es_prospecto: boolean;
  estado_comercial: string;
}

interface CompositionInput<T extends CompositionCandidate> {
  preferredIds: string[];
  clients: T[];
  prospects: T[];
  unavailableIds?: ReadonlySet<string>;
  limit?: number;
  cupos?: { cartera: number; reactivacion: number; prospectos: number };
}

const DEFAULT_CUPOS = { cartera: 4, reactivacion: 2, prospectos: 2 };

/**
 * Owns the non-negotiable route composition: 4 cartera activa + 2 reactivación
 * + 2 prospectos. Model preferences only affect ordering inside each block.
 * Substitution chain when a block cannot be filled:
 *   falta cartera → reactivación → prospectos (y viceversa para reactivación).
 */
export function composeRecommendationIds<T extends CompositionCandidate>({
  preferredIds,
  clients,
  prospects,
  unavailableIds = new Set<string>(),
  limit = 8,
  cupos = DEFAULT_CUPOS,
}: CompositionInput<T>): string[] {
  const candidatesById = new Map<string, T>();
  [...clients, ...prospects].forEach((candidate) =>
    candidatesById.set(candidate.client_id, candidate)
  );

  const pickedIds = new Set<string>();
  const result: string[] = [];
  const append = (candidateId: string) => {
    if (
      result.length >= limit || pickedIds.has(candidateId) ||
      unavailableIds.has(candidateId)
    ) return;
    if (!candidatesById.has(candidateId)) return;
    result.push(candidateId);
    pickedIds.add(candidateId);
  };

  const preferredCandidates = preferredIds
    .map((candidateId) => candidatesById.get(candidateId))
    .filter((candidate): candidate is T => Boolean(candidate));

  const isCarteraActiva = (candidate: T) =>
    !candidate.es_prospecto && candidate.estado_comercial === "ACTIVO";
  const isReactivacion = (candidate: T) =>
    !candidate.es_prospecto && candidate.estado_comercial !== "ACTIVO";

  // Orden dentro de cada bloque: primero lo que prefirió el modelo, después el pool.
  const orderedBlock = (predicate: (candidate: T) => boolean): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (candidate: T) => {
      if (seen.has(candidate.client_id)) return;
      seen.add(candidate.client_id);
      ids.push(candidate.client_id);
    };
    preferredCandidates.filter(predicate).forEach(push);
    [...clients, ...prospects].filter(predicate).forEach(push);
    return ids;
  };

  const bloqueCartera = orderedBlock(isCarteraActiva);
  const bloqueReactivacion = orderedBlock(isReactivacion);
  const bloqueProspectos = orderedBlock((candidate) => candidate.es_prospecto);

  const take = (ids: string[], cantidad: number) => {
    let tomados = 0;
    for (const id of ids) {
      if (tomados >= cantidad) break;
      const before = result.length;
      append(id);
      if (result.length > before) tomados++;
    }
  };

  // 1) Cupos objetivo.
  take(bloqueCartera, cupos.cartera);
  take(bloqueReactivacion, cupos.reactivacion);
  take(bloqueProspectos, cupos.prospectos);

  // 2) Cadena de sustitución: clientes propios primero, prospectos al final.
  take(bloqueCartera, limit);
  take(bloqueReactivacion, limit);
  take(bloqueProspectos, limit);

  return result;
}
