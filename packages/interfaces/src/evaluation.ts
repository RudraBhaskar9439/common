/** Open-model evaluation contract. See docs/DECISIONS.md for scope and acceptance. */
export const BROWSER_TASK_IDS = [
  'assign-ticket', 'change-priority', 'resolve-ticket', 'add-note', 'filter-tickets',
] as const;
export type BrowserTaskId = typeof BROWSER_TASK_IDS[number];

export interface EvaluationModel {
  /** Ollama model tag; never accept a caller-controlled inference URL. */
  id: string;
  /** Digest resolved from the local model registry before quoting or running. */
  revision: string;
  license: 'Apache-2.0';
  quantization: string;
}

export interface EvaluationSpec {
  schemaVersion: 1;
  suiteId: 'support-desk';
  suiteVersion: string;
  applicationVersion: string;
  runnerVersion: string;
  promptVersion: string;
  toolVersion: string;
  /** Hardware/runtime identity matters when comparing recorded latency. */
  measurementContext: string;
  /** Explicit new measurement generation; retries keep the original value. */
  generation: string;
  models: readonly EvaluationModel[];
  taskIds: readonly BrowserTaskId[];
  repetitions: number;
  maxSteps: number;
  maxTaskDurationMs: number;
  maxOutputTokens: number;
  contextTokens: number;
  temperature: number;
  seed: number;
}

export interface EvaluationRequest {
  operationId: string;
  workspaceId: string;
  agentId: string;
  spec: EvaluationSpec;
}

export type EvaluationJobStatus = 'awaiting_payment' | 'queued' | 'running' | 'completed' | 'failed';
export type BrowserAction =
  | { action: 'click'; target: string }
  | { action: 'fill'; target: string; value: string }
  | { action: 'select'; target: string; value: string }
  | { action: 'done' };

export interface EvaluationStep {
  step: number;
  action?: BrowserAction;
  error?: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TaskEvaluation {
  modelId: string;
  modelRevision: string;
  taskId: BrowserTaskId;
  repetition: number;
  /** A failing model is a measured outcome; infrastructure errors are not model scores. */
  outcome: 'passed' | 'failed' | 'infrastructure_error';
  checks: readonly { name: string; passed: boolean }[];
  steps: readonly EvaluationStep[];
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  failureReason?: string;
  /** Artifact IDs, not arbitrary filesystem paths or public access credentials. */
  traceId?: string;
  screenshotId?: string;
}

export interface EvaluationReport {
  schemaVersion: 1;
  source: 'live' | 'fixture';
  jobId: string;
  specHash: string;
  spec: EvaluationSpec;
  startedAt: string;
  completedAt: string;
  freshUntil: string;
  tasks: readonly TaskEvaluation[];
  limitations: readonly string[];
}

export interface EvaluationJob {
  jobId: string;
  operationId: string;
  workspaceId: string;
  specHash: string;
  status: EvaluationJobStatus;
  createdAt: string;
  updatedAt: string;
  transactionId?: string;
  reportId?: string;
  error?: string;
}

export interface EvaluationRunner {
  run(input: {
    jobId: string;
    spec: EvaluationSpec;
    signal?: AbortSignal;
  }): Promise<EvaluationReport>;
}

/** Reject unbounded or ambiguous requests before reservation, inference, or payment. */
export function validateEvaluationSpec(value: unknown): asserts value is EvaluationSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Evaluation spec must be an object');
  const spec = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'suiteId', 'suiteVersion', 'applicationVersion', 'runnerVersion',
    'promptVersion', 'toolVersion', 'measurementContext', 'generation', 'models', 'taskIds',
    'repetitions', 'maxSteps', 'maxTaskDurationMs', 'maxOutputTokens', 'contextTokens', 'temperature', 'seed'];
  if (Object.keys(spec).some(key => !fields.includes(key))) throw new Error('Unknown evaluation field');
  if (spec['schemaVersion'] !== 1 || spec['suiteId'] !== 'support-desk') throw new Error('Unsupported evaluation schema or suite');
  for (const field of ['suiteVersion', 'applicationVersion', 'runnerVersion', 'promptVersion', 'toolVersion', 'measurementContext', 'generation']) {
    if (typeof spec[field] !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(spec[field] as string)) throw new Error(`Invalid ${field}`);
  }
  const models = spec['models'];
  if (!Array.isArray(models) || models.length !== 2) throw new Error('Exactly two models are required');
  const ids = new Set<string>();
  for (const entry of models) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid model');
    const model = entry as Record<string, unknown>;
    if (Object.keys(model).some(key => !['id', 'revision', 'license', 'quantization'].includes(key))) throw new Error('Unknown model field');
    if (typeof model['id'] !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(model['id'])) throw new Error('Invalid model ID');
    if (ids.has(model['id'])) throw new Error('Duplicate model');
    ids.add(model['id']);
    if (typeof model['revision'] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(model['revision'])) throw new Error('A pinned model digest is required');
    if (model['license'] !== 'Apache-2.0') throw new Error('Unsupported model license');
    if (typeof model['quantization'] !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(model['quantization'])) throw new Error('Invalid quantization');
  }
  const tasks = spec['taskIds'];
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 5
    || new Set(tasks).size !== tasks.length || tasks.some(task => !BROWSER_TASK_IDS.includes(task))) throw new Error('Invalid or duplicate task IDs');
  for (const [field, minimum, maximum] of [
    ['repetitions', 1, 3], ['maxSteps', 1, 12], ['maxTaskDurationMs', 1000, 180000],
    ['maxOutputTokens', 32, 1024], ['contextTokens', 1024, 8192], ['seed', 0, 2147483647],
  ] as const) {
    const number = spec[field];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid ${field}`);
  }
  if (typeof spec['temperature'] !== 'number' || !Number.isFinite(spec['temperature']) || spec['temperature'] < 0 || spec['temperature'] > 1) throw new Error('Invalid temperature');
}

/** Fixed field order makes fingerprints independent of JSON object property order. Array order is significant. */
export function canonicalEvaluationSpec(value: unknown): string {
  validateEvaluationSpec(value);
  return JSON.stringify({
    schemaVersion: value.schemaVersion, suiteId: value.suiteId, suiteVersion: value.suiteVersion,
    applicationVersion: value.applicationVersion, runnerVersion: value.runnerVersion,
    promptVersion: value.promptVersion, toolVersion: value.toolVersion,
    measurementContext: value.measurementContext, generation: value.generation,
    models: value.models.map(model => ({ id: model.id, revision: model.revision, license: model.license, quantization: model.quantization })),
    taskIds: value.taskIds, repetitions: value.repetitions, maxSteps: value.maxSteps,
    maxTaskDurationMs: value.maxTaskDurationMs, maxOutputTokens: value.maxOutputTokens,
    contextTokens: value.contextTokens, temperature: value.temperature, seed: value.seed,
  });
}
