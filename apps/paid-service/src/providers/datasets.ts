/**
 * The paid resources: live Subgraph data from The Graph, pinned to a block.
 *
 * WHY PINNED. Two agents buying the same purchase key must provably receive identical
 * bytes — that is what makes reuse verifiable rather than asserted, and it is the property
 * the seeded generator used to provide. Live subgraph data changes between queries, so
 * every query names a block and the payload is a pure function of
 * (endpoint, document, variables, block).
 *
 * Nothing time-varying may enter the payload. No timestamps, no request ids. Adding one
 * silently breaks byte-equality between two buyers, and it would look like a reuse bug
 * rather than a provenance bug.
 *
 * The querying itself lives in `@common/graph-client`, which owns the Graph boundary.
 * This module states what is for sale; it does not talk to The Graph directly.
 */
import { fetchPinnedGraphData, pinnedPurchaseKey } from '@common/graph-client';

export interface Dataset {
  id: string;
  description: string;
  /** Capability tags consumers match against before reusing a stored result. */
  capabilities: readonly string[];
  /** Seconds a delivered copy stays fresh. Drives Outcome.freshUntil downstream. */
  freshnessSeconds: number;
  /** GraphQL document. Must accept `$block: Int!` and use `block: { number: $block }`. */
  document: string;
  /** Async because it performs a live, block-pinned query. `fetchImpl` is for tests. */
  build(blockNumber: number, options?: { fetchImpl?: typeof fetch }): Promise<unknown>;
}

/**
 * Which Subgraph we sell from, and on which chain.
 *
 * Read LAZILY, not at module load. ES module imports are evaluated before the importing
 * script's body, so a top-level `process.env` read happens before `loadEnvFileIfPresent()`
 * has run and silently sees an unset key. That failed as "api key: MISSING" with a
 * correctly populated .env sitting right there.
 *
 * Configurable because the pinned block must be valid for the chain the Subgraph indexes:
 * an Ethereum mainnet block number is meaningless against an Arbitrum deployment, and the
 * gateway reports that unhelpfully. `npm run gateway:check` validates the configured
 * subgraph and block together before anything is offered for sale.
 *
 * Default: Uniswap V3 on Ethereum mainnet, on The Graph's decentralized network.
 */
const DEFAULT_SUBGRAPH_ID = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';
const DEFAULT_GATEWAY_BASE = 'https://gateway.thegraph.com/api/subgraphs/id';

export function gatewayEndpoint(): string {
  const base = (process.env['GRAPH_GATEWAY_URL'] ?? DEFAULT_GATEWAY_BASE).replace(/\/$/, '');
  const id = process.env['GRAPH_SUBGRAPH_ID'] ?? DEFAULT_SUBGRAPH_ID;
  return `${base}/${id}`;
}

/**
 * The API key travels in an Authorization header, never in the URL. The gateway also
 * accepts it as a path segment; that form leaks the key into logs and into `resource`,
 * and `resource` is written to the chain.
 */
function apiKey(): string | undefined {
  const key = process.env['GRAPH_API_KEY'];
  return key && key.length > 0 ? key : undefined;
}

export function gatewayConfigured(): boolean {
  return apiKey() !== undefined;
}

/** Shared shape so a dataset definition is a document plus metadata, nothing more. */
function pinned(
  id: string,
  description: string,
  capabilities: readonly string[],
  freshnessSeconds: number,
  document: string,
): Dataset {
  const dataset: Dataset = {
    id,
    description,
    capabilities,
    freshnessSeconds,
    document,
    async build(blockNumber: number, options?: { fetchImpl?: typeof fetch }) {
      const spec: Parameters<typeof fetchPinnedGraphData>[0] = {
        endpoint: gatewayEndpoint(),
        name: id,
        document,
        blockNumber,
      };
      const key = apiKey();
      if (key) spec.apiKey = key;
      return fetchPinnedGraphData(spec, options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {});
    },
  };
  return dataset;
}

export const DATASETS: Record<string, Dataset> = {
  'daily-transfers': pinned(
    'daily-transfers',
    'Daily swap and volume totals for the busiest pools, at a pinned block.',
    ['historical-data', 'daily-granularity'],
    86_400,
    `query DailyTransfers($block: Int!) {
       poolDayDatas(
         block: { number: $block }
         first: 30
         orderBy: date
         orderDirection: desc
       ) { id date volumeUSD txCount }
     }`,
  ),
  'token-holders': pinned(
    'token-holders',
    'Busiest liquidity pools by lifetime volume, at a pinned block.',
    ['holder-distribution', 'point-in-time'],
    3_600,
    // Ordered by volume, not TVL. Ordering by totalValueLockedUSD surfaces tokens whose
    // derived price is broken in the Uniswap subgraph — the top result claimed $1.1
    // trillion locked. Volume is the robust ranking and the data is no less real.
    `query TopPools($block: Int!) {
       pools(
         block: { number: $block }
         first: 10
         orderBy: volumeUSD
         orderDirection: desc
       ) { id volumeUSD totalValueLockedUSD txCount token0 { symbol } token1 { symbol } }
     }`,
  ),
};

export function findDataset(id: string): Dataset | undefined {
  return DATASETS[id];
}

/**
 * The purchase key two agents must agree on to reuse each other's purchase.
 *
 * The block number belongs in the key: the same block is the same resource and safe to
 * reuse, a different block is genuinely different data. The previous date-scoped key let
 * two agents share a key while the underlying chain state moved beneath them.
 */
export function datasetPurchaseKey(datasetId: string, blockNumber: number, workspaceId: string): string {
  return pinnedPurchaseKey({ subgraph: datasetId, query: datasetId, blockNumber, workspaceId });
}
