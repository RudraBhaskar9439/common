import type { Money, Outcome, Purchase, OperationStatus } from '@common/interfaces';
import type { AssetRegistry } from '../money.js';
import { toMoney } from '../money.js';
import { canonicalTransactionId } from '../txid.js';
import type { RawPurchase } from '../queries/types.js';

/**
 * A Graph-served purchase, with the things the index cannot know marked rather than
 * guessed. Extends the shared type the way the Hedera adapter extends SpendingAdapter.
 */
export interface IndexedPurchase extends Purchase {
  /**
   * FALSE, always, for a Graph-backed reader. `DeliveryRecorded` carries no capability
   * field, so `outcome.capabilities` is empty because nothing on chain populates it —
   * not because the result has no capabilities.
   *
   * A consumer that gates reuse on capabilities MUST read them from the result store.
   * Gating on this empty array rejects every otherwise-reusable purchase. See
   * docs/workstreams/aditya.md §5 P1.
   */
  capabilitiesIndexed: false;
  /** Transaction id normalised to `0.0.X@seconds.nanos`, for counting distinct transfers. */
  transactionIdCanonical?: string;
  /** How many PaymentSettled events carried this transfer. Above 1 means a duplicate record. */
  settlementOccurrences?: number;
  /** True for a seeded placeholder settlement. No money moved. */
  isPlaceholderSettlement?: boolean;
  /** Set whenever the operation was ever flagged uncertain, including once reconciled. */
  settlementUnknownAt?: string;
  /** Provider endpoint bound at reservation. Recorded on chain; not guaranteed reachable. */
  resource: string;
  payTo: string;
  reservedAt: string;
  expiresAt: string;
  /** Hex identifiers for which no plaintext preimage is known. */
  agentIdHex: string;
  operationIdHex: string;
}

const secondsToIso = (seconds: string): string => new Date(Number(seconds) * 1000).toISOString();

export function toOperationStatus(raw: string): OperationStatus {
  return raw.toLowerCase() as OperationStatus;
}

export interface PlaintextLabels {
  /** Echoed back so a consumer comparing against its own query succeeds. */
  workspaceId: string;
  purchaseKey: string;
}

export function mapPurchase(
  row: RawPurchase,
  labels: PlaintextLabels,
  registry: AssetRegistry,
): IndexedPurchase {
  const amount: Money = toMoney(row.amount, row.asset, registry);

  const purchase: IndexedPurchase = {
    operationId: row.id,
    operationIdHex: row.id,
    workspaceId: labels.workspaceId,
    purchaseKey: labels.purchaseKey,
    agentIdHex: row.agentId,
    status: toOperationStatus(row.status),
    amount,
    resource: row.resource,
    payTo: row.payTo,
    reservedAt: secondsToIso(row.reservedAt),
    expiresAt: secondsToIso(row.expiresAt),
    capabilitiesIndexed: false,
  };

  if (row.transactionId !== null) {
    purchase.receipt = { operationId: row.id, transactionId: row.transactionId, amount };
    purchase.transactionIdCanonical = canonicalTransactionId(row.transactionId);
  }
  if (row.settlement !== null) {
    purchase.settlementOccurrences = row.settlement.occurrences;
    purchase.isPlaceholderSettlement = row.settlement.isPlaceholder;
  }
  if (row.settlementUnknownAt !== null) {
    purchase.settlementUnknownAt = secondsToIso(row.settlementUnknownAt);
  }

  // `resultRef` is null when the contract emitted an empty string, which is what a failed
  // delivery does. The workspace comes from the operation's own indexed workspace, never
  // from the reference itself, so a reference cannot claim a workspace it does not belong
  // to. That also means the consumer's `result.workspaceId === query.workspaceId` check is
  // tautological against this reader — it is not an authorization boundary. The result
  // store must enforce access on read.
  if (row.resultRef !== null) {
    purchase.result = { id: row.resultRef, workspaceId: labels.workspaceId };
  }

  if (row.usable !== null && row.freshUntil !== null) {
    const outcome: Outcome = {
      usable: row.usable,
      freshUntil: secondsToIso(row.freshUntil),
      capabilities: [],
    };
    if (row.failureReason !== null) {
      purchase.outcome = { ...outcome, failureReason: row.failureReason };
    } else {
      purchase.outcome = outcome;
    }
  }

  return purchase;
}
