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

test('all five deterministic graders accept only their intended browser changes; fixture actions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'common-suite-'));
  try {
    const runner = createEvaluationRunner({ artifactDir: dir, client: {
      source: 'fixture', verify: async () => {},
      act: async ({ instruction, history }) => {
        const actions = instruction.startsWith('Filter') ? [{ action: 'select', target: 'priority-filter', value: 'high' }]
          : instruction.startsWith('Change') ? [{ action: 'click', target: 'open-43' }, { action: 'select', target: 'priority', value: 'urgent' }, { action: 'click', target: 'save' }]
          : instruction.startsWith('Resolve') ? [{ action: 'click', target: 'open-44' }, { action: 'select', target: 'status', value: 'resolved' }, { action: 'click', target: 'save' }]
          : instruction.startsWith('Add') ? [{ action: 'click', target: 'open-42' }, { action: 'fill', target: 'note', value: 'Customer confirmed duplicate charge' }, { action: 'click', target: 'save' }]
          : [{ action: 'click', target: 'open-42' }, { action: 'select', target: 'team', value: 'Billing' }, { action: 'click', target: 'save' }];
        return { content: JSON.stringify(actions[history.length]), inputTokens: 0, outputTokens: 0 };
      },
    } });
    const report = await runner.run({ jobId: 'all-fixture', spec: { ...fixtureEvaluationSpec, promptVersion: '3', toolVersion: '2' } });
    assert.equal(report.tasks.length, 10);
    assert.ok(report.tasks.every(t => t.outcome === 'passed'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
