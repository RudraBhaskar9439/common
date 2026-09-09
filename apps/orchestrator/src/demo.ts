import { findReusablePurchase } from '@common/agent-tools';
import type { DecisionRecord } from '@common/interfaces';
import { createMockResultStore, DEMO_NOW, fixturePurchase, mockMemoryReader } from '@common/mocks';

console.log('COMMON MOCK DEMO — fixed fixtures; no chain, Graph endpoint, payment or HCS write');
const candidate = await findReusablePurchase(mockMemoryReader, {
  workspaceId: fixturePurchase.workspaceId, purchaseKey: fixturePurchase.purchaseKey,
}, { now: DEMO_NOW, capabilities: ['historical-data'] });
if (!candidate?.result) throw new Error('Expected a reusable fixture');
const result = await createMockResultStore().get(candidate.result);
const decision: DecisionRecord = {
  schemaVersion: 1, decisionId: 'mock-decision-1', workspaceId: candidate.workspaceId,
  agentId: 'mock-agent-b', type: 'reuse', chosen: candidate.result.id,
  rejected: 'Purchase a fresh copy', reason: 'Matching delivered result is fresh and supports historical data.',
  createdAt: DEMO_NOW, operationId: candidate.operationId, result: candidate.result,
};
console.log(JSON.stringify({ decision, retrievedResult: result, newPaymentsExecuted: 0 }, null, 2));
