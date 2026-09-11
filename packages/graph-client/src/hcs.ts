import type { ISODateTime } from '@common/interfaces';
import type { ResolvedConfig } from './config.js';
import { verifyPreimage } from './ids.js';

/**
 * Rationale — chosen, rejected, reason — is not on chain. `DecisionRecorded` carries only
 * an HCS sequence number, and the note itself lives on the topic.
 *
 * The topic has no submit key, so anyone may post to it. That is deliberate: notes are
 * claims, not authority. It also means a fetched note cannot simply be trusted.
 *
 * It does not have to be. The note carries the plaintext identifiers, and the contract
 * stores keccak256 of those same strings, so re-hashing binds the note to the event.
 * Verified against both published notes: all four identifiers matched in each.
 *
 * Anyone can post to the topic; nobody can post at a sequence number the contract has
 * already committed to.
 */
export interface DecisionRationale {
  chosen: string;
  rejected: string;
  reason: string;
  /** The note's own timestamp. An agent's claim about when it decided. */
  authoredAt: ISODateTime;
  /** HCS consensus timestamp. Attests when the note was written, not that it is true. */
  consensusAt: ISODateTime;
  /** Plaintext identifiers recovered from the note, once the hash check passes. */
  labels: { decisionId: string; workspaceId: string; agentId: string; operationId: string };
  /** 'verified' only when every identifier re-hashes to the indexed value. */
  binding: 'verified' | 'mismatched';
  /** Why a note was rejected, when binding is 'mismatched'. */
  mismatchReason?: string;
}

interface TopicMessage {
  message: string;
  consensus_timestamp: string;
  sequence_number: number;
}

interface NoteBody {
  decisionId?: unknown;
  workspaceId?: unknown;
  agentId?: unknown;
  operationId?: unknown;
  chosen?: unknown;
  rejected?: unknown;
  reason?: unknown;
  createdAt?: unknown;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Hedera consensus timestamps are `seconds.nanos`. */
function consensusToIso(raw: string): ISODateTime {
  const seconds = Number(raw.split('.')[0] ?? '0');
  return new Date(seconds * 1000).toISOString();
}

export interface IndexedIdentifiers {
  decisionId: string;
  workspaceId: string;
  agentId: string;
  operationId: string;
}

/**
 * Fetches one decision note and verifies it against the indexed event.
 *
 * Returns null when hydration is not configured or the note cannot be read — never a
 * partially trusted result, and never an invented one.
 */
export async function fetchRationale(
  config: ResolvedConfig,
  sequenceNumber: string,
  indexed: IndexedIdentifiers,
): Promise<DecisionRationale | null> {
  if (!config.mirrorNodeUrl || !config.hcsTopicId) return null;

  const url = `${config.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/topics/${config.hcsTopicId}/messages/${sequenceNumber}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let body: TopicMessage;
  try {
    const response = await config.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    body = (await response.json()) as TopicMessage;
  } catch {
    // A note we cannot read is reported as absent rationale, which is honest. It is
    // never a reason to fail the decision query itself.
    return null;
  } finally {
    clearTimeout(timer);
  }

  let note: NoteBody;
  try {
    note = JSON.parse(Buffer.from(body.message, 'base64').toString('utf8')) as NoteBody;
  } catch {
    return null;
  }

  const labels = {
    decisionId: str(note.decisionId),
    workspaceId: str(note.workspaceId),
    agentId: str(note.agentId),
    operationId: str(note.operationId),
  };

  const checks: [string, string, string][] = [
    ['decisionId', labels.decisionId, indexed.decisionId],
    ['workspaceId', labels.workspaceId, indexed.workspaceId],
    ['agentId', labels.agentId, indexed.agentId],
  ];
  // A wait or reject decision may carry the zero operationId and no label.
  if (labels.operationId.length > 0) {
    checks.push(['operationId', labels.operationId, indexed.operationId]);
  }

  const failed = checks.filter(([, label, onChain]) => !verifyPreimage(label, onChain));

  const rationale: DecisionRationale = {
    chosen: str(note.chosen),
    rejected: str(note.rejected),
    reason: str(note.reason),
    authoredAt: str(note.createdAt) || consensusToIso(body.consensus_timestamp),
    consensusAt: consensusToIso(body.consensus_timestamp),
    labels,
    binding: failed.length === 0 ? 'verified' : 'mismatched',
  };
  if (failed.length > 0) {
    rationale.mismatchReason = `does not hash to the indexed ${failed.map(([f]) => f).join(', ')}`;
  }
  return rationale;
}
