import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createEvaluationRunner, defaultEvaluationSpec } from '@common/evaluation-runner';
import { validateEvaluationReport, summarizeEvaluation } from '@common/agent-tools';
import { CommonDatabase } from '@common/result-store';
import { createEvaluationWorkflow } from './workflows/evaluation.js';

// Always local, regardless of .env. Real inference; never constructs a spending adapter.
const dir = fileURLToPath(new URL(`../../../.common-data/benchmark-${Date.now()}/`, import.meta.url));
await mkdir(dir, { recursive: true });
const spec = { ...await defaultEvaluationSpec(), generation: randomUUID() };
const runner = createEvaluationRunner({ artifactDir: join(dir, 'artifacts') });
const baselineStart = performance.now();
for (const agent of ['a','b']) {
  console.log(`Baseline: actual evaluation for agent ${agent}`);
  const report = await runner.run({ jobId: `baseline-${agent}`, spec });
  validateEvaluationReport(report, spec);
  if (report.tasks.some(t => t.outcome === 'infrastructure_error')) throw new Error('Baseline infrastructure failure');
  await writeFile(join(dir, `baseline-${agent}.json`), JSON.stringify(report, null, 2));
}
const baselineMs = Math.round(performance.now() - baselineStart);
const db = new CommonDatabase(join(dir, 'benchmark.sqlite'));
let sharedRuns = 0;
const workflow = createEvaluationWorkflow({ database: db, workspaceId: 'benchmark', executor: { mode: 'local', execute: async op => { sharedRuns++; return { report: await runner.run({ jobId: op.operationId, spec: op.spec }) }; } } });
try {
  console.log('Shared memory: agent A acquires; agent B retrieves the same validated report');
  const sharedStart = performance.now();
  const a = await workflow.request({ requestId: 'a', agentId: 'agent-a', spec }); await workflow.idle();
  const reuseStart = performance.now();
  await workflow.request({ requestId: 'b', agentId: 'agent-b', spec }); await workflow.idle();
  const reuseMs = performance.now() - reuseStart;
  const sharedMs = Math.round(performance.now() - sharedStart);
  const stats = await workflow.memory.getWorkspaceStats('benchmark');
  if (sharedRuns !== 1 || stats.successfulAcquisitions !== 1 || stats.successfulReuses !== 1) throw new Error('Reuse benchmark did not complete');
  const report = await workflow.report(a.operation.operationId);
  await writeFile(join(dir, 'shared-report.json'), JSON.stringify(report, null, 2));
  const evidence = { measuredAt: new Date().toISOString(), source: 'actual local Ollama inference', measurementContext: spec.measurementContext,
    baseline: { requests: 2, evaluationRuns: 2, modelTaskExecutions: 20, durationMs: baselineMs },
    shared: { requests: 2, evaluationRuns: sharedRuns, modelTaskExecutions: 10, durationMs: sharedMs, retrievalMs: Math.round(reuseMs * 100) / 100, reuseRate: 0.5 },
    blockchainPayments: 0, fiatSpent: 0, modelSummary: summarizeEvaluation(report),
    limitations: ['Sequential runs on one machine; cache, warm-up and order influence timings.', 'This measures avoided computation, not verified HBAR savings or production model reliability.'],
  };
  await writeFile(join(dir, 'measurement.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2)); console.log(`Evidence directory: ${dir}`);
} finally { await workflow.close(); db.close(); }
