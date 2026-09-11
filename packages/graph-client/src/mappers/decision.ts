import type { DecisionRecord, DecisionType, ISODateTime } from '@common/interfaces';
import type { DecisionRationale } from '../hcs.js';
import type { RawDecision } from '../queries/types.js';

/**
 * `DecisionRecord` requires `chosen`, `rejected` and `reason`, and none of the three is on
 * chain. When no verified HCS note is available this sentinel is used instead of an empty
 * string, so a consumer can test for it rather than mistake absence for a real value.
 */
export const RATIONALE_UNAVAILABLE = '__rationale_not_recorded_on_chain__';

/**
 * The honest Graph-served shape. `getIndexedDecisionHistory` returns these; the
 * `MemoryReader` method returns `DecisionRecord` for interface compatibility.
 */
export interface IndexedDecision {
  decisionId: string;
  workspaceId: string;
  /** Plaintext when a verified note supplied it, otherwise hex. */
  agentId: string;
  agentIdHex: string;
  type: DecisionType;
  operationId?: string;
  /** Block consensus time — when the event was recorded, not when the agent decided. */
  recordedAt: ISODateTime;
  hcsSequenceNumber?: string;
  /** True when a sequence number is linked, so rationale can be fetched and verified. */
  rationaleAvailable: boolean;
  /** Present only when a note was fetched. Check `binding` before trusting the text. */
  rationale?: DecisionRationale;
  /** Additional emissions of this decisionId. Above 0 needs review. */
  reEmissionCount: number;
  resultRef?: string;
}

const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
const secondsToIso = (seconds: string): ISODateTime => new Date(Number(seconds) * 1000).toISOString();

export function mapDecision(
  row: RawDecision,
  workspaceLabel: string,
  rationale: DecisionRationale | null,
): IndexedDecision {
  const verified = rationale !== null && rationale.binding === 'verified';

  const decision: IndexedDecision = {
    decisionId: verified ? rationale.labels.decisionId : row.id,
    workspaceId: workspaceLabel,
    agentId: verified ? rationale.labels.agentId : row.agentId,
    agentIdHex: row.agentId,
    type: row.decisionType.toLowerCase() as DecisionType,
    recordedAt: secondsToIso(row.recordedAt),
    rationaleAvailable: row.rationaleAvailable,
    reEmissionCount: row.reEmissionCount,
  };

  if (row.operationId !== ZERO_ID) {
    decision.operationId = verified ? rationale.labels.operationId : row.operationId;
  }
  if (row.hcsSequenceNumber !== null) decision.hcsSequenceNumber = row.hcsSequenceNumber;
  if (rationale !== null) decision.rationale = rationale;
  if (row.purchase?.resultRef) decision.resultRef = row.purchase.resultRef;

  return decision;
}

/**
 * Narrows to the shared `DecisionRecord`. Where no verified note exists the rationale
 * fields carry RATIONALE_UNAVAILABLE rather than plausible-looking prose.
 */
export function toDecisionRecord(decision: IndexedDecision): DecisionRecord {
  const verified = decision.rationale !== undefined && decision.rationale.binding === 'verified';
  const record: DecisionRecord = {
    schemaVersion: 1,
    decisionId: decision.decisionId,
    workspaceId: decision.workspaceId,
    agentId: decision.agentId,
    type: decision.type,
    chosen: verified ? decision.rationale!.chosen : RATIONALE_UNAVAILABLE,
    rejected: verified ? decision.rationale!.rejected : RATIONALE_UNAVAILABLE,
    reason: verified ? decision.rationale!.reason : RATIONALE_UNAVAILABLE,
    createdAt: decision.recordedAt,
  };
  if (decision.operationId !== undefined) record.operationId = decision.operationId;
  if (decision.resultRef !== undefined) {
    record.result = { id: decision.resultRef, workspaceId: decision.workspaceId };
  }
  return record;
}
