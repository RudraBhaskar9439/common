import type { EvaluationSpec } from '@common/interfaces';
import { BROWSER_TASK_IDS } from '@common/interfaces';

/** Invented model digests for contract tests. Never execute or present as measured inference. */
export const fixtureEvaluationSpec: EvaluationSpec = {
  schemaVersion: 1,
  suiteId: 'support-desk', suiteVersion: '1', applicationVersion: '1', runnerVersion: '1',
  promptVersion: '1', toolVersion: '1', measurementContext: 'fixture-no-hardware', generation: 'initial',
  models: [
    { id: 'qwen3:1.7b', revision: `sha256:${'1'.repeat(64)}`, license: 'Apache-2.0', quantization: 'Q4_K_M' },
    { id: 'qwen3:4b', revision: `sha256:${'2'.repeat(64)}`, license: 'Apache-2.0', quantization: 'Q4_K_M' },
  ],
  taskIds: [...BROWSER_TASK_IDS], repetitions: 1, maxSteps: 8,
  maxTaskDurationMs: 120000, maxOutputTokens: 256, contextTokens: 4096,
  temperature: 0, seed: 42,
};
