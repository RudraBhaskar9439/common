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
  /** Subgraph to buy from. A gateway URL may carry an API key; never echo it downstream. */
  endpoint: string;
  /** GraphQL document. Must accept `$block: Int!` and use `block: { number: $block }`. */
  document: string;
  /** Async because it performs a live, block-pinned query. `fetchImpl` is for tests. */
  build(blockNumber: number, options?: { fetchImpl?: typeof fetch }): Promise<unknown>;
}

/**
 * Which Subgraph we sell from, and on which chain.
 *
 * Configurable because the pinned block must be valid for the chain the Subgraph indexes:
 * an Ethereum mainnet block number is meaningless against an Arbitrum deployment, and the
 * gateway answers that with an unhelpful error. `npm run gateway:check` validates the
 * configured subgraph and block together before anything is offered for sale.
 *
 * Default: Uniswap V3 on Ethereum mainnet, on The Graph's decentralized network.
 */
const SUBGRAPH_ID = process.env['GRAPH_SUBGRAPH_ID'] ?? 'EN9rjKtzNitTEb5hgt8bmiyzzhwBpJrJaRihkg8Me8Rr';
const GATEWAY_BASE = (process.env['GRAPH_GATEWAY_URL'] ?? 'https://gateway.thegraph.com/api/subgraphs/id').replace(/\/$/, '');

export const GATEWAY = `${GATEWAY_BASE}/${SUBGRAPH_ID}`;

/**
 * The API key travels in an Authorization header, never in the URL. The gateway also
 * accepts it as a path segment; that form leaks the key into logs and `resource` strings,
 * and `resource` is written to the chain.
 */
const API_KEY = process.env['GRAPH_API_KEY'];

export function gatewayConfigured(): boolean {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
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
    endpoint: GATEWAY,
    document,
    async build(blockNumber: number, options?: { fetchImpl?: typeof fetch }) {
      const spec: Parameters<typeof fetchPinnedGraphData>[0] = {
        endpoint: GATEWAY,
        name: id,
        document,
        blockNumber,
      };
      if (API_KEY) spec.apiKey = API_KEY;
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
    'Top liquidity pools by value locked, at a pinned block.',
    ['holder-distribution', 'point-in-time'],
    3_600,
    `query TopPools($block: Int!) {
       pools(
         block: { number: $block }
         first: 10
         orderBy: totalValueLockedUSD
         orderDirection: desc
       ) { id totalValueLockedUSD token0 { symbol } token1 { symbol } }
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
