import type { Money, WorkspaceStats } from '@common/interfaces';
import type { AssetRegistry } from '../money.js';
import { HBAR_TOKEN_ID, toMoney } from '../money.js';
import type { RawWorkspace } from '../queries/types.js';

/**
 * Workspace statistics, with each counter labelled by what it can honestly claim.
 *
 * Two fields of the shared `WorkspaceStats` cannot be served truthfully from events, and
 * they are flagged here rather than quietly filled with zero:
 *
 *  - `deniedRequests` — a denied reservation reverts. A reverted EVM transaction emits no
 *    logs, and `trace_filter` is unimplemented on the Hedera relay, so there is no trace
 *    fallback either. It is structurally unindexable and must come from the orchestrator.
 *
 *  - `successfulReuses` — the chain records that an agent *decided* to reuse. Nothing on
 *    chain says the agent then completed its task. This counts reuse decisions, which is
 *    intention, not the completion evidence the build plan asks for.
 */
export interface IndexedWorkspaceStats extends WorkspaceStats {
  /** Per-asset totals. Units are never added across assets. */
  purchaseSpendByAsset: readonly Money[];
  /** Raw per-asset totals including duplicate settlement records, for reconciliation. */
  rawSpendByAsset: readonly Money[];
  /** FALSE. Denied reservations revert and emit no logs. Source this from the orchestrator. */
  deniedRequestsIndexable: false;
  /** FALSE. This is reuse intention, not evidence of a completed deliverable. */
  successfulReusesIsCompletionEvidence: false;
  reservedCount: number;
  settledCount: number;
  releasedCount: number;
  expiredCount: number;
  settlementUnknownCount: number;
  buyDecisionCount: number;
  waitDecisionCount: number;
  rejectDecisionCount: number;
  decisionCount: number;
  budget: Money;
  /**
   * Reuse rate = reuses / (reuses + successful acquisitions), per the build plan.
   * Null when the denominator is zero — never 0, which would read as "nobody reused".
   */
  reuseRate: number | null;
}

export function mapWorkspaceStats(
  row: RawWorkspace,
  workspaceLabel: string,
  registry: AssetRegistry,
): IndexedWorkspaceStats {
  const byAsset = row.spendByAsset.map(s => toMoney(s.settledAmount, s.asset, registry));
  const rawByAsset = row.spendByAsset.map(s => toMoney(s.rawSettledAmount, s.asset, registry));

  // The shared interface holds a single Money, which cannot represent multi-asset spend.
  // HBAR is preferred when present so the common case is right; the full breakdown is in
  // purchaseSpendByAsset. Widening the shared field is proposed in aditya.md §5 P4.
  const primary =
    byAsset.find(m => m.tokenId === HBAR_TOKEN_ID) ??
    byAsset[0] ??
    toMoney('0', HBAR_TOKEN_ID, registry);

  const reuses = row.reuseDecisionCount;
  const acquisitions = row.deliveredUsableCount;
  const denominator = reuses + acquisitions;

  return {
    workspaceId: workspaceLabel,
    successfulReuses: reuses,
    successfulAcquisitions: acquisitions,
    failedRequests: row.deliveryFailureCount,
    deniedRequests: 0,
    purchaseSpend: primary,
    purchaseSpendByAsset: byAsset,
    rawSpendByAsset: rawByAsset,
    deniedRequestsIndexable: false,
    successfulReusesIsCompletionEvidence: false,
    reservedCount: row.reservedCount,
    settledCount: row.settledCount,
    releasedCount: row.releasedCount,
    expiredCount: row.expiredCount,
    settlementUnknownCount: row.settlementUnknownCount,
    buyDecisionCount: row.buyDecisionCount,
    waitDecisionCount: row.waitDecisionCount,
    rejectDecisionCount: row.rejectDecisionCount,
    decisionCount: row.decisionCount,
    budget: toMoney(row.budget, HBAR_TOKEN_ID, registry),
    reuseRate: denominator === 0 ? null : reuses / denominator,
  };
}
