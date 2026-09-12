import { CommonError, type MemoryReader, type Purchase, type DecisionRecord, type Page, type PaymentReceipt } from '@common/interfaces';
import { CommonDatabase } from '@common/result-store';

export interface ObservedCompletion { workspaceId: string; requestId: string; operationId: string; kind: 'acquire' | 'reuse'; completedAt: string }

export function createMemoryReader(database: CommonDatabase, workspaceId: string): MemoryReader {
  const authorize = (id: string) => { if (id !== workspaceId) throw new CommonError('UNAUTHORIZED', 'Memory belongs to another workspace'); };
  function page<T>(rows: { id: string; value: T }[], cursor?: string): Page<T> {
    const remaining = rows.filter(row => !cursor || row.id > cursor);
    const batch = remaining.slice(0, 50);
    return { items: batch.map(r => r.value), nextCursor: remaining.length > batch.length ? batch.at(-1)!.id : null,
      index: { status: 'synced', indexedBlock: null } };
  }
  return {
    async findPurchases(query) {
      authorize(query.workspaceId);
      return page(database.list<Purchase>('purchases').filter(r => r.value.workspaceId === workspaceId && r.value.purchaseKey === query.purchaseKey), query.cursor);
    },
    async getDecisionHistory(query) {
      authorize(query.workspaceId);
      return page(database.list<DecisionRecord>('decisions').filter(r => r.value.workspaceId === workspaceId), query.cursor);
    },
    async getWorkspaceStats(id) {
      authorize(id);
      const completions = database.list<ObservedCompletion>('completions').map(r => r.value).filter(r => r.workspaceId === workspaceId);
      const purchases = database.list<Purchase>('purchases').map(r => r.value).filter(r => r.workspaceId === workspaceId);
      const decisions = database.list<DecisionRecord>('decisions').map(r => r.value).filter(r => r.workspaceId === workspaceId);
      const paidOperations = database.list<{ workspaceId: string; receipt?: PaymentReceipt }>('evaluations').map(r => r.value).filter(r => r.workspaceId === workspaceId && r.receipt);
      return { workspaceId,
        successfulReuses: completions.filter(r => r.kind === 'reuse').length,
        successfulAcquisitions: completions.filter(r => r.kind === 'acquire').length,
        failedRequests: purchases.filter(p => p.status === 'delivery_failed').length,
        deniedRequests: decisions.filter(d => d.type === 'reject').length,
        purchaseSpend: { amount: paidOperations.reduce((n,p) => n + BigInt(p.receipt!.amount.amount), 0n).toString(), tokenId: '0.0.0', decimals: 8 },
      };
    },
  };
}
