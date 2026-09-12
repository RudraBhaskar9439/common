import { resolve, join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { createEvaluationRunner, defaultEvaluationSpec } from './index.js';

const dir = resolve(process.env['COMMON_DATA_DIR'] ?? '../../.common-data');
const spec = await defaultEvaluationSpec();
if (process.env['COMMON_SMOKE'] === '1') spec.taskIds = ['assign-ticket'];
const jobId = `local-${Date.now()}`;
console.log('LIVE LOCAL INFERENCE — no Hedera payment. Models:', spec.models.map(m => m.id).join(', '));
const runner = createEvaluationRunner({ artifactDir: join(dir, 'artifacts'), onProgress: t => console.log(`${t.modelId} ${t.taskId}: ${t.outcome} (${t.steps.length} actions, ${t.durationMs}ms)`) });
const report = await runner.run({ jobId, spec });
await mkdir(dir, { recursive: true });
const path = join(dir, `${jobId}.json`);
await writeFile(path, JSON.stringify(report, null, 2));
console.log('Report:', path);
if (report.tasks.some(t => t.outcome === 'infrastructure_error')) process.exitCode = 1;
