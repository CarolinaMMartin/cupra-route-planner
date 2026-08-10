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
}

/**
 * Owns the non-negotiable route composition. Model preferences only affect
 * ordering inside each group; they can never move a prospect ahead of a client.
 */
export function composeRecommendationIds<T extends CompositionCandidate>({
  preferredIds,
  clients,
  prospects,
  unavailableIds = new Set<string>(),
  limit = 8,
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
  const isActiveClient = (candidate: T) => (
    !candidate.es_prospecto &&
    (candidate.estado_comercial === "ACTIVO" ||
      candidate.estado_comercial === "INACTIVO")
  );

  // Internal clients are exhausted by commercial group before any prospect.
  preferredCandidates.filter(isActiveClient).forEach((candidate) =>
    append(candidate.client_id)
  );
  clients.filter(isActiveClient).forEach((candidate) =>
    append(candidate.client_id)
  );
  preferredCandidates
    .filter((candidate) =>
      !candidate.es_prospecto && !isActiveClient(candidate)
    )
    .forEach((candidate) => append(candidate.client_id));
  clients
    .filter((candidate) => !isActiveClient(candidate))
    .forEach((candidate) => append(candidate.client_id));

  // Only the remaining slots may be filled with prospects.
  preferredCandidates.filter((candidate) => candidate.es_prospecto).forEach((
    candidate,
  ) => append(candidate.client_id));
  prospects.forEach((candidate) => append(candidate.client_id));

  return result;
}
