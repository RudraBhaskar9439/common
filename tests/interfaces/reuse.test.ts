import assert from 'node:assert/strict';
import test from 'node:test';
import { findReusablePurchase } from '@common/agent-tools';
import type { MemoryReader, Purchase } from '@common/interfaces';
import { createMockResultStore, DEMO_NOW, fixturePurchase, mockMemoryReader } from '@common/mocks';

const query = { workspaceId: fixturePurchase.workspaceId, purchaseKey: fixturePurchase.purchaseKey };
const requirements = { now: DEMO_NOW, capabilities: ['historical-data'] };
function withPurchase(purchase: Purchase): MemoryReader {
  return { ...mockMemoryReader, async findPurchases() {
    return { items: [purchase], nextCursor: null, index: { status: 'unknown', indexedBlock: null } };
  } };
}
test('fresh compatible delivered fixture can be retrieved', async () => {
  const found = await findReusablePurchase(mockMemoryReader, query, requirements);
  assert.ok(found?.result);
  const result = await createMockResultStore().get(found.result);
  assert.equal(result.reference.id, found.result.id);
});
for (const [label, mutate] of [
  ['expired', (p: Purchase) => { p.outcome!.freshUntil = DEMO_NOW; }],
  ['unusable', (p: Purchase) => { p.outcome!.usable = false; }],
  ['wrong capability', (p: Purchase) => { p.outcome!.capabilities = []; }],
  ['undelivered', (p: Purchase) => { p.status = 'paid'; }],
  ['wrong workspace', (p: Purchase) => { p.workspaceId = 'other'; }],
  ['wrong resource', (p: Purchase) => { p.purchaseKey = 'other'; }],
  ['foreign result reference', (p: Purchase) => { p.result!.workspaceId = 'other'; }],
  ['invalid freshness', (p: Purchase) => { p.outcome!.freshUntil = 'invalid'; }],
] as const) {
  test(`rejects ${label} fixture even if returned by the reader`, async () => {
    const purchase = structuredClone(fixturePurchase); mutate(purchase);
    assert.equal(await findReusablePurchase(withPurchase(purchase), query, requirements), null);
  });
}
test('mock storage keeps workspace keys separate', async () => {
  await assert.rejects(createMockResultStore().get({ id: 'mock-result-1', workspaceId: 'other' }), { code: 'NOT_FOUND' });
});

test('discovery reads subsequent pages and fails closed on cursor loops', async () => {
  let calls = 0;
  const reader: MemoryReader = { ...mockMemoryReader, async findPurchases(q) {
    calls++;
    return { items: q.cursor ? [fixturePurchase] : [], nextCursor: q.cursor ? null : 'page-2', index: { status: 'unknown', indexedBlock: null } };
  } };
  assert.equal((await findReusablePurchase(reader, query, requirements))?.operationId, fixturePurchase.operationId);
  assert.equal(calls, 2);
  const looping: MemoryReader = { ...reader, async findPurchases() { return { items: [], nextCursor: 'same', index: { status: 'unknown', indexedBlock: null } }; } };
  await assert.rejects(findReusablePurchase(looping, query, requirements), /repeated cursor/);
});
