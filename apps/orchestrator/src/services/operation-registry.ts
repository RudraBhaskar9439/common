import type { OperationRegistry, RememberedOperation } from '@common/hedera-adapter';
import { CommonDatabase } from '@common/result-store';

type SerializedOperation = Omit<RememberedOperation, 'amount'> & { amount: string };
/** Contains bindings and receipts only. No treasury private key or signed bytes. */
export function createPersistentOperationRegistry(database: CommonDatabase): OperationRegistry {
  return {
    remember(operationId, params) {
      database.set('payment-bindings', operationId, { ...params, amount: params.amount.toString() });
    },
    recall(operationId) {
      const row = database.get<SerializedOperation>('payment-bindings', operationId);
      return row ? { ...row, amount: BigInt(row.amount) } : undefined;
    },
  };
}
