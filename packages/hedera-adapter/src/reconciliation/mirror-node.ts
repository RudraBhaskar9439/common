/**
 * Settlement reconciliation against the Hedera mirror node.
 *
 * This is the only way out of `settlement_unknown`. It answers one question: did a
 * transfer matching this operation's bound parameters actually reach the chain?
 *
 * Three answers, and the third is not a failure — it is the correct outcome when the
 * evidence is genuinely not yet conclusive:
 *   found      -> the transfer exists; record settlement with the real transaction id
 *   absent     -> the validity window has closed and no transfer exists; safe to release
 *   inconclusive -> the window is still open, or the mirror node is unreachable.
 *                   Stay stuck. Never release, never repay.
 *
 * Absence is only meaningful AFTER the transaction's validity window has expired. Before
 * that, a missing transfer may simply not have been submitted yet — treating it as
 * absent is exactly how a double payment happens.
 */

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

/**
 * Looks for a successful CRYPTOTRANSFER crediting `payTo` and debiting `payer` by
 * exactly `amount`. Matching on both sides and the exact amount avoids mistaking an
 * unrelated transfer for our payment.
 */
export async function reconcileSettlement(input: ReconcileInput): Promise<ReconciliationResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  // Bound the search to this operation's own window. `timestamp=gte:` excludes transfers
  // that predate the reservation and therefore cannot be its payment.
  const url =
    `${input.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/transactions` +
    `?account.id=${input.payTo}&transactiontype=CRYPTOTRANSFER&limit=50&order=desc` +
    `&timestamp=gte:${input.notBeforeEpochSeconds}`;

  let payload: { transactions?: MirrorTransaction[] };
  try {
    const response = await doFetch(url);
    if (!response.ok) {
      return { status: 'inconclusive', reason: `mirror node returned ${response.status}` };
    }
    payload = (await response.json()) as { transactions?: MirrorTransaction[] };
  } catch (err) {
    // Cannot see the chain: we know nothing, so we must not conclude anything.
    return { status: 'inconclusive', reason: `mirror node unreachable: ${String(err)}` };
  }

  const expectedCredit = Number(input.amount);
  const expectedDebit = -expectedCredit;

  for (const transaction of payload.transactions ?? []) {
    if (transaction.result !== 'SUCCESS') continue;
    // Belt and braces: never trust the query parameter alone for a correctness bound.
    if (Number.parseFloat(transaction.consensus_timestamp) < input.notBeforeEpochSeconds) continue;
    const credited = transaction.transfers?.some((t) => t.account === input.payTo && t.amount === expectedCredit);
    const debited = transaction.transfers?.some((t) => t.account === input.payer && t.amount === expectedDebit);
    if (credited && debited) {
      return {
        status: 'found',
        transactionId: transaction.transaction_id,
        consensusTimestamp: transaction.consensus_timestamp,
      };
    }
  }

  // No match. Absence is only conclusive once the transfer could no longer be submitted.
  if (now <= input.validUntilEpochSeconds) {
    return {
      status: 'inconclusive',
      reason: `validity window still open until ${input.validUntilEpochSeconds}; a transfer may still land`,
    };
  }

  return { status: 'absent', checkedUntil: new Date(now * 1000).toISOString() };
}
