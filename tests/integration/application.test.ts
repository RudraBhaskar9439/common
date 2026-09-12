import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startApplication } from '@common/orchestrator';
import { fixtureEvaluationSpec } from '@common/mocks';
import { CommonDatabase } from '@common/result-store';

test('hosted API requires operator credentials and exact HTTPS origin, and issues secure cookies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'common-hosted-'));
  const password = 'fixture-operator-password-not-for-deployment';
  const app = await startApplication({ port: 0, dataDir: directory, readOnly: true, publicOrigin: 'https://common.example', operatorPassword: password,
    specProvider: async () => fixtureEvaluationSpec, executor: { mode: 'local', execute: async () => { throw new Error('Must not execute'); } } });
  const authorization = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`;
  const hostedRequest = (url: string, init: { headers: Record<string,string> }) => new Promise<Response>((resolve, reject) => {
    get(url, { headers: init.headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks).toString(), { status: res.statusCode!, headers: Object.fromEntries(Object.entries(res.headers).filter(([,v]) => v !== undefined).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])) })));
    }).on('error', reject);
  });
  try {
    const headers = { host: 'common.example' };
    assert.equal((await hostedRequest(app.origin, { headers })).status, 401);
    assert.equal((await hostedRequest(app.origin, { headers: { ...headers, authorization: 'Basic wrong' } })).status, 401);
    const home = await hostedRequest(app.origin, { headers: { ...headers, authorization } });
    assert.equal(home.status, 200);
    assert.match(home.headers.get('set-cookie')!, /; Secure/);
    const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await hostedRequest(`${app.origin}/api/state`, { headers: { ...headers, authorization, cookie, origin: 'https://common.example' } })).status, 200);
    assert.equal((await hostedRequest(`${app.origin}/api/state`, { headers: { ...headers, authorization, cookie, origin: 'http://common.example' } })).status, 403);
    assert.equal((await hostedRequest(`${app.origin}/api/state`, { headers: { ...headers, cookie } })).status, 401);
    assert.equal((await hostedRequest(app.origin, { headers: { authorization } })).status, 403);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('local API requires a session, blocks foreign origins/hosts and never executes rejected requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'common-http-'));
  let executions = 0;
  const app = await startApplication({ port: 0, dataDir: directory, workspaceId: 'http-test', readOnly: false, specProvider: async () => fixtureEvaluationSpec,
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

test('read-only review serves evidence while refusing new evaluations and retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'common-review-'));
  const seed = new CommonDatabase(join(directory, 'app.sqlite'));
  seed.set('evaluations', '00000000-0000-0000-0000-000000000000', {
    operationId: '00000000-0000-0000-0000-000000000000', workspaceId: 'review-test', agentId: 'agent-a',
    purchaseKey: 'fixture', spec: fixtureEvaluationSpec, mode: 'hedera-testnet', status: 'queued',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  seed.close();
  let executions = 0;
  const app = await startApplication({ port: 0, dataDir: directory, workspaceId: 'review-test', readOnly: true, specProvider: async () => fixtureEvaluationSpec,
    executor: { mode: 'hedera-testnet', execute: async () => { executions++; throw new Error('Must not execute'); } } });
  try {
    const home = await fetch(app.origin); const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
    const state = await (await fetch(`${app.origin}/api/state`, { headers: { cookie } })).json() as { readOnly: boolean; mode: string };
    assert.equal(state.readOnly, true); assert.equal(state.mode, 'hedera-testnet');
    assert.equal((await fetch(`${app.origin}/api/evaluations`, { method: 'POST', headers: { cookie }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${app.origin}/api/evaluations/00000000-0000-0000-0000-000000000000/resume`, { method: 'POST', headers: { cookie } })).status, 403);
    assert.equal(executions, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
