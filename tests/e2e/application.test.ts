import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startApplication } from '@common/orchestrator';
import { fixtureEvaluationSpec } from '@common/mocks';
import { evaluationSpecHash } from '@common/agent-tools';

test('browser acquisition, reuse, download and mobile layout with an explicitly labeled fixture executor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'common-browser-'));
  const spec = { ...fixtureEvaluationSpec, promptVersion: '3', toolVersion: '2' };
  let runs = 0;
  const app = await startApplication({ port: 0, dataDir: directory, workspaceId: 'browser-test', specProvider: async () => spec,
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
    await page.locator('#acquire:enabled').waitFor();
    await page.locator('#acquire').click();
    await page.waitForFunction(() => document.querySelector('#acquisitions')?.textContent === '1');
    await page.locator('#report-source').waitFor({ state: 'visible' });
    assert.match((await page.locator('#report-source').textContent())!, /FIXTURE/);
    await page.locator('#reuse').click();
    await page.waitForFunction(() => document.querySelector('#reuses')?.textContent === '1');
    assert.equal(runs, 1); assert.equal(await page.locator('#payments').textContent(), '0');
    assert.equal(await page.locator('#reuse-rate').textContent(), '50%');
    const report = await page.request.get(new URL((await page.locator('#download').getAttribute('href'))!, app.origin).href);
    assert.equal(report.status(), 200); assert.equal((await report.json()).source, 'fixture');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
