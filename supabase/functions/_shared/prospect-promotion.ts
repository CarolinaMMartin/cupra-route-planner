export const MAX_PROMOTION_BATCH = 25;
export interface PromotionResult {
  created: number;
  promoted_place_ids: string[];
  skipped: Array<{ place_id: string; motivo: string }>;
}

export async function promoteInBatches(
  ids: string[],
  promote: (ids: string[]) => Promise<PromotionResult>,
  onBatch: (result: PromotionResult) => void,
): Promise<PromotionResult> {
  const unique = [...new Set(ids)];
  const total: PromotionResult = { created: 0, promoted_place_ids: [], skipped: [] };
  for (let i = 0; i < unique.length; i += MAX_PROMOTION_BATCH) {
    const result = await promote(unique.slice(i, i + MAX_PROMOTION_BATCH));
    total.created += result.created;
    total.promoted_place_ids.push(...result.promoted_place_ids);
    total.skipped.push(...result.skipped);
    onBatch(result);
  }
  return total;
}
