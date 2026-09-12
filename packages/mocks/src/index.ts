import { CommonError } from '@common/interfaces';
export { fixtureEvaluationSpec } from './evaluation.js';
import type { MemoryReader, Purchase, ResultStore, StoredResult } from '@common/interfaces';

export const DEMO_NOW = '2026-09-09T12:00:00.000Z';
export const fixturePurchase: Purchase = {
  operationId: 'mock-operation-1', workspaceId: 'mock-workspace-1',
  purchaseKey: 'mock-provider:protocol-data:daily:workspace-1', status: 'delivered',
  amount: { amount: '30000', tokenId: 'MOCK_USD', decimals: 6 },
  receipt: {
    operationId: 'mock-operation-1', transactionId: 'mock-transaction-not-onchain',
    amount: { amount: '30000', tokenId: 'MOCK_USD', decimals: 6 },
  },
  result: { id: 'mock-result-1', workspaceId: 'mock-workspace-1' },
  outcome: { usable: true, freshUntil: '2026-09-10T12:00:00.000Z', capabilities: ['historical-data'] },
};
const emptyPage = <T>(items: T[]) => ({
  items, nextCursor: null,
  index: { status: 'unknown' as const, indexedBlock: null },
});
/** Fixture data only; no Graph endpoint is contacted. */
export const mockMemoryReader: MemoryReader = {
  async findPurchases(query) {
    return emptyPage(query.workspaceId === fixturePurchase.workspaceId
      && query.purchaseKey === fixturePurchase.purchaseKey && !query.cursor
      ? [structuredClone(fixturePurchase)] : []);
  },
  async getDecisionHistory() { return emptyPage([]); },
  async getWorkspaceStats(workspaceId) {
    if (workspaceId !== fixturePurchase.workspaceId) throw new CommonError('NOT_FOUND', 'Unknown fixture workspace');
    return { workspaceId, successfulReuses: 0, successfulAcquisitions: 1,
      failedRequests: 0, deniedRequests: 0, purchaseSpend: structuredClone(fixturePurchase.amount) };
  },
};
/** Isolated in-memory development store, not production access control. */
export function createMockResultStore(): ResultStore {
  const key = (ref: { workspaceId: string; id: string }) => JSON.stringify([ref.workspaceId, ref.id]);
  const rows = new Map<string, StoredResult>();
  const initial: StoredResult = {
    reference: { id: 'mock-result-1', workspaceId: 'mock-workspace-1' },
    content: { source: 'fixture', dailyTransactions: [100, 125, 140] },
  };
  rows.set(key(initial.reference), initial);
  return {
    async put(input) { rows.set(key(input.reference), structuredClone(input)); return structuredClone(input.reference); },
    async get(reference) {
      const row = rows.get(key(reference));
      if (!row) throw new CommonError('NOT_FOUND', 'Fixture result not found in workspace');
      return structuredClone(row);
    },
  };
}
