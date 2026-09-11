import { GraphQueryError, GraphUnavailableError } from './errors.js';
import type { ResolvedConfig } from './config.js';

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * One place where every network failure is turned into a typed error.
 *
 * A transport failure must never look like an empty result. An empty result can be read
 * as "nothing has been purchased"; a failure means "we do not know", and the difference
 * decides whether an agent is about to pay twice.
 */
export async function query<T>(
  config: ResolvedConfig,
  document: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;
    response = await config.fetchImpl(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: document, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new GraphUnavailableError(
      aborted ? `Graph query timed out after ${config.timeoutMs}ms` : 'Could not reach the Graph endpoint',
      err,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new GraphUnavailableError(`Graph endpoint returned HTTP ${response.status}`);
  }

  let body: GraphQLResponse<T>;
  try {
    body = (await response.json()) as GraphQLResponse<T>;
  } catch (err) {
    throw new GraphUnavailableError('Graph endpoint returned a body that is not JSON', err);
  }

  if (body.errors && body.errors.length > 0) {
    throw new GraphQueryError(
      `Graph query failed: ${body.errors.map(e => e.message).join('; ')}`,
      body.errors,
    );
  }
  if (!body.data) {
    throw new GraphUnavailableError('Graph endpoint returned no data and no errors');
  }
  return body.data;
}

/** Reads the chain head so index lag can be reported as a number rather than a guess. */
export async function chainHead(config: ResolvedConfig): Promise<bigint | null> {
  if (!config.chainHeadRpcUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetchImpl(config.chainHeadRpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: string };
    return body.result ? BigInt(body.result) : null;
  } catch {
    // Reporting 'unknown' is correct here. Failing the whole read because the head is
    // unreachable would be worse: the indexed answer is still usable.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
