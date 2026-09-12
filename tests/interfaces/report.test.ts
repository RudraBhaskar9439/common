import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvaluationReport } from '@common/interfaces';
import { evaluationSpecHash, summarizeEvaluation, validateEvaluationReport } from '@common/agent-tools';
import { fixtureEvaluationSpec } from '@common/mocks';

function fixtureReport(): EvaluationReport {
  return { schemaVersion: 1, source: 'fixture', jobId: 'fixture-report', specHash: evaluationSpecHash(fixtureEvaluationSpec), spec: structuredClone(fixtureEvaluationSpec),
    startedAt: '2026-09-12T00:00:00Z', completedAt: '2026-09-12T00:01:00Z', freshUntil: '2026-09-13T00:00:00Z', limitations: ['Fixture; no inference'],
    tasks: fixtureEvaluationSpec.models.flatMap(model => fixtureEvaluationSpec.taskIds.map(taskId => ({ modelId: model.id, modelRevision: model.revision, taskId, repetition: 0, outcome: 'failed' as const, checks: [{ name: 'Fixture check', passed: false }], steps: [], durationMs: 0, inputTokens: 0, outputTokens: 0 }))),
  };
}
test('complete measured failures remain a valid report, not a fake successful model', () => {
  const report = fixtureReport(); validateEvaluationReport(report);
  assert.equal(summarizeEvaluation(report)[0]!.passRate, 0);
});
for (const [name, change] of [
  ['missing task', (r: EvaluationReport) => { r.tasks = r.tasks.slice(1); }],
  ['duplicate task', (r: EvaluationReport) => { r.tasks = [r.tasks[1]!, ...r.tasks.slice(1)]; }],
  ['changed revision', (r: EvaluationReport) => { r.tasks[0]!.modelRevision = `sha256:${'f'.repeat(64)}`; }],
  ['claimed pass without checks', (r: EvaluationReport) => { r.tasks[0]!.outcome = 'passed'; }],
  ['inflated token total', (r: EvaluationReport) => { r.tasks[0]!.inputTokens = 99; }],
  ['unsafe artifact path', (r: EvaluationReport) => { r.tasks[0]!.traceId = '../../secret'; }],
] as const) test(`rejects ${name}`, () => { const report = fixtureReport(); change(report); assert.throws(() => validateEvaluationReport(report)); });
