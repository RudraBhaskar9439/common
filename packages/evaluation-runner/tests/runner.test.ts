import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureEvaluationSpec } from '@common/mocks';
import { createEvaluationRunner, parseAction } from '../src/index.js';

test('controlled browser actually changes state using labeled fixture actions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'common-browser-'));
  try {
    const spec = { ...fixtureEvaluationSpec, promptVersion: '3', toolVersion: '2', taskIds: ['assign-ticket' as const] };
    const runner = createEvaluationRunner({ artifactDir: dir, client: {
      source: 'fixture', verify: async () => {},
      act: async ({ history }) => ({ content: JSON.stringify([
        { action: 'click', target: 'open-42' }, { action: 'select', target: 'team', value: 'Billing' }, { action: 'click', target: 'save' },
      ][history.length]), inputTokens: 0, outputTokens: 0 }),
    } });
    const report = await runner.run({ jobId: 'fixture', spec });
    assert.equal(report.source, 'fixture'); assert.equal(report.tasks.length, 2);
    assert.ok(report.tasks.every(t => t.outcome === 'passed' && t.steps.length === 3));
    assert.ok((await stat(join(dir, report.tasks[0]!.traceId!))).size > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('arbitrary selectors and actions cannot execute through model output', () => {
  assert.throws(() => parseAction('{"action":"eval","target":"save","value":"code"}'));
  assert.throws(() => parseAction('{"action":"click","target":"body > button"}'));
});
