import { resolve, join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { createEvaluationRunner, defaultEvaluationSpec } from './index.js';
import { CommonDatabase, createResultStore } from '@common/result-store';
import { validateEvaluationReport, summarizeEvaluation } from '@common/agent-tools';

const dir = resolve(process.env['COMMON_DATA_DIR'] ?? '../../.common-data');
const spec = await defaultEvaluationSpec();
if (process.env['COMMON_SMOKE'] === '1') spec.taskIds = ['assign-ticket'];
const jobId = `local-${Date.now()}`;
console.log('LIVE LOCAL INFERENCE — no Hedera payment. Models:', spec.models.map(m => m.id).join(', '));
const runner = createEvaluationRunner({ artifactDir: join(dir, 'artifacts'), onProgress: t => console.log(`${t.modelId} ${t.taskId}: ${t.outcome} (${t.steps.length} actions, ${t.durationMs}ms)`) });
const report = await runner.run({ jobId, spec });
validateEvaluationReport(report, spec);
await mkdir(dir, { recursive: true });
const path = join(dir, `${jobId}.json`);
await writeFile(path, JSON.stringify(report, null, 2));
const database = new CommonDatabase(join(dir, 'common.sqlite'));
try {
  await createResultStore({ database, workspaceId: 'local-demo' }).put({ reference: { id: jobId, workspaceId: 'local-demo' }, content: report });
} finally { database.close(); }
console.log('Report:', path);
console.log('Measured comparison:', JSON.stringify(summarizeEvaluation(report)));
if (report.tasks.some(t => t.outcome === 'infrastructure_error')) process.exitCode = 1;
