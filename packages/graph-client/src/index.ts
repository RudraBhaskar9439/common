/**
 * Graph-backed MemoryReader for Common.
 *
 * This is a read layer. It supports discovery and history and it is NEVER spending
 * authority: an empty or lagging result is not permission to buy. Only the contract
 * reservation is. Every method reports index lag honestly rather than smoothing it, and
 * a transport failure raises rather than returning an empty page, because "we could not
 * ask" and "nothing was bought" must not look alike.
 */
import { CommonError } from '@common/interfaces';
import type { MemoryReader, Page, PurchaseQuery } from '@common/interfaces';

import { resolveConfig, type GraphClientConfig, type ResolvedConfig } from './config.js';
import { chainHead, query } from './transport.js';
import { resolveQueryId } from './ids.js';
import { fetchRationale, type DecisionRationale } from './hcs.js';
import {
  DECISION_HISTORY, FIND_PURCHASES, GET_PURCHASE, WORKSPACE_STATS, ZERO_CURSOR,
} from './queries/documents.js';
import type { Meta, RawDecision, RawPurchase, RawWorkspace } from './queries/types.js';
import { mapPurchase, type IndexedPurchase } from './mappers/purchase.js';
import { mapDecision, toDecisionRecord, type IndexedDecision } from './mappers/decision.js';
import { mapWorkspaceStats, type IndexedWorkspaceStats } from './mappers/stats.js';

export { GraphQueryError, GraphUnavailableError } from './errors.js';
export { RATIONALE_UNAVAILABLE } from './mappers/decision.js';
export { canonicalTransactionId, isPlaceholderSettlement } from './txid.js';
export { isIndexedId, toIndexedId, verifyPreimage } from './ids.js';
export { DEFAULT_ASSET_DECIMALS, HBAR_TOKEN_ID } from './money.js';
export { configFromEnv } from './config.js';
export { fetchPinnedGraphData, pinnedPurchaseKey, subgraphLabel } from './resource.js';
export type { PinnedQuery, PinnedResult } from './resource.js';
export type { GraphClientConfig } from './config.js';
export type { DecisionRationale } from './hcs.js';
export type { IndexedPurchase } from './mappers/purchase.js';
export type { IndexedDecision } from './mappers/decision.js';
export type { IndexedWorkspaceStats } from './mappers/stats.js';

type IndexState = Page<unknown>['index'];

/**
 * Sync state from the subgraph's own `_meta`, compared against the chain head when a
 * JSON-RPC endpoint is configured. Without one the answer is 'unknown', which is the
 * truth rather than an optimistic 'synced'.
 */
async function indexState(config: ResolvedConfig, meta: Meta): Promise<IndexState> {
  const indexedBlock = String(meta.block.number);
  // Indexing errors mean the index may be incomplete. Never report that as synced.
  if (meta.hasIndexingErrors) return { status: 'unknown', indexedBlock };

  const head = await chainHead(config);
  if (head === null) return { status: 'unknown', indexedBlock };

  const lag = head - BigInt(meta.block.number);
  return {
    status: lag <= BigInt(config.syncToleranceBlocks) ? 'synced' : 'lagging',
    indexedBlock,
  };
}

/** A cursor is the last id of the previous page. Keyset pagination cannot skip or repeat. */
const cursorOf = (value: string | undefined): string => value ?? ZERO_CURSOR;

/**
 * Adds the honest shapes alongside the shared interface, following the pattern the Hedera
 * adapter uses for `SpendingAdapter`. `MemoryReader` stays satisfied so existing consumers
 * compile; the `Indexed*` methods expose what the index can and cannot actually claim.
 */
export interface GraphMemoryReader extends MemoryReader {
  findIndexedPurchases(query: PurchaseQuery): Promise<Page<IndexedPurchase>>;
  getIndexedDecisionHistory(query: { workspaceId: string; cursor?: string }): Promise<Page<IndexedDecision>>;
  getIndexedWorkspaceStats(workspaceId: string): Promise<IndexedWorkspaceStats>;
  /** One purchase by operation id, for verifying a reuse candidate before acting on it. */
  getPurchase(operationId: string, workspaceLabel: string, purchaseKeyLabel: string): Promise<IndexedPurchase | null>;
}

export function createGraphMemoryReader(input: GraphClientConfig): GraphMemoryReader {
  const config = resolveConfig(input);

  async function findIndexedPurchases(q: PurchaseQuery): Promise<Page<IndexedPurchase>> {
    const data = await query<{ _meta: Meta; purchases: RawPurchase[] }>(config, FIND_PURCHASES, {
      workspace: resolveQueryId(q.workspaceId),
      purchaseKey: resolveQueryId(q.purchaseKey),
      cursor: cursorOf(q.cursor),
      first: config.pageSize,
    });

    // The caller supplied the plaintext, so echo it back. Identifiers are one-way hashes
    // on chain, and a consumer comparing a returned hex id to its own label would fail.
    const labels = { workspaceId: q.workspaceId, purchaseKey: q.purchaseKey };
    const items = data.purchases.map(row => mapPurchase(row, labels, config.assetRegistry));

    return {
      items,
      nextCursor: items.length === config.pageSize ? (data.purchases.at(-1)?.id ?? null) : null,
      index: await indexState(config, data._meta),
    };
  }

  async function getIndexedDecisionHistory(
    q: { workspaceId: string; cursor?: string },
  ): Promise<Page<IndexedDecision>> {
    const data = await query<{ _meta: Meta; decisions: RawDecision[] }>(config, DECISION_HISTORY, {
      workspace: resolveQueryId(q.workspaceId),
      cursor: cursorOf(q.cursor),
      first: config.pageSize,
    });

    const items: IndexedDecision[] = [];
    for (const row of data.decisions) {
      let rationale: DecisionRationale | null = null;
      if (row.hcsSequenceNumber !== null) {
        rationale = await fetchRationale(config, row.hcsSequenceNumber, {
          decisionId: row.id,
          workspaceId: row.workspace.id,
          agentId: row.agentId,
          operationId: row.operationId,
        });
      }
      items.push(mapDecision(row, q.workspaceId, rationale));
    }

    return {
      items,
      nextCursor: items.length === config.pageSize ? (data.decisions.at(-1)?.id ?? null) : null,
      index: await indexState(config, data._meta),
    };
  }

  async function getIndexedWorkspaceStats(workspaceId: string): Promise<IndexedWorkspaceStats> {
    const data = await query<{ _meta: Meta; workspace: RawWorkspace | null }>(config, WORKSPACE_STATS, {
      workspace: resolveQueryId(workspaceId),
    });
    if (data.workspace === null) {
      // The workspace is genuinely not in the index. Distinct from a transport failure,
      // which raises GraphUnavailableError instead.
      throw new CommonError('NOT_FOUND', `Workspace is not indexed: ${workspaceId}`);
    }
    return mapWorkspaceStats(data.workspace, workspaceId, config.assetRegistry);
  }

  return {
    findIndexedPurchases,
    getIndexedDecisionHistory,
    getIndexedWorkspaceStats,

    async getPurchase(operationId, workspaceLabel, purchaseKeyLabel) {
      const data = await query<{ _meta: Meta; purchase: RawPurchase | null }>(config, GET_PURCHASE, {
        id: resolveQueryId(operationId),
      });
      if (data.purchase === null) return null;
      return mapPurchase(
        data.purchase,
        { workspaceId: workspaceLabel, purchaseKey: purchaseKeyLabel },
        config.assetRegistry,
      );
    },

    findPurchases: findIndexedPurchases,

    async getDecisionHistory(q) {
      const page = await getIndexedDecisionHistory(q);
      return {
        items: page.items.map(toDecisionRecord),
        nextCursor: page.nextCursor,
        index: page.index,
      };
    },

    getWorkspaceStats: getIndexedWorkspaceStats,
  };
}
