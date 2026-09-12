/** Phase 0 draft. Coordinate changes with all three module owners. */
export * from './evaluation.js';
export type ISODateTime = string;
export type OperationStatus =
  | 'reserved' | 'payment_pending' | 'settlement_unknown' | 'paid'
  | 'delivered' | 'delivery_failed' | 'released' | 'expired';
export type DecisionType = 'buy' | 'reuse' | 'wait' | 'reject';
export interface Money {
  /** Non-negative integer in smallest token units, serialized losslessly. */
  amount: string;
  tokenId: string;
  decimals: number;
}
export interface ResultReference { id: string; workspaceId: string }
export interface Outcome {
  usable: boolean;
  freshUntil: ISODateTime;
  capabilities: readonly string[];
  failureReason?: string;
}
export interface PaymentReceipt {
  operationId: string;
  transactionId: string;
  amount: Money;
}
export interface Operation {
  operationId: string;
  workspaceId: string;
  purchaseKey: string;
  status: OperationStatus;
  amount: Money;
  receipt?: PaymentReceipt;
}
export interface Purchase extends Operation {
  result?: ResultReference;
  outcome?: Outcome;
}
export interface DecisionRecord {
  schemaVersion: 1;
  decisionId: string;
  workspaceId: string;
  agentId: string;
  type: DecisionType;
  chosen: string;
  rejected: string;
  reason: string;
  createdAt: ISODateTime;
  operationId?: string;
  result?: ResultReference;
}
export interface DecisionReceipt {
  decisionId: string;
  /** Not atomic; pending records require reconciliation, not another payment. */
  hcsStatus: 'pending' | 'confirmed';
  eventStatus: 'pending' | 'confirmed';
  hcsSequenceNumber?: string;
  eventTransactionId?: string;
}
export interface ReserveInput {
  operationId: string;
  workspaceId: string;
  agentId: string;
  purchaseKey: string;
  amount: Money;
}
export interface Reservation extends Operation { expiresAt: ISODateTime }
export type PaymentResult =
  | { status: 'paid'; receipt: PaymentReceipt }
  | { status: 'settlement_unknown'; operationId: string }
  | { status: 'failed'; operationId: string; reason: string };
export interface SpendingAdapter {
  reserve(input: ReserveInput): Promise<Reservation>;
  executePayment(input: { operationId: string }): Promise<PaymentResult>;
  getOperation(operationId: string): Promise<Operation>;
  release(operationId: string): Promise<void>;
  recordDecision(input: DecisionRecord): Promise<DecisionReceipt>;
}
export interface PurchaseQuery {
  workspaceId: string;
  purchaseKey: string;
  cursor?: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  index: { status: 'synced' | 'lagging' | 'unknown'; indexedBlock: string | null };
}
export interface WorkspaceStats {
  workspaceId: string;
  /** Fixture counters do not attest that an agent completed its task. */
  successfulReuses: number;
  successfulAcquisitions: number;
  failedRequests: number;
  deniedRequests: number;
  purchaseSpend: Money;
}
export interface MemoryReader {
  findPurchases(query: PurchaseQuery): Promise<Page<Purchase>>;
  getDecisionHistory(query: { workspaceId: string; cursor?: string }): Promise<Page<DecisionRecord>>;
  getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats>;
}
export interface StoredResult {
  reference: ResultReference;
  content: unknown;
}
export interface ResultStore {
  put(input: StoredResult): Promise<ResultReference>;
  get(reference: ResultReference): Promise<StoredResult>;
}
export type ErrorCode =
  | 'INSUFFICIENT_BUDGET' | 'PURCHASE_PENDING' | 'UNAUTHORIZED'
  | 'STALE_RESULT' | 'SETTLEMENT_UNKNOWN' | 'NOT_FOUND' | 'NOT_IMPLEMENTED';
export class CommonError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'CommonError';
  }
}
