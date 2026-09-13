import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startApplication } from '@common/orchestrator';
import { fixtureEvaluationSpec } from '@common/mocks';
import { evaluationSpecHash } from '@common/agent-tools';

test('public browser review and operator acquisition/reuse with an explicitly labeled fixture executor', async t => {
  // This fixture test must not call a paid buyer model configured in the developer's .env.
  const previousBuyer = process.env['COMMON_BUYER'];
  process.env['COMMON_BUYER'] = 'policy';
  t.after(() => { if (previousBuyer === undefined) delete process.env['COMMON_BUYER']; else process.env['COMMON_BUYER'] = previousBuyer; });
  const directory = await mkdtemp(join(tmpdir(), 'common-browser-'));
  const spec = { ...fixtureEvaluationSpec, promptVersion: '3', toolVersion: '2' };
  let runs = 0;
  const app = await startApplication({ port: 0, dataDir: directory, workspaceId: 'browser-test', readOnly: false, publicReview: true, operatorPassword: 'fixture-browser-password-not-a-secret', specProvider: async () => spec,
    executor: { mode: 'local', execute: async op => {
      runs++;
      return { report: { schemaVersion: 1, source: 'fixture', jobId: op.operationId, specHash: evaluationSpecHash(op.spec), spec: op.spec,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), freshUntil: new Date(Date.now()+86400000).toISOString(), limitations: ['Fixture policy; no actual inference or payment'],
        tasks: spec.models.flatMap(m => spec.taskIds.map(taskId => ({ modelId: m.id, modelRevision: m.revision, taskId, repetition: 0, outcome: 'failed', checks: [{ name: 'Fixture', passed: false }], steps: [], durationMs: 0, inputTokens: 0, outputTokens: 0 }))),
      } };
    } } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(app.origin);
    await page.locator('#operator-access').waitFor({ state: 'visible' });
    assert.match((await page.locator('#mode-note').textContent())!, /Public review/);
    assert.equal(await page.locator('#acquire').isDisabled(), true);
    assert.deepEqual(await page.context().cookies(), []);
    await page.locator('#operator-access a').click();
    await page.locator('#login-form').waitFor();
    await page.locator('#password').fill('wrong');
    await page.locator('#sign-in').click();
    await page.getByText('Incorrect username or password').waitFor();
    await page.locator('#password').fill('fixture-browser-password-not-a-secret');
    await page.locator('#sign-in').click();
    await page.locator('a[data-nav="console"]').click();
    await page.locator('#acquire:enabled').waitFor();
    await page.locator('#acquire').click();
    await page.waitForFunction(() => document.querySelector('#acquisitions')?.textContent === '1');
    await page.locator('#report-source').waitFor({ state: 'visible' });
    assert.match((await page.locator('#report-source').textContent())!, /FIXTURE/);
    // Delivery opens the evidence view; the console lives on the agent console view.
    await page.locator('a[data-nav="console"]').click();
    await page.locator('#agent').selectOption('agent-b');
    await page.locator('#acquire').click();
    await page.waitForFunction(() => document.querySelector('#reuses')?.textContent === '1');
    assert.equal(runs, 1); assert.equal(await page.locator('#payments').textContent(), '0');
    assert.equal(await page.locator('#reuse-rate').textContent(), '50%');
    const report = await page.request.get(new URL((await page.locator('#download').getAttribute('href'))!, app.origin).href);
    assert.equal(report.status(), 200); assert.equal((await report.json()).source, 'fixture');
    // A separate visitor can browse the completed report without inheriting the operator cookie.
    const guest = await browser.newPage();
    guest.on('pageerror', e => errors.push(e.message));
    await guest.goto(`${app.origin}/#evidence`);
    await guest.locator('#report-source').waitFor({ state: 'visible' });
    assert.match((await guest.locator('#report-source').textContent())!, /FIXTURE/);
    assert.equal(await guest.locator('#fresh').isDisabled(), true);
    const guestReport = await guest.request.get(new URL((await guest.locator('#download').getAttribute('href'))!, app.origin).href);
    assert.equal(guestReport.status(), 200);
    assert.equal((await guestReport.json()).source, 'fixture');
    assert.equal((await guest.request.post(`${app.origin}/api/evaluations`, { data: { requestId: 'guest', agentId: 'agent-b', spec } })).status(), 401);
    assert.equal(runs, 1);
    assert.deepEqual(await guest.context().cookies(), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
