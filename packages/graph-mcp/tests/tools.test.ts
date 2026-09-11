import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { GraphUnavailableError } from '@common/graph-client';
import type { Page } from '@common/interfaces';
import type { GraphMemoryReader, IndexedPurchase } from '@common/graph-client';
import type { IndexedDecision, IndexedWorkspaceStats } from '@common/graph-client';
import { buildTools, evaluateReuse } from '../src/index.js';

const NOW = '2026-09-12T00:00:00.000Z';
const FRESH = '2026-09-13T00:00:00.000Z';
const STALE = '2026-09-11T00:00:00.000Z';

const purchase = (over: Partial<IndexedPurchase> = {}, drop: readonly string[] = []): IndexedPurchase => {
  const base: IndexedPurchase = {
    operationId: '0xop', operationIdHex: '0xop', workspaceId: 'ws-1', purchaseKey: 'key-1',
    agentIdHex: '0xagent', status: 'delivered',
    amount: { amount: '50000000', tokenId: '0.0.0', decimals: 8 },
    resource: 'https://paid.example/datasets/x', payTo: '0.0.1',
    reservedAt: NOW, expiresAt: FRESH, capabilitiesIndexed: false,
    result: { id: 'result-1', workspaceId: 'ws-1' },
    outcome: { usable: true, freshUntil: FRESH, capabilities: [] },
    ...over,
  };
  for (const key of drop) delete (base as unknown as Record<string, unknown>)[key];
  return base;
};

const page = <T>(items: T[], status: 'synced' | 'lagging' | 'unknown' = 'synced'): Page<T> =>
  ({ items, nextCursor: null, index: { status, indexedBlock: '40394976' } });

function tools(over: Partial<GraphMemoryReader> = {}) {
  const memory = {
    async findIndexedPurchases() { return page<IndexedPurchase>([]); },
    async getIndexedDecisionHistory() { return page<IndexedDecision>([]); },
    async getIndexedWorkspaceStats() { throw new Error('not stubbed'); },
    async getPurchase() { return null; },
    async findPurchases() { return page<IndexedPurchase>([]); },
    async getDecisionHistory() { return page<never>([]); },
    async getWorkspaceStats() { throw new Error('not stubbed'); },
    ...over,
  } as unknown as GraphMemoryReader;
  const list = buildTools({ memory, now: () => NOW });
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const tool = list.find(t => t.name === name);
      assert.ok(tool, `no tool named ${name}`);
      const res = await tool.handler(args as never);
      return { isError: 'isError' in res && res.isError === true, body: JSON.parse(res.content[0]!.text) };
    },
    list,
  };
}

// -------------------------------------------------------- the reuse verdict

test('a delivered, usable, fresh purchase with a result is reusable', () => {
  const v = evaluateReuse(purchase(), NOW);
  assert.equal(v.reusable, true);
  assert.deepEqual(v.checks, {
    delivered: true, usable: true, fresh: true, hasResultReference: true, settlementCertain: true,
  });
  assert.equal(v.capabilitiesMustBeCheckedElsewhere, true);
});

test('every rejection names its reason, so a model can explain itself', () => {
  const stale = evaluateReuse(purchase({ outcome: { usable: true, freshUntil: STALE, capabilities: [] } }), NOW);
  assert.equal(stale.reusable, false);
  assert.match(stale.explanation, /freshness expired/);

  const unusable = evaluateReuse(purchase({
    status: 'delivery_failed',
    outcome: { usable: false, freshUntil: FRESH, capabilities: [], failureReason: 'corrupt payload' },
  }), NOW);
  assert.equal(unusable.reusable, false);
  assert.match(unusable.explanation, /not "delivered"/);
  assert.equal(unusable.failureReason, 'corrupt payload');

  const noRef = evaluateReuse(purchase({}, ['result']), NOW);
  assert.equal(noRef.reusable, false);
  assert.match(noRef.explanation, /no result reference/);
});

test('a purchase whose settlement is unresolved is never offered for reuse', () => {
  const v = evaluateReuse(purchase({ status: 'settlement_unknown', settlementUnknownAt: NOW }), NOW);
  assert.equal(v.reusable, false);
  assert.equal(v.checks.settlementCertain, false);
  assert.match(v.explanation, /settlement was flagged unknown/);
});

// ------------------------------------------------- absence is not permission

test('no candidate returns an explicit refusal to authorize, not a bare empty list', async () => {
  const { call } = tools();
  const { body } = await call('find_reuse_candidate', { workspaceId: 'ws-1', purchaseKey: 'key-1' });
  assert.equal(body.candidateFound, false);
  assert.equal(body.candidate, null);
  assert.match(body.ifNoCandidate, /does NOT authorize/);
  assert.match(body.index.caveat, /not authorization to buy/);
});

test('a lagging index says so in the payload, where a model will actually read it', async () => {
  const { call } = tools({ async findIndexedPurchases() { return page<IndexedPurchase>([], 'lagging'); } });
  const { body } = await call('find_reuse_candidate', { workspaceId: 'ws-1', purchaseKey: 'key-1' });
  assert.equal(body.index.status, 'lagging');
  assert.match(body.index.caveat, /INDEX IS BEHIND THE CHAIN/);
  assert.match(body.index.caveat, /Absence proves nothing/);
});

test('a transport failure is an error, never an empty-looking success', async () => {
  const { call } = tools({
    async findIndexedPurchases() { throw new GraphUnavailableError('ECONNREFUSED'); },
  });
  const { isError, body } = await call('find_reuse_candidate', { workspaceId: 'w', purchaseKey: 'k' });
  assert.equal(isError, true);
  assert.equal(body.error, 'index_unreachable');
  assert.match(body.doNotConclude, /NOT evidence that nothing was purchased/);
});

test('every matching purchase is returned, not only the winner', async () => {
  const { call } = tools({
    async findIndexedPurchases() {
      return page([
        purchase({ operationId: '0xa', status: 'expired' }),
        purchase({ operationId: '0xb' }),
      ]);
    },
  });
  const { body } = await call('find_reuse_candidate', { workspaceId: 'ws-1', purchaseKey: 'key-1' });
  assert.equal(body.allMatchingPurchases.length, 2);
  assert.equal(body.candidate.operationId, '0xb');
});

// -------------------------------------------------------- rationale binding

test('a mismatched HCS note is marked untrustworthy and its text is not presented as reasoning', async () => {
  const decision: IndexedDecision = {
    decisionId: '0xd', workspaceId: 'ws-1', agentId: '0xagent', agentIdHex: '0xagent',
    type: 'reuse', recordedAt: NOW, rationaleAvailable: true, reEmissionCount: 0,
    rationale: {
      chosen: 'x', rejected: 'y', reason: 'trust me',
      authoredAt: NOW, consensusAt: NOW,
      labels: { decisionId: 'd', workspaceId: 'w', agentId: 'attacker', operationId: 'o' },
      binding: 'mismatched', mismatchReason: 'does not hash to the indexed agentId',
    },
  };
  const { call } = tools({ async getIndexedDecisionHistory() { return page([decision]); } });
  const { body } = await call('get_decision_history', { workspaceId: 'ws-1' });
  assert.equal(body.decisions[0].rationale.trustworthy, false);
  assert.match(body.decisions[0].rationale.note, /REJECTED/);
});

test('a decision with no note reports that rather than inventing reasoning', async () => {
  const decision: IndexedDecision = {
    decisionId: '0xd', workspaceId: 'ws-1', agentId: '0xagent', agentIdHex: '0xagent',
    type: 'reuse', recordedAt: NOW, rationaleAvailable: false, reEmissionCount: 0,
  };
  const { call } = tools({ async getIndexedDecisionHistory() { return page([decision]); } });
  const { body } = await call('get_decision_history', { workspaceId: 'ws-1' });
  assert.equal(body.decisions[0].rationale.available, false);
  assert.match(body.decisions[0].rationale.reason, /no note was published/);
});

// ------------------------------------------------------------------- stats

test('unindexable counters are flagged, and a zero-denominator reuse rate stays null', async () => {
  const stats = {
    workspaceId: 'ws-1', successfulReuses: 0, successfulAcquisitions: 0, failedRequests: 0,
    deniedRequests: 0, purchaseSpend: { amount: '0', tokenId: '0.0.0', decimals: 8 },
    purchaseSpendByAsset: [], rawSpendByAsset: [],
    deniedRequestsIndexable: false as const, successfulReusesIsCompletionEvidence: false as const,
    reservedCount: 0, settledCount: 0, releasedCount: 0, expiredCount: 0, settlementUnknownCount: 0,
    buyDecisionCount: 0, waitDecisionCount: 0, rejectDecisionCount: 0, decisionCount: 0,
    budget: { amount: '0', tokenId: '0.0.0', decimals: 8 }, reuseRate: null,
  } as IndexedWorkspaceStats;
  const { call } = tools({ async getIndexedWorkspaceStats() { return stats; } });
  const { body } = await call('get_workspace_spending', { workspaceId: 'ws-1' });
  assert.equal(body.reuseRate, null);
  assert.match(body.reuseRateNote, /Not the same as a reuse rate of 0/);
  assert.match(body.notIndexable.deniedRequests, /Not indexable/);
  assert.match(body.notIndexable.reuseIsIntentionNotCompletion, /Nothing on chain says/);
});

test('a purchase that is not indexed does not read as proof it was never bought', async () => {
  const { call } = tools();
  const { body } = await call('inspect_purchase', { operationId: 'op-x', workspaceId: 'ws-1', purchaseKey: 'k' });
  assert.equal(body.found, false);
  assert.match(body.doNotConclude, /not evidence that no purchase was made/);
});

// -------------------------------------------- read-only, structurally

test('every tool is annotated read-only', () => {
  const { list } = tools();
  assert.equal(list.length, 5);
  for (const tool of list) assert.equal(tool.config.annotations.readOnlyHint, true);
});

test('the package cannot reach a payment or contract-writing module', () => {
  // Structural, not advisory: no prompt can reach a spending path that is absent from the
  // dependency graph. Mirrors the guarantee the HCS publisher makes on the write side.
  const dir = new URL('../src/', import.meta.url).pathname;
  const sources = readdirSync(dir).filter(f => f.endsWith('.ts'));
  assert.ok(sources.length >= 4);
  for (const file of sources) {
    const text = readFileSync(join(dir, file), 'utf8');
    const imports = [...text.matchAll(/from '([^']+)'/g)].map(m => m[1]!);
    for (const specifier of imports) {
      assert.doesNotMatch(specifier, /hedera-adapter|@hashgraph\/sdk|ethers|result-store|paid-service/,
        `${file} imports ${specifier}, which could reach payment or signing code`);
    }
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies)) {
    assert.doesNotMatch(dep, /hedera|hashgraph|ethers|result-store/, `${dep} is a spending-capable dependency`);
  }
});
