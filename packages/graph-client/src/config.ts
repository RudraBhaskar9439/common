import type { AssetRegistry } from './money.js';
import { DEFAULT_ASSET_DECIMALS } from './money.js';

export interface GraphClientConfig {
  /** GraphQL endpoint for the deployed subgraph. */
  endpoint: string;
  /** Bearer token for a hosted gateway. Omit for a local graph-node. Never logged. */
  apiKey?: string;
  /**
   * Hedera mirror-node REST base. Enables decision-rationale hydration from HCS.
   * Without it, rationale is reported as unavailable rather than guessed.
   */
  mirrorNodeUrl?: string;
  /** HCS topic carrying decision notes. Required for rationale hydration. */
  hcsTopicId?: string;
  /**
   * JSON-RPC endpoint used only to read the chain head, so index lag can be reported as
   * a number instead of a guess. Without it, sync status is honestly 'unknown'.
   */
  chainHeadRpcUrl?: string;
  /** Blocks behind the head still counted as synced. */
  syncToleranceBlocks?: number;
  /** Decimals per Hedera token id. Defaults to HBAR = 8, matching the Hedera adapter. */
  assetRegistry?: AssetRegistry;
  /** Page size for list queries. */
  pageSize?: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ResolvedConfig {
  endpoint: string;
  apiKey: string | undefined;
  mirrorNodeUrl: string | undefined;
  hcsTopicId: string | undefined;
  chainHeadRpcUrl: string | undefined;
  syncToleranceBlocks: number;
  assetRegistry: AssetRegistry;
  pageSize: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

export function resolveConfig(config: GraphClientConfig): ResolvedConfig {
  if (!config.endpoint) throw new Error('graph-client requires an endpoint');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available');

  return {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    mirrorNodeUrl: config.mirrorNodeUrl,
    hcsTopicId: config.hcsTopicId,
    chainHeadRpcUrl: config.chainHeadRpcUrl,
    // One block of tolerance: graph-node is expected to trail the head slightly.
    syncToleranceBlocks: config.syncToleranceBlocks ?? 5,
    assetRegistry: config.assetRegistry ?? DEFAULT_ASSET_DECIMALS,
    pageSize: config.pageSize ?? 50,
    timeoutMs: config.timeoutMs ?? 15_000,
    fetchImpl,
  };
}

/**
 * Reads configuration from the environment. Names only — values never appear in code,
 * logs or fixtures.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): GraphClientConfig {
  const endpoint = env['GRAPH_ENDPOINT'];
  if (!endpoint) throw new Error('Missing required environment variable GRAPH_ENDPOINT');
  const config: GraphClientConfig = { endpoint };
  if (env['GRAPH_API_KEY']) config.apiKey = env['GRAPH_API_KEY'];
  if (env['HEDERA_MIRROR_NODE_URL']) config.mirrorNodeUrl = env['HEDERA_MIRROR_NODE_URL'];
  if (env['HCS_DECISION_TOPIC_ID']) config.hcsTopicId = env['HCS_DECISION_TOPIC_ID'];
  if (env['GRAPH_CHAIN_HEAD_RPC_URL']) config.chainHeadRpcUrl = env['GRAPH_CHAIN_HEAD_RPC_URL'];
  return config;
}
