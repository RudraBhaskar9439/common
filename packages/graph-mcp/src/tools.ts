/**
 * Common's spending memory, as MCP tools.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE.
 *
 * These tools answer "has anyone already bought this, and was it any good?". They must
 * never be mistakeable for "you may buy this". The distinction matters because the
 * consumer is a language model, which will act on a confident-sounding answer.
 *
 * So, structurally:
 *   - every tool is read-only. There is no write path in this package, and it imports no
 *     payment or contract-writing module, so no prompt can reach one.
 *   - every result carries the index state. A model that sees `synced` can reason about
 *     absence; one that sees `lagging` or `unknown` is told, in the payload, that absence
 *     proves nothing.
 *   - "no reuse candidate" is returned as an explicit verdict with a reason, never as an
 *     empty list that reads like permission.
 *   - a transport failure raises. It is never flattened into "nothing found".
 */
import { z } from 'zod';
import { GraphQueryError, GraphUnavailableError } from '@common/graph-client';
import type { GraphMemoryReader, IndexedPurchase } from '@common/graph-client';

/** Appended to every payload so index state travels with the answer, not beside it. */
export interface IndexNote {
  status: 'synced' | 'lagging' | 'unknown';
  indexedBlock: string | null;
  caveat: string;
}

const CAVEATS: Record<IndexNote['status'], string> = {
  synced:
    'The index is current. An absence here is still not authorization to buy — the contract reservation is the only authority.',
  lagging:
    'THE INDEX IS BEHIND THE CHAIN. A recent purchase may not appear yet. Absence proves nothing. Do not treat this as permission to buy.',
  unknown:
    'INDEX FRESHNESS IS UNKNOWN. Absence proves nothing. Do not treat this as permission to buy.',
};

export function indexNote(index: { status: IndexNote['status']; indexedBlock: string | null }): IndexNote {
  return { status: index.status, indexedBlock: index.indexedBlock, caveat: CAVEATS[index.status] };
}

/** Why a purchase is or is not reusable, field by field, so a model can explain itself. */
export interface ReuseVerdict {
  reusable: boolean;
  operationId: string;
  resultRef: string | null;
  checks: {
    delivered: boolean;
    usable: boolean;
    fresh: boolean;
    hasResultReference: boolean;
    settlementCertain: boolean;
  };
  freshUntil: string | null;
  failureReason: string | null;
  /** Capabilities are NOT indexed. Always verify them against the result store. */
  capabilitiesMustBeCheckedElsewhere: true;
  explanation: string;
}

export function evaluateReuse(purchase: IndexedPurchase, nowIso: string): ReuseVerdict {
  const outcome = purchase.outcome;
  const now = Date.parse(nowIso);
  const freshUntil = outcome?.freshUntil ?? null;

  const delivered = purchase.status === 'delivered';
  const usable = outcome?.usable === true;
  const fresh = freshUntil !== null && Date.parse(freshUntil) > now;
  const hasResultReference = typeof purchase.result?.id === 'string' && purchase.result.id.length > 0;
  // An operation that was ever flagged uncertain is excluded until reconciliation
  // resolved it to a settled payment. Reusing an unresolved purchase would be reasoning
  // from a payment that may not have happened.
  const settlementCertain = purchase.settlementUnknownAt === undefined || purchase.status === 'delivered';

  const reasons: string[] = [];
  if (!delivered) reasons.push(`status is "${purchase.status}", not "delivered"`);
  if (delivered && !usable) reasons.push('delivery recorded the result as unusable');
  if (!fresh) reasons.push(freshUntil === null ? 'no freshness was recorded' : `freshness expired at ${freshUntil}`);
  if (!hasResultReference) reasons.push('no result reference was recorded');
  if (!settlementCertain) reasons.push('settlement was flagged unknown and is not resolved');

  const reusable = delivered && usable && fresh && hasResultReference && settlementCertain;

  return {
    reusable,
    operationId: purchase.operationId,
    resultRef: purchase.result?.id ?? null,
    checks: { delivered, usable, fresh, hasResultReference, settlementCertain },
    freshUntil,
    failureReason: outcome?.failureReason ?? null,
    capabilitiesMustBeCheckedElsewhere: true,
    explanation: reusable
      ? 'Reusable: paid, delivered, recorded usable, still fresh, and a result reference exists. Capabilities are not indexed — confirm them against the result store before relying on this.'
      : `Not reusable: ${reasons.join('; ')}.`,
  };
}

const ok = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
});

/**
 * A failure is reported as a failure. Returning an empty-looking success here would let a
 * model conclude nothing had been purchased, which is how an agent pays twice.
 */
const failed = (err: unknown) => {
  const kind =
    err instanceof GraphUnavailableError ? 'index_unreachable'
    : err instanceof GraphQueryError ? 'index_query_error'
    : 'error';
  return {
    isError: true as const,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: kind,
        message: err instanceof Error ? err.message : String(err),
        doNotConclude:
          'This is a failure to read the index, NOT evidence that nothing was purchased. Do not buy on the strength of this result.',
      }, null, 2),
    }],
  };
};

export interface ToolDeps {
  memory: GraphMemoryReader;
  /** Injected so tests are deterministic. */
  now?: () => string;
}

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
    annotations: { readOnlyHint: true; openWorldHint: true };
  };
  handler: (args: Record<string, never>) => Promise<ReturnType<typeof ok> | ReturnType<typeof failed>>;
}

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const readOnly = { readOnlyHint: true as const, openWorldHint: true as const };

  return [
    {
      name: 'find_reuse_candidate',
      config: {
        title: 'Find a reusable prior purchase',
        description:
          'Ask whether anyone in this workspace has already bought a given resource and whether that purchase can be reused. ' +
          'Returns a verdict per purchase with every check shown, so the reasoning can be explained. ' +
          'READ-ONLY. This never authorizes a purchase: a negative or empty answer is not permission to buy, and the ' +
          'contract reservation remains the only spending authority. Capabilities are not indexed — confirm them ' +
          'against the result store before relying on a candidate.',
        inputSchema: {
          workspaceId: z.string().describe('Workspace label, e.g. "demo-workspace-1789073544816". Hashed for you.'),
          purchaseKey: z.string().describe('Purchase key label, e.g. "thegraph:<subgraph>:<query>:block-<n>:<workspace>".'),
        },
        annotations: readOnly,
      },
      handler: async (args) => {
        const { workspaceId, purchaseKey } = args as unknown as { workspaceId: string; purchaseKey: string };
        try {
          const page = await deps.memory.findIndexedPurchases({ workspaceId, purchaseKey });
          const at = nowIso();
          const verdicts = page.items.map(p => evaluateReuse(p, at));
          const candidate = verdicts.find(v => v.reusable) ?? null;
          return ok({
            workspaceId,
            purchaseKey,
            evaluatedAt: at,
            candidateFound: candidate !== null,
            candidate,
            // Every purchase, not only the winner, so "why not" is answerable.
            allMatchingPurchases: verdicts,
            morePages: page.nextCursor !== null,
            index: indexNote(page.index),
            ifNoCandidate:
              'Absence of a candidate does NOT authorize a purchase. Reserve through the contract, which is the only authority and the only thing that prevents two agents buying the same resource.',
          });
        } catch (err) {
          return failed(err);
        }
      },
    },

    {
      name: 'get_decision_history',
      config: {
        title: 'Read recorded spending decisions',
        description:
          'The buy/reuse/wait/reject decisions recorded for a workspace, with the reasoning where it is available. ' +
          'Rationale lives in a Hedera Consensus Service note, not on the contract, and the topic has no submit key — ' +
          'so each note is verified by re-hashing its identifiers against the indexed values. Trust only ' +
          'rationale.binding === "verified". Decisions predating HCS have no note and report that honestly. READ-ONLY.',
        inputSchema: {
          workspaceId: z.string().describe('Workspace label.'),
          cursor: z.string().optional().describe('Cursor from a previous page.'),
        },
        annotations: readOnly,
      },
      handler: async (args) => {
        const { workspaceId, cursor } = args as unknown as { workspaceId: string; cursor?: string };
        try {
          const page = await deps.memory.getIndexedDecisionHistory(
            cursor === undefined ? { workspaceId } : { workspaceId, cursor },
          );
          return ok({
            workspaceId,
            decisions: page.items.map(d => ({
              decisionId: d.decisionId,
              type: d.type,
              agent: d.agentId,
              recordedAt: d.recordedAt,
              operationId: d.operationId ?? null,
              reEmissionCount: d.reEmissionCount,
              rationale: d.rationale
                ? {
                    binding: d.rationale.binding,
                    chosen: d.rationale.chosen,
                    rejected: d.rationale.rejected,
                    reason: d.rationale.reason,
                    trustworthy: d.rationale.binding === 'verified',
                    note: d.rationale.binding === 'verified'
                      ? 'Identifiers re-hash to the indexed values, so this note is bound to the on-chain event. It is still the agent’s own claim about its reasoning.'
                      : 'REJECTED: this note does not hash to the indexed identifiers. Do not treat its text as this decision’s reasoning.',
                  }
                : { available: false, reason: d.rationaleAvailable ? 'a note exists on chain but could not be read' : 'no note was published for this decision' },
            })),
            nextCursor: page.nextCursor,
            index: indexNote(page.index),
          });
        } catch (err) {
          return failed(err);
        }
      },
    },

    {
      name: 'get_workspace_spending',
      config: {
        title: 'Read workspace spending and reuse statistics',
        description:
          'Budget, settled spend per asset, acquisition and delivery-failure counts, and the reuse rate for a workspace. ' +
          'Amounts are integers in the smallest token unit and are never summed across assets. ' +
          'Two counters are flagged rather than silently reported: denied reservations cannot be indexed at all (a ' +
          'denial reverts and emits no log), and the reuse count reflects intention to reuse, not proof a task completed. ' +
          'READ-ONLY.',
        inputSchema: { workspaceId: z.string().describe('Workspace label.') },
        annotations: readOnly,
      },
      handler: async (args) => {
        const { workspaceId } = args as unknown as { workspaceId: string };
        try {
          const s = await deps.memory.getIndexedWorkspaceStats(workspaceId);
          return ok({
            workspaceId: s.workspaceId,
            budget: s.budget,
            spendByAsset: s.purchaseSpendByAsset,
            rawSpendByAsset: s.rawSpendByAsset,
            spendNote:
              'spendByAsset counts each real transfer once. rawSpendByAsset includes duplicate settlement records and seeded placeholders; a gap between them means duplicates were excluded.',
            successfulAcquisitions: s.successfulAcquisitions,
            deliveryFailures: s.failedRequests,
            reuseDecisions: s.successfulReuses,
            reuseRate: s.reuseRate,
            reuseRateNote: s.reuseRate === null
              ? 'N/A — the denominator is zero. Not the same as a reuse rate of 0.'
              : 'reuses / (reuses + successful acquisitions).',
            counters: {
              reserved: s.reservedCount, settled: s.settledCount,
              released: s.releasedCount, expired: s.expiredCount,
              everFlaggedSettlementUnknown: s.settlementUnknownCount,
            },
            notIndexable: {
              deniedRequests:
                'Not indexable. A denied reservation reverts, and a reverted transaction emits no logs; trace methods are unimplemented on the Hedera relay. Source this from the orchestrator.',
              reuseIsIntentionNotCompletion:
                'A reuse decision records that an agent chose to reuse. Nothing on chain says it then completed its task.',
            },
            index: indexNote({ status: 'unknown', indexedBlock: null }),
          });
        } catch (err) {
          return failed(err);
        }
      },
    },

    {
      name: 'inspect_purchase',
      config: {
        title: 'Inspect one purchase in full',
        description:
          'The complete indexed lifecycle of a single operation: reservation, payment, settlement certainty, delivery ' +
          'outcome and release reason. Use this to verify a reuse candidate before acting on it. READ-ONLY.',
        inputSchema: {
          operationId: z.string().describe('Operation label or 0x-prefixed indexed id.'),
          workspaceId: z.string().describe('Workspace label, echoed onto the result.'),
          purchaseKey: z.string().describe('Purchase key label, echoed onto the result.'),
        },
        annotations: readOnly,
      },
      handler: async (args) => {
        const a = args as unknown as { operationId: string; workspaceId: string; purchaseKey: string };
        try {
          const purchase = await deps.memory.getPurchase(a.operationId, a.workspaceId, a.purchaseKey);
          if (purchase === null) {
            return ok({
              found: false,
              operationId: a.operationId,
              doNotConclude:
                'Not present in the index. That may mean it does not exist, or that the index has not reached it yet. It is not evidence that no purchase was made.',
            });
          }
          return ok({
            found: true,
            purchase,
            reuse: evaluateReuse(purchase, nowIso()),
            settlementNote: purchase.settlementOccurrences !== undefined && purchase.settlementOccurrences > 1
              ? `This transfer is recorded against ${purchase.settlementOccurrences} operations. Spend counts it once; treat the duplication as a data-quality signal.`
              : undefined,
          });
        } catch (err) {
          return failed(err);
        }
      },
    },

    {
      name: 'check_index_health',
      config: {
        title: 'Check how far behind the index is',
        description:
          'How current the spending memory is. Call this before concluding anything from an absence — if the index is ' +
          'lagging or its freshness is unknown, "not found" carries no information. READ-ONLY.',
        inputSchema: {},
        annotations: readOnly,
      },
      handler: async () => {
        try {
          // A query whose result is irrelevant; only the index metadata matters.
          const page = await deps.memory.findIndexedPurchases({
            workspaceId: '__index_health_probe__',
            purchaseKey: '__index_health_probe__',
          });
          return ok({
            index: indexNote(page.index),
            reachable: true,
            authority:
              'This index is NOT spending authority. It is a read layer. Spending authority is the contract reservation, always, regardless of what this reports.',
          });
        } catch (err) {
          return failed(err);
        }
      },
    },
  ];
}
