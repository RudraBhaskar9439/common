/** Exact signed-transaction reconciliation. Missing mirror data stays inconclusive; no automatic absence inference. */

export interface MirrorTransfer {
  account: string;
  amount: number;
  is_approval: boolean;
}

export interface MirrorTransaction {
  transaction_id: string;
  result: string;
  consensus_timestamp: string;
  transfers: MirrorTransfer[];
}

export type ReconciliationResult =
  | { status: 'found'; transactionId: string; consensusTimestamp: string }
  | { status: 'absent'; checkedUntil: string }
  | { status: 'inconclusive'; reason: string };

export interface ReconcileInput {
  /** From the signed transaction; optional only for legacy callers, which stay inconclusive. */
  transactionId?: string;
  mirrorNodeUrl: string;
  /** Account that should have received the payment. */
  payTo: string;
  /** Account that should have sent it. */
  payer: string;
  /** Expected amount in tinybars (HBAR only; HTS reconciliation is a separate path). */
  amount: bigint;
  /** Unix seconds after which absence becomes conclusive. */
  validUntilEpochSeconds: number;
  /**
   * Unix seconds before which a transfer CANNOT belong to this operation — normally the
   * moment the reservation was created.
   *
   * Without this, reconciliation matches on (payer, payTo, amount) alone and will happily
   * adopt an identical transfer from an earlier operation, marking a stuck operation paid
   * when it never was. Payments to the same seller for the same price are the normal case,
   * not an edge case, so this bound is required for correctness.
   */
  notBeforeEpochSeconds: number;
  /** Defaults to Date.now(). Injectable for tests. */
  nowEpochSeconds?: number;
  fetchImpl?: typeof fetch;
}

/** Exact transaction lookup. Missing mirror data never authorizes a replacement payment. */
export async function reconcileSettlement(input: ReconcileInput): Promise<ReconciliationResult> {
  const id = input.transactionId?.replace(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/, '$1-$2-$3');
  if (!id || !/^\d+\.\d+\.\d+-\d+-\d+$/.test(id)) {
    return { status: 'inconclusive', reason: 'Persisted signed transaction identity required; amount matching is unsafe' };
  }
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${input.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/transactions/${encodeURIComponent(id)}`;
  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { status: 'inconclusive', reason: `Mirror returned ${response.status}; absence is not proof` };
    const payload = await response.json() as { transactions?: MirrorTransaction[] };
    if (!Array.isArray(payload.transactions)) return { status: 'inconclusive', reason: 'Malformed mirror response' };
    for (const tx of payload.transactions) {
      if (tx.transaction_id !== id || tx.result !== 'SUCCESS') continue;
      if (Number.parseFloat(tx.consensus_timestamp) < input.notBeforeEpochSeconds) continue;
      const valid = (account: string, amount: bigint) => tx.transfers?.some(t =>
        t.account === account && Number.isSafeInteger(t.amount) && BigInt(t.amount) === amount);
      if (valid(input.payTo, input.amount) && valid(input.payer, -input.amount)) {
        return { status: 'found', transactionId: tx.transaction_id, consensusTimestamp: tx.consensus_timestamp };
      }
    }
    return { status: 'inconclusive', reason: 'No independently confirmed matching settlement; keep reservation blocked' };
  } catch {
    return { status: 'inconclusive', reason: 'Mirror lookup unavailable; keep reservation blocked' };
  }
}
