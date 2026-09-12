import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startApplication } from '@common/orchestrator';
import { fixtureEvaluationSpec } from '@common/mocks';

test('local API requires a session, blocks foreign origins/hosts and never executes rejected requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'common-http-'));
  let executions = 0;
  const app = await startApplication({ port: 0, dataDir: directory, workspaceId: 'http-test', specProvider: async () => fixtureEvaluationSpec,
    executor: { mode: 'local', execute: async () => { executions++; throw new Error('Unexpected execution'); } } });
  try {
    assert.equal((await fetch(`${app.origin}/api/state`)).status, 401);
    const home = await fetch(app.origin);
    const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
    assert.match(home.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    assert.match(home.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal((await fetch(`${app.origin}/api/state`, { headers: { cookie } })).status, 200);
    const foreignHostStatus = await new Promise<number | undefined>((done, reject) => {
      get(`${app.origin}/api/state`, { headers: { cookie, host: 'attacker.example' } }, res => { res.resume(); done(res.statusCode); }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(`${app.origin}/api/evaluations`, { method: 'POST', headers: { cookie, origin: 'https://attacker.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${app.origin}/api/evaluations`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ requestId: 'x', agentId: 'agent-a', spec: { ...fixtureEvaluationSpec, maxSteps: 100000 } }) })).status, 400);
    assert.equal((await fetch(`${app.origin}/api/reports/00000000-0000-0000-0000-000000000000`, { headers: { cookie } })).status, 400);
    assert.equal(executions, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
