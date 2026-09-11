/**
 * The paid resource: live Subgraph data, pinned to a block.
 *
 * `apps/paid-service` imports this so the Graph querying lives in the module that owns it
 * rather than being duplicated in the payment layer.
 *
 * DETERMINISM IS THE POINT. `docs/PAYMENT_ARCHITECTURE.md` relies on two agents buying the
 * same purchase key provably receiving identical bytes — that is what makes reuse
 * verifiable rather than asserted. Live subgraph data changes between queries, so every
 * query is pinned to a block number and the returned payload is a pure function of
 * (endpoint, document, variables, block).
 *
 * Nothing time-varying may enter the payload. No timestamps, no request ids, no
 * "queriedAt". Adding one silently breaks byte-equality between two buyers, and the
 * failure would look like a reuse bug rather than a provenance bug.
 */
import { GraphQueryError, GraphUnavailableError } from './errors.js';

export interface PinnedQuery {
  /** Subgraph GraphQL endpoint to buy from. */
  endpoint: string;
  /** Gateway bearer token. Never logged, never included in the payload. */
  apiKey?: string;
  /** Stable name for this query, used in the purchase key. */
  name: string;
  /** GraphQL document. Must accept a `$block: Int!` variable and use `block: { number: $block }`. */
  document: string;
  variables?: Record<string, unknown>;
  /** The block to pin to. Same block, same bytes. */
  blockNumber: number;
}

export interface PinnedResult {
  /** Provenance, all of it block-pinned and reproducible. Deliberately no timestamp. */
  source: 'thegraph';
  subgraph: string;
  query: string;
  blockNumber: number;
  data: unknown;
}

export interface PinnedQueryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The purchase key two agents must agree on to reuse each other's purchase.
 *
 * The block number belongs in the key: same block is the same resource and safe to
 * reuse, a different block is genuinely different data. A date-scoped key — which is what
 * the synthetic datasets used — would let two agents share a key while the underlying
 * chain state moved underneath them.
 */
export function pinnedPurchaseKey(input: {
  subgraph: string;
  query: string;
  blockNumber: number;
  workspaceId: string;
}): string {
  return `thegraph:${input.subgraph}:${input.query}:block-${input.blockNumber}:${input.workspaceId}`;
}

/** Identifies a subgraph in a purchase key without leaking an API key from a gateway URL. */
export function subgraphLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const last = url.pathname.split('/').filter(Boolean).at(-1);
    return last ?? url.hostname;
  } catch {
    return 'unknown-subgraph';
  }
}

export async function fetchPinnedGraphData(
  spec: PinnedQuery,
  options: PinnedQueryOptions = {},
): Promise<PinnedResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available');
  const timeoutMs = options.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (spec.apiKey) headers['authorization'] = `Bearer ${spec.apiKey}`;
    response = await fetchImpl(spec.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: spec.document,
        variables: { ...spec.variables, block: spec.blockNumber },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new GraphUnavailableError('Could not reach the Graph provider for the paid query', err);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new GraphUnavailableError(`Graph provider returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
  if (body.errors && body.errors.length > 0) {
    // A pinned block below the subgraph's start block, or above its head, arrives here.
    throw new GraphQueryError(
      `Paid Graph query failed: ${body.errors.map(e => e.message).join('; ')}`,
      body.errors,
    );
  }
  if (body.data === undefined || body.data === null) {
    throw new GraphUnavailableError('Graph provider returned no data for the paid query');
  }

  return {
    source: 'thegraph',
    subgraph: subgraphLabel(spec.endpoint),
    query: spec.name,
    blockNumber: spec.blockNumber,
    data: body.data,
  };
}
