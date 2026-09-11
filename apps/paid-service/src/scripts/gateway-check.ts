/**
 * Validates the real Graph gateway before anything is offered for sale.
 *
 *   GRAPH_API_KEY=... npm run gateway:check
 *
 * Read-only. No payment, no chain write. Costs Graph query credits only.
 *
 * Checks the things that actually break, in the order they break:
 *   1. a key is configured at all
 *   2. the key authenticates
 *   3. the subgraph id resolves and is synced
 *   4. the pinned block is inside the subgraph's indexed range for ITS chain
 *   5. each dataset's document returns data at that block
 *   6. the same block twice is byte-identical, and carries no timestamp
 *   7. a block beyond the head is refused rather than silently answered
 */
import { loadEnvFileIfPresent } from '../config.js';
import { DATASETS, gatewayEndpoint, gatewayConfigured } from '../providers/datasets.js';

loadEnvFileIfPresent();

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): boolean => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
  return ok;
};

const apiKey = process.env['GRAPH_API_KEY'] ?? '';

async function gql(document: string, variables: Record<string, unknown> = {}): Promise<{
  data?: Record<string, unknown>;
  errors?: { message: string }[];
  status: number;
}> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  const response = await fetch(gatewayEndpoint(), {
    method: 'POST', headers, body: JSON.stringify({ query: document, variables }),
  });
  const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  return { ...body, status: response.status };
}

console.log(`\nCOMMON — Graph gateway check (read-only)\n\n  endpoint: ${gatewayEndpoint()}`);
// Never print the key, not even a prefix.
console.log(`  api key : ${gatewayConfigured() ? 'configured' : 'MISSING'}\n`);

if (!check('an API key is configured', gatewayConfigured(), gatewayConfigured() ? '' : 'set GRAPH_API_KEY')) {
  console.log('\nCannot continue without a key. Create one at https://thegraph.com/studio\n');
  process.exit(1);
}

// --- auth and subgraph resolution ------------------------------------------
const meta = await gql('{ _meta { block { number } hasIndexingErrors } }');
const authFailed = meta.errors?.some(e => /auth|authorization|api key/i.test(e.message)) ?? false;
if (!check('the key authenticates', !authFailed, authFailed ? meta.errors![0]!.message : '')) {
  process.exit(1);
}
if (!check('the subgraph id resolves', meta.errors === undefined && meta.data !== undefined,
  meta.errors ? meta.errors.map(e => e.message).join('; ') : '')) {
  console.log('\nCheck GRAPH_SUBGRAPH_ID. A wrong id authenticates fine and then fails here.\n');
  process.exit(1);
}

const head = Number((meta.data!['_meta'] as { block: { number: number } }).block.number);
const indexingErrors = (meta.data!['_meta'] as { hasIndexingErrors: boolean }).hasIndexingErrors;
check('the subgraph reports no indexing errors', !indexingErrors, `indexed head ${head}`);

// --- the pinned block ------------------------------------------------------
// Behind the head by a margin, so the block is final and the answer is stable.
const block = Number(process.env['GRAPH_PINNED_BLOCK'] ?? head - 1000);
check('the pinned block is within the indexed range', block > 0 && block <= head,
  `block ${block} vs indexed head ${head}`);

// --- each dataset ----------------------------------------------------------
const payloads = new Map<string, string>();
for (const dataset of Object.values(DATASETS)) {
  try {
    const result = await dataset.build(block);
    const serialised = JSON.stringify(result);
    payloads.set(dataset.id, serialised);
    const rows = JSON.stringify((result as { data?: unknown }).data ?? {});
    check(`dataset "${dataset.id}" returns data at the pinned block`, rows !== '{}' && rows.length > 2,
      `${serialised.length} bytes`);
  } catch (err) {
    check(`dataset "${dataset.id}" returns data at the pinned block`, false, String(err).slice(0, 160));
  }
}

// --- determinism, which is what reuse depends on ---------------------------
const first = payloads.get('daily-transfers');
if (first !== undefined) {
  const again = JSON.stringify(await DATASETS['daily-transfers']!.build(block));
  check('the same block twice is byte-identical', first === again,
    first === again ? 'two buyers get the same bytes' : 'DIFFERENT BYTES — reuse cannot be verified');
  check('the payload carries no timestamp', !/\d{4}-\d{2}-\d{2}T/.test(first),
    'a timestamp would break byte-equality between buyers');
  check('the payload records the block it was pinned to', first.includes(`"blockNumber":${block}`));
}

// --- a block beyond the head must be refused, not silently answered --------
try {
  await DATASETS['daily-transfers']!.build(head + 5_000_000);
  check('a block beyond the indexed head is refused', false, 'it answered instead of erroring');
} catch {
  check('a block beyond the indexed head is refused', true, 'errors rather than answering');
}

console.log(`\n${failures === 0 ? 'Gateway is live and selling deterministic data.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
