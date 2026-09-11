import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommonError } from '@common/interfaces';
import {
  canonicalTransactionId, createGraphMemoryReader, GraphQueryError, GraphUnavailableError,
  isPlaceholderSettlement, RATIONALE_UNAVAILABLE, toIndexedId, verifyPreimage,
} from '../src/index.js';
import {
  AGENT_ID, AGENT_LABEL, DECISION_ID, DECISION_LABEL, DECISION_ROW, HCS_NOTE, META,
  OPERATION_ID, OPERATION_LABEL, PURCHASE_KEY_LABEL, PURCHASE_ROW, REAL_TX, stubFetch,
  topicMessage, WORKSPACE_ID, WORKSPACE_LABEL, WORKSPACE_ROW,
} from './fixtures.js';

const ENDPOINT = 'https://graph.example/subgraphs/name/common/budget';
const MIRROR = 'https://testnet.mirrornode.hedera.com';

function reader(handler: Parameters<typeof stubFetch>[0], extra: Record<string, unknown> = {}) {
  const { impl, calls } = stubFetch(handler);
  return {
    calls,
    memory: createGraphMemoryReader({
      endpoint: ENDPOINT, fetchImpl: impl, mirrorNodeUrl: MIRROR, hcsTopicId: '0.0.10465595', ...extra,
    }),
  };
}

// ---------------------------------------------------------------- identifiers

test('hashes labels exactly as the contract does', () => {
  // These are the real on-chain identifiers from demo-workspace-1789073544816.
  assert.equal(toIndexedId(WORKSPACE_LABEL), WORKSPACE_ID);
  assert.equal(toIndexedId(AGENT_LABEL), AGENT_ID);
  assert.equal(toIndexedId(DECISION_LABEL), DECISION_ID);
  assert.equal(toIndexedId(OPERATION_LABEL), OPERATION_ID);
  assert.ok(verifyPreimage(WORKSPACE_LABEL, WORKSPACE_ID));
  assert.ok(!verifyPreimage('not-the-label', WORKSPACE_ID));
});

test('canonicalises the mirror-node rendering and leaves everything else alone', () => {
  assert.equal(canonicalTransactionId('0.0.7162784-1789069246-329605799'), '0.0.7162784@1789069246.329605799');
  assert.equal(canonicalTransactionId('0.0.7162784@1789069246.329605799'), '0.0.7162784@1789069246.329605799');
  assert.equal(canonicalTransactionId('SEED-PLACEHOLDER-not-a-real-payment'), 'SEED-PLACEHOLDER-not-a-real-payment');
  assert.equal(canonicalTransactionId('a-b-c'), 'a-b-c');
  assert.ok(isPlaceholderSettlement('SEED-PLACEHOLDER-not-a-real-payment'));
  assert.ok(!isPlaceholderSettlement(REAL_TX));
});

// ------------------------------------------------------------- findPurchases

test('queries by hashed identifiers and echoes the caller plaintext back', async () => {
  const { memory, calls } = reader(() => ({ json: { data: { _meta: META, purchases: [PURCHASE_ROW] } } }));
  const page = await memory.findPurchases({ workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL });

  assert.equal((calls[0]!.body as { variables: { workspace: string } }).variables.workspace, WORKSPACE_ID);
  const purchase = page.items[0]!;
  // Echoed, so a consumer comparing against its own query succeeds rather than seeing hex.
  assert.equal(purchase.workspaceId, WORKSPACE_LABEL);
  assert.equal(purchase.purchaseKey, PURCHASE_KEY_LABEL);
  assert.equal(purchase.status, 'delivered');
  assert.equal(purchase.result?.id, 'result-1789073544816');
  assert.equal(purchase.result?.workspaceId, WORKSPACE_LABEL);
  assert.equal(purchase.outcome?.usable, true);
  assert.equal(purchase.outcome?.freshUntil, new Date(1789160024_000).toISOString());
  assert.equal(purchase.receipt?.transactionId, REAL_TX);
});

test('reports that capabilities are not indexed instead of implying the result has none', async () => {
  const { memory } = reader(() => ({ json: { data: { _meta: META, purchases: [PURCHASE_ROW] } } }));
  const page = await memory.findIndexedPurchases({ workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL });
  const purchase = page.items[0]!;
  assert.deepEqual(purchase.outcome?.capabilities, []);
  // The flag is the difference between "no capabilities" and "capabilities unknown here".
  assert.equal(purchase.capabilitiesIndexed, false);
});

test('an unusable delivery yields no result reference', async () => {
  const failed = { ...PURCHASE_ROW, status: 'DELIVERY_FAILED', usable: false, resultRef: null,
    failureReason: 'provider returned a corrupt payload' };
  const { memory } = reader(() => ({ json: { data: { _meta: META, purchases: [failed] } } }));
  const page = await memory.findPurchases({ workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL });
  const purchase = page.items[0]!;
  assert.equal(purchase.status, 'delivery_failed');
  assert.equal(purchase.result, undefined);
  assert.equal(purchase.outcome?.usable, false);
  assert.equal(purchase.outcome?.failureReason, 'provider returned a corrupt payload');
});

test('an empty workspace returns an empty page, not an error', async () => {
  const { memory } = reader(() => ({ json: { data: { _meta: META, purchases: [] } } }));
  const page = await memory.findPurchases({ workspaceId: 'nobody-bought-anything', purchaseKey: 'k' });
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
});

test('surfaces a duplicate settlement record rather than hiding it', async () => {
  const duplicated = { ...PURCHASE_ROW, settlement: { id: REAL_TX, occurrences: 2, isPlaceholder: false } };
  const { memory } = reader(() => ({ json: { data: { _meta: META, purchases: [duplicated] } } }));
  const page = await memory.findIndexedPurchases({ workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL });
  assert.equal(page.items[0]!.settlementOccurrences, 2);
});

// ----------------------------------------------------------------- pagination

test('pages with a keyset cursor and stops without a partial page', async () => {
  const rows = Array.from({ length: 2 }, (_, i) => ({ ...PURCHASE_ROW, id: `0x${String(i).repeat(64)}` }));
  let call = 0;
  const { memory, calls } = reader(() => {
    call += 1;
    return { json: { data: { _meta: META, purchases: call === 1 ? rows : [] } } };
  }, { pageSize: 2 });

  const first = await memory.findPurchases({ workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL });
  // A full page means there may be more, so a cursor is offered.
  assert.equal(first.nextCursor, rows[1]!.id);

  const second = await memory.findPurchases({
    workspaceId: WORKSPACE_LABEL, purchaseKey: PURCHASE_KEY_LABEL, cursor: first.nextCursor!,
  });
  assert.deepEqual(second.items, []);
  assert.equal(second.nextCursor, null);
  assert.equal((calls[1]!.body as { variables: { cursor: string } }).variables.cursor, rows[1]!.id);
});

// --------------------------------------------------------------- index status

test('reports lag honestly: synced, lagging, or unknown', async () => {
  const graphOnly = reader(() => ({ json: { data: { _meta: META, purchases: [] } } }));
  const noHead = await graphOnly.memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' });
  // Without a chain-head source the truthful answer is 'unknown', not 'synced'.
  assert.equal(noHead.index.status, 'unknown');
  assert.equal(noHead.index.indexedBlock, '40392127');

  const withHead = (headBlock: number) => reader(
    (url) => url === ENDPOINT
      ? { json: { data: { _meta: META, purchases: [] } } }
      : { json: { jsonrpc: '2.0', id: 1, result: '0x' + headBlock.toString(16) } },
    { chainHeadRpcUrl: 'https://rpc.example' },
  );
  assert.equal((await withHead(40392129).memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' })).index.status, 'synced');
  assert.equal((await withHead(40400000).memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' })).index.status, 'lagging');
});

test('indexing errors are never reported as synced', async () => {
  const { memory } = reader(
    (url) => url === ENDPOINT
      ? { json: { data: { _meta: { block: { number: 1 }, hasIndexingErrors: true }, purchases: [] } } }
      : { json: { result: '0x1' } },
    { chainHeadRpcUrl: 'https://rpc.example' },
  );
  const page = await memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' });
  assert.equal(page.index.status, 'unknown');
});

// -------------------------------------------------------------------- errors

test('a transport failure raises instead of looking like an empty result', async () => {
  const down = reader(() => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(
    () => down.memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' }),
    (err: unknown) => err instanceof GraphUnavailableError,
  );

  const http500 = reader(() => ({ status: 500, json: {} }));
  await assert.rejects(
    () => http500.memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' }),
    (err: unknown) => err instanceof GraphUnavailableError,
  );
});

test('GraphQL errors raise GraphQueryError with the messages intact', async () => {
  const { memory } = reader(() => ({ json: { errors: [{ message: 'no such field: purchaseKey' }] } }));
  await assert.rejects(
    () => memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' }),
    (err: unknown) => err instanceof GraphQueryError && err.errors[0]!.message.includes('no such field'),
  );
});

test('a missing workspace is NOT_FOUND, distinct from a transport failure', async () => {
  const { memory } = reader(() => ({ json: { data: { _meta: META, workspace: null } } }));
  await assert.rejects(
    () => memory.getWorkspaceStats('never-created'),
    (err: unknown) => err instanceof CommonError && err.code === 'NOT_FOUND',
  );
});

// --------------------------------------------------------------------- stats

test('keeps token units separate and integer-exact', async () => {
  const twoAssets = {
    ...WORKSPACE_ROW,
    spendByAsset: [
      { asset: '0.0.0', settledAmount: '50000000', settledPayments: 1, rawSettledAmount: '100000000', rawSettledPayments: 2 },
      { asset: '0.0.999', settledAmount: '90071992547409930000', settledPayments: 3, rawSettledAmount: '90071992547409930000', rawSettledPayments: 3 },
    ],
  };
  const { memory } = reader(() => ({ json: { data: { _meta: META, workspace: twoAssets } } }));
  const stats = await memory.getIndexedWorkspaceStats(WORKSPACE_LABEL);

  assert.equal(stats.purchaseSpendByAsset.length, 2);
  assert.equal(stats.purchaseSpend.tokenId, '0.0.0');
  assert.equal(stats.purchaseSpend.decimals, 8);
  // Beyond Number.MAX_SAFE_INTEGER: carried as a string end to end, never a JS number.
  const hts = stats.purchaseSpendByAsset.find(m => m.tokenId === '0.0.999')!;
  assert.equal(hts.amount, '90071992547409930000');
  assert.equal(hts.decimals, 0, 'an unknown asset reports 0 decimals rather than guessing');
  // Raw totals stay available so the index can be reconciled against the event log.
  assert.equal(stats.rawSpendByAsset[0]!.amount, '100000000');
});

test('marks the two counters the index cannot honestly serve', async () => {
  const { memory } = reader(() => ({ json: { data: { _meta: META, workspace: WORKSPACE_ROW } } }));
  const stats = await memory.getIndexedWorkspaceStats(WORKSPACE_LABEL);
  assert.equal(stats.deniedRequestsIndexable, false);
  assert.equal(stats.successfulReusesIsCompletionEvidence, false);
  assert.equal(stats.successfulAcquisitions, 1);
  assert.equal(stats.failedRequests, 0);
});

test('reuse rate is null when the denominator is zero, never 0', async () => {
  const untouched = { ...WORKSPACE_ROW, reuseDecisionCount: 0, deliveredUsableCount: 0 };
  const { memory } = reader(() => ({ json: { data: { _meta: META, workspace: untouched } } }));
  assert.equal((await memory.getIndexedWorkspaceStats(WORKSPACE_LABEL)).reuseRate, null);

  const used = reader(() => ({ json: { data: { _meta: META, workspace: WORKSPACE_ROW } } }));
  assert.equal((await used.memory.getIndexedWorkspaceStats(WORKSPACE_LABEL)).reuseRate, 0.5);
});

// ------------------------------------------------------------ HCS hydration

test('accepts a decision note only when every identifier re-hashes to the indexed value', async () => {
  const { memory } = reader((url) => url === ENDPOINT
    ? { json: { data: { _meta: META, decisions: [DECISION_ROW] } } }
    : { json: topicMessage(HCS_NOTE) });

  const page = await memory.getIndexedDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  const decision = page.items[0]!;
  assert.equal(decision.rationale?.binding, 'verified');
  assert.equal(decision.rationale?.reason, 'A fresh delivered result already exists for this purchase key.');
  assert.equal(decision.rationale?.rejected, 'Buy a second copy');
  // A verified note supplies the plaintext, so no hex leaks into the record.
  assert.equal(decision.agentId, AGENT_LABEL);
  assert.equal(decision.operationId, OPERATION_LABEL);
  assert.equal(decision.type, 'reuse');
});

test('rejects a forged note: anyone may post to the topic, so the hash check decides', async () => {
  const forged = { ...HCS_NOTE, agentId: 'agent-attacker', reason: 'trust me, this was fine' };
  const { memory } = reader((url) => url === ENDPOINT
    ? { json: { data: { _meta: META, decisions: [DECISION_ROW] } } }
    : { json: topicMessage(forged) });

  const page = await memory.getIndexedDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  const decision = page.items[0]!;
  assert.equal(decision.rationale?.binding, 'mismatched');
  assert.match(decision.rationale!.mismatchReason!, /agentId/);
  // The unverified label must not replace the indexed identifier.
  assert.equal(decision.agentId, AGENT_ID);
});

test('a decision predating HCS reports rationale unavailable rather than inventing text', async () => {
  const old = { ...DECISION_ROW, hcsSequenceNumber: null, rationaleAvailable: false };
  const { memory } = reader(() => ({ json: { data: { _meta: META, decisions: [old] } } }));

  const indexed = await memory.getIndexedDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  assert.equal(indexed.items[0]!.rationaleAvailable, false);
  assert.equal(indexed.items[0]!.rationale, undefined);

  const records = await memory.getDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  const record = records.items[0]!;
  assert.equal(record.reason, RATIONALE_UNAVAILABLE);
  assert.equal(record.chosen, RATIONALE_UNAVAILABLE);
});

test('an unreachable mirror node degrades rationale, it does not fail the query', async () => {
  const { memory } = reader((url) => {
    if (url === ENDPOINT) return { json: { data: { _meta: META, decisions: [DECISION_ROW] } } };
    throw new Error('mirror node unreachable');
  });
  const page = await memory.getIndexedDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.rationale, undefined);
  assert.equal(page.items[0]!.rationaleAvailable, true, 'the event still says a note exists');
});

test('getDecisionHistory satisfies the shared interface with a verified note', async () => {
  const { memory } = reader((url) => url === ENDPOINT
    ? { json: { data: { _meta: META, decisions: [DECISION_ROW] } } }
    : { json: topicMessage(HCS_NOTE) });
  const page = await memory.getDecisionHistory({ workspaceId: WORKSPACE_LABEL });
  const record = page.items[0]!;
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.decisionId, DECISION_LABEL);
  assert.equal(record.chosen, 'result-1789073544816');
  assert.equal(record.result?.workspaceId, WORKSPACE_LABEL);
});

test('the real gateway auth error is surfaced, not swallowed as empty', async () => {
  // Verbatim from https://gateway.thegraph.com with a bad key. A caller must see this
  // as a failure; read as an empty page it would mean "nothing was purchased".
  const { memory } = reader(() => ({ json: { errors: [{ message: 'auth error: malformed API key' }] } }));
  await assert.rejects(
    () => memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' }),
    (err: unknown) => err instanceof GraphQueryError && /auth error/.test(err.message),
  );
});

test('a pinned query beyond the indexed head raises rather than returning nothing', async () => {
  const { memory } = reader(() => ({
    json: { errors: [{ message: 'failed to get block number: block 99999999 is not indexed yet' }] },
  }));
  await assert.rejects(
    () => memory.findPurchases({ workspaceId: 'w', purchaseKey: 'k' }),
    (err: unknown) => err instanceof GraphQueryError,
  );
});
