import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEvaluationSpec, validateEvaluationSpec, type EvaluationSpec } from '@common/interfaces';
import { evaluationPurchaseKey } from '@common/agent-tools';
import { fixtureEvaluationSpec } from '@common/mocks';

test('versioned bounded evaluation fixture validates', () => {
  validateEvaluationSpec(fixtureEvaluationSpec);
  assert.match(evaluationPurchaseKey(fixtureEvaluationSpec), /^evaluation:v1:[a-f0-9]{64}$/);
});

test('JSON property order does not cause another purchase', () => {
  const reversed = Object.fromEntries(Object.entries(fixtureEvaluationSpec).reverse());
  assert.equal(evaluationPurchaseKey(reversed), evaluationPurchaseKey(fixtureEvaluationSpec));
  assert.deepEqual(JSON.parse(canonicalEvaluationSpec(reversed)), fixtureEvaluationSpec);
});

for (const field of ['suiteVersion', 'applicationVersion', 'runnerVersion', 'promptVersion', 'toolVersion', 'measurementContext', 'generation'] as const) {
  test(`changing ${field} prevents reuse of the old measurement`, () => {
    const changed = structuredClone(fixtureEvaluationSpec);
    changed[field] += '-changed';
    assert.notEqual(evaluationPurchaseKey(changed), evaluationPurchaseKey(fixtureEvaluationSpec));
  });
}

test('model digest, quantization, ordering, tasks and inference settings affect reuse', () => {
  const changes: ((s: EvaluationSpec) => void)[] = [
    s => { s.models = [{ ...s.models[0]!, revision: `sha256:${'3'.repeat(64)}` }, s.models[1]!]; },
    s => { s.models = [{ ...s.models[0]!, quantization: 'Q8_0' }, s.models[1]!]; },
    s => { s.models = [...s.models].reverse(); },
    s => { s.taskIds = ['assign-ticket']; },
    s => { s.temperature = 0.5; }, s => { s.seed = 43; },
    s => { s.contextTokens = 2048; }, s => { s.maxOutputTokens = 512; },
    s => { s.maxSteps = 4; }, s => { s.repetitions = 2; },
  ];
  for (const change of changes) {
    const spec = structuredClone(fixtureEvaluationSpec);
    change(spec);
    assert.notEqual(evaluationPurchaseKey(spec), evaluationPurchaseKey(fixtureEvaluationSpec));
  }
});

for (const [label, change] of [
  ['unknown fields', (s: Record<string, unknown>) => { s['endpoint'] = 'http://untrusted.example'; }],
  ['unbounded steps', (s: Record<string, unknown>) => { s['maxSteps'] = 100000; }],
  ['negative timeout', (s: Record<string, unknown>) => { s['maxTaskDurationMs'] = -1; }],
  ['fractional repetitions', (s: Record<string, unknown>) => { s['repetitions'] = 1.5; }],
  ['NaN temperature', (s: Record<string, unknown>) => { s['temperature'] = NaN; }],
  ['missing suite version', (s: Record<string, unknown>) => { delete s['suiteVersion']; }],
  ['duplicate tasks', (s: Record<string, unknown>) => { s['taskIds'] = ['assign-ticket', 'assign-ticket']; }],
  ['unknown task', (s: Record<string, unknown>) => { s['taskIds'] = ['arbitrary-code']; }],
  ['unpinned model', (s: Record<string, unknown>) => { s['models'] = [{ ...fixtureEvaluationSpec.models[0], revision: 'latest' }, fixtureEvaluationSpec.models[1]]; }],
  ['duplicate model', (s: Record<string, unknown>) => { s['models'] = [fixtureEvaluationSpec.models[0], fixtureEvaluationSpec.models[0]]; }],
] as const) {
  test(`rejects ${label} before creating a purchase identity`, () => {
    const spec: Record<string, unknown> = structuredClone({ ...fixtureEvaluationSpec });
    change(spec);
    assert.throws(() => evaluationPurchaseKey(spec));
  });
}
