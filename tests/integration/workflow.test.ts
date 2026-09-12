import assert from 'node:assert/strict';
import test from 'node:test';
import { CommonError, type EvaluationReport, type EvaluationSpec } from '@common/interfaces';
import { evaluationSpecHash } from '@common/agent-tools';
import { CommonDatabase } from '@common/result-store';
import { createEvaluationWorkflow, type EvaluationOperation, type EvaluationExecutor } from '@common/orchestrator';
import { fixtureEvaluationSpec } from '@common/mocks';

function fixtureReport(jobId: string, spec: EvaluationSpec): EvaluationReport {
  return { schemaVersion: 1, source: 'fixture', jobId, specHash: evaluationSpecHash(spec), spec,
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), freshUntil: new Date(Date.now()+86400000).toISOString(), limitations: ['Test fixture; no inference or blockchain'],
    tasks: spec.models.flatMap(m => spec.taskIds.map(taskId => ({ modelId: m.id, modelRevision: m.revision, taskId, repetition: 0, outcome: 'failed', checks: [{ name: 'Fixture failure', passed: false }], steps: [], durationMs: 0, inputTokens: 0, outputTokens: 0 }))),
  };
}

test('two agents share one actual acquisition; completion counters are idempotent; fixture executor', async () => {
  const db = new CommonDatabase(':memory:'); let runs = 0;
  let finish!: () => void; const gate = new Promise<void>(r => { finish = r; });
  const workflow = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor: { mode: 'local', execute: async op => { runs++; await gate; return { report: fixtureReport(op.operationId,op.spec) }; } } });
  try {
    const [a,b] = await Promise.all([
      workflow.request({ requestId: 'a', agentId: 'agent-a', spec: fixtureEvaluationSpec }),
      workflow.request({ requestId: 'b', agentId: 'agent-b', spec: fixtureEvaluationSpec }),
    ]);
    assert.equal(a.operation.operationId, b.operation.operationId); assert.equal(runs, 1);
    assert.equal((await workflow.memory.getWorkspaceStats('w')).successfulReuses, 0);
    finish(); await workflow.idle();
    await workflow.request({ requestId: 'b', agentId: 'agent-b', spec: fixtureEvaluationSpec });
    const stats = await workflow.memory.getWorkspaceStats('w');
    assert.equal(stats.successfulReuses, 1); assert.equal(stats.successfulAcquisitions, 1);
    assert.equal(stats.purchaseSpend.amount, '0'); assert.equal(runs, 1);
    await assert.rejects(workflow.request({ requestId: 'b', agentId: 'agent-b', spec: { ...fixtureEvaluationSpec, generation: 'different' } }), /conflicting/);
    await assert.rejects(workflow.memory.getWorkspaceStats('other'), { code: 'UNAUTHORIZED' });
    const changed = await workflow.request({ requestId: 'c', agentId: 'agent-a', spec: { ...fixtureEvaluationSpec, generation: 'new' } });
    assert.notEqual(changed.operation.operationId, a.operation.operationId);
    await workflow.idle(); assert.equal(runs, 2);
  } finally { finish(); await workflow.close(); db.close(); }
});

test('unknown payment does not become a second acquisition or a successful reuse', async () => {
  const db = new CommonDatabase(':memory:'); let attempts = 0;
  const workflow = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor: { mode: 'hedera-testnet', execute: async () => { attempts++; throw new CommonError('SETTLEMENT_UNKNOWN', 'fixture uncertainty'); } } });
  try {
    const a = await workflow.request({ requestId: 'a', agentId: 'agent-a', spec: fixtureEvaluationSpec }); await workflow.idle();
    const b = await workflow.request({ requestId: 'b', agentId: 'agent-b', spec: fixtureEvaluationSpec }); await workflow.idle();
    assert.equal(a.operation.operationId, b.operation.operationId); assert.equal(attempts, 1);
    assert.equal(workflow.get(a.operation.operationId).status, 'settlement_unknown');
    assert.equal((await workflow.memory.getWorkspaceStats('w')).successfulReuses, 0);
  } finally { await workflow.close(); db.close(); }
});

test('stale result is rejected without silently purchasing again', async () => {
  const db = new CommonDatabase(':memory:'); let runs = 0;
  const workflow = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor: { mode: 'local', execute: async op => { runs++; return { report: fixtureReport(op.operationId,op.spec) }; } } });
  try {
    const a = await workflow.request({ requestId: 'a', agentId: 'agent-a', spec: fixtureEvaluationSpec }); await workflow.idle();
    const key = JSON.stringify(['w', a.operation.operationId]);
    const stored = db.get<{ content: EvaluationReport }>('results', key)!;
    stored.content.startedAt = '2000-01-01T00:00:00Z'; stored.content.completedAt = '2000-01-01T00:01:00Z'; stored.content.freshUntil = '2000-01-02T00:00:00Z'; db.set('results', key, stored);
    await assert.rejects(workflow.request({ requestId: 'b', agentId: 'agent-b', spec: fixtureEvaluationSpec }), /stale/);
    assert.equal(runs, 1); assert.equal((await workflow.memory.getWorkspaceStats('w')).successfulReuses, 0);
  } finally { await workflow.close(); db.close(); }
});

test('restart completes an already-stored report without rerunning compute', async () => {
  const db = new CommonDatabase(':memory:'); let runs = 0;
  const executor: EvaluationExecutor = { mode: 'local', execute: async op => { runs++; return { report: fixtureReport(op.operationId,op.spec) }; } };
  const first = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor });
  const a = await first.request({ requestId: 'a', agentId: 'agent-a', spec: fixtureEvaluationSpec }); await first.idle(); await first.close();
  const operation = db.get<EvaluationOperation>('evaluations', a.operation.operationId)!;
  db.set('evaluations', operation.operationId, { ...operation, status: 'running' });
  const restored = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor });
  try { restored.resume(); await restored.idle(); assert.equal(runs, 1); assert.equal(restored.get(operation.operationId).status, 'completed'); }
  finally { await restored.close(); db.close(); }
});

test('decision retries survive workflow replacement and cannot execute payments', async () => {
  const db = new CommonDatabase(':memory:'); let executions = 0; let publications = 0;
  const executor: EvaluationExecutor = { mode: 'local', execute: async op => { executions++; return { report: fixtureReport(op.operationId,op.spec) }; }, publishDecision: async () => { throw new Error('fixture HCS outage'); } };
  const first = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor });
  await first.request({ requestId: 'a', agentId: 'agent-a', spec: fixtureEvaluationSpec }); await first.idle(); await first.flushDecisions(); await first.close();
  assert.equal(db.list('decision-outbox').length, 1);
  const restored = createEvaluationWorkflow({ database: db, workspaceId: 'w', executor: { ...executor, publishDecision: async d => { publications++; return { decisionId: d.decisionId, hcsStatus: 'confirmed', eventStatus: 'confirmed' }; } } });
  try { await restored.flushDecisions(); await restored.flushDecisions(); assert.equal(publications, 1); assert.equal(executions, 1); assert.equal(db.list('decision-outbox').length, 0); }
  finally { await restored.close(); db.close(); }
});
