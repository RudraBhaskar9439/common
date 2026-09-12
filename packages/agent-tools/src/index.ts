import type { MemoryReader, Purchase, PurchaseQuery } from '@common/interfaces';
export { evaluationSpecHash, evaluationPurchaseKey } from './evaluation-key.js';

/** Finds a reuse candidate only. The orchestrator still checks authorization and actual delivery. */
export async function findReusablePurchase(
  memory: MemoryReader,
  query: PurchaseQuery,
  requirements: { now: string; capabilities: readonly string[] },
): Promise<Purchase | null> {
  const now = Date.parse(requirements.now);
  if (!Number.isFinite(now)) throw new Error('Invalid evaluation time');
  const page = await memory.findPurchases(query);
  return page.items.find(purchase => {
    const outcome = purchase.outcome;
    return purchase.workspaceId === query.workspaceId
      && purchase.purchaseKey === query.purchaseKey
      && purchase.status === 'delivered'
      && purchase.result?.workspaceId === query.workspaceId
      && outcome?.usable === true
      && Date.parse(outcome.freshUntil) > now
      && requirements.capabilities.every(capability => outcome.capabilities.includes(capability));
  }) ?? null;
}
