/**
 * The buyer agent is advisory. These tests prove the orchestrator-side rules hold no matter
 * what the model says, and that a missing or broken model falls back to policy. A labeled
 * fake fetch stands in for OpenAI; nothing here contacts the network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIBuyer, policyDecision, enforce, type BuyerInput } from '@common/orchestrator';

const HBAR = 100000000n;
const base: BuyerInput = { agentId: 'agent-a', goal: 'Pick a model for the support desk', budgetTinybar: 2n * HBAR, priceTinybar: HBAR / 2n, candidates: [], allowed: ['buy', 'reject'] };
const withReport: BuyerInput = { ...base, agentId: 'agent-b', allowed: ['reuse', 'reject'], candidates: [{ operationId: 'op-1', agentId: 'agent-a', status: 'completed', ageMinutes: 3, fresh: true, summary: 'qwen3:4b 4/5' }] };

function fakeOpenAI(content: string | null, status = 200): typeof fetch {
  return (async () => new Response(content === null ? 'upstream error' : JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;
}

test('policy buys within budget, reuses a fresh report, rejects when the price exceeds the budget', () => {
  assert.equal(policyDecision(base).action, 'buy');
  assert.equal(policyDecision(withReport).action, 'reuse');
  assert.equal(policyDecision({ ...base, budgetTinybar: HBAR / 10n }).action, 'reject');
});

test('the model decides and explains in its own words when its choice is valid', async () => {
  const buyer = createOpenAIBuyer({ apiKey: 'test', fetchImpl: fakeOpenAI('{"action":"buy","reason":"Nothing in memory; 0.5 HBAR is within my 2 HBAR budget."}') });
  const decision = await buyer.decide(base);
  assert.equal(decision.action, 'buy');
  assert.equal(decision.source, 'openai');
  assert.match(decision.reason, /within my 2 HBAR budget/);
});

test('the model cannot overspend, reuse from empty memory or pick an unavailable action', async () => {
  const over = await createOpenAIBuyer({ apiKey: 'test', fetchImpl: fakeOpenAI('{"action":"buy","reason":"Worth it."}') }).decide({ ...base, budgetTinybar: HBAR / 10n });
  assert.equal(over.action, 'reject');
  assert.match(over.reason, /overridden/);

  const empty = enforce(base, { action: 'reuse', reason: 'Reuse it.', source: 'openai' });
  assert.equal(empty.action, 'buy');
  assert.match(empty.reason, /overridden/);

  const unavailable = enforce(withReport, { action: 'buy', reason: 'Buy again.', source: 'openai' });
  assert.equal(unavailable.action, 'reuse');
});

test('a claimed operation that is still running is attached to, never bought again', () => {
  const running = policyDecision({ ...withReport, candidates: [{ operationId: 'op-1', agentId: 'agent-a', status: 'running', ageMinutes: 1, fresh: false }] });
  assert.equal(running.action, 'reuse');
  assert.match(running.reason, /Attaching/);
});

test('an unavailable or malformed model response falls back to policy', async () => {
  for (const fetchImpl of [fakeOpenAI(null, 500), fakeOpenAI('not json'), fakeOpenAI('{"action":"wait","reason":"x"}')]) {
    const decision = await createOpenAIBuyer({ apiKey: 'test', fetchImpl }).decide(withReport);
    assert.equal(decision.source, 'policy');
    assert.equal(decision.action, 'reuse');
  }
});
