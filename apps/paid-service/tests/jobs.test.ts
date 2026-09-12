import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { buildSignedTransfer, signedTransferIdentity } from '@common/hedera-adapter';
import { CommonDatabase } from '@common/result-store';
import { evaluationSpecHash } from '@common/agent-tools';
import { fixtureEvaluationSpec } from '@common/mocks';
import { createEvaluationJobs } from '../src/evaluation-jobs.js';
import { encodeHeader } from '../src/payment/x402.js';
import type { EvaluationReport, EvaluationRunner } from '@common/interfaces';
import { createServer } from 'node:http';
import { createJobHandler } from '../src/jobs-server.js';

const config = { port: 0, facilitatorUrl: 'http://fixture.invalid', network: 'hedera:testnet', payTo: '0.0.10', priceAmount: '50000000', priceAsset: '0.0.0', maxTimeoutSeconds: 120, feePayer: '0.0.20' };
const token = 'fixture-access-token-not-a-key';

test('hosted admission refuses unauthenticated preparation before storing jobs; x402 still gates execution', async () => {
  const { db, jobs, count } = setup();
  const key = 'fixture-provider-admission-key';
  const handler = createJobHandler(jobs, 'http://fixture.invalid', undefined, key);
  const server = createServer((req,res) => { void handler(req,res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const origin = `http://127.0.0.1:${address.port}`;
  const body = JSON.stringify({ workspaceId: 'w', operationId: 'op-http', accessToken: token, spec: fixtureEvaluationSpec });
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/jobs`, { method: 'POST', body })).status, 403);
    assert.equal(db.list('service-jobs').length, 0);
    const prepared = await fetch(`${origin}/jobs`, { method: 'POST', body, headers: { 'x-common-service-key': key } });
    assert.equal(prepared.status, 201);
    const job = await prepared.json() as { jobId: string };
    assert.equal((await fetch(`${origin}/jobs/${job.jobId}/execute`)).status, 402);
    assert.equal((await fetch(`${origin}/jobs/${job.jobId}/report`)).status, 403);
    assert.deepEqual(count(), { payments: 0, runs: 0 });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await jobs.close(); db.close(); }
});
function setup(uncertain = false, database?: CommonDatabase) {
  const db = database ?? new CommonDatabase(':memory:'); let payments = 0; let runs = 0;
  const runner: EvaluationRunner = { async run({ jobId, spec }): Promise<EvaluationReport> {
    runs++;
    return { schemaVersion: 1, source: 'fixture', jobId, specHash: evaluationSpecHash(spec), spec, startedAt: '2026-09-12T00:00:00Z', completedAt: '2026-09-12T00:01:00Z', freshUntil: '2026-09-13T00:00:00Z', limitations: ['Fixture, no inference or payment'],
      tasks: spec.models.flatMap(m => spec.taskIds.map(taskId => ({ modelId: m.id, modelRevision: m.revision, taskId, repetition: 0, outcome: 'failed', checks: [{ name: 'Fixture', passed: false }], steps: [], durationMs: 0, inputTokens: 0, outputTokens: 0 }))),
    };
  } };
  const jobs = createEvaluationJobs({ database: db, runner, config, publicUrl: 'http://provider.invalid', verifySpec: async () => {}, facilitator: {
    verify: async () => ({ isValid: true }),
    settle: async payload => { payments++; if (uncertain) throw new Error('fixture timeout'); return { success: true, transaction: signedTransferIdentity(payload.payload.transaction).transactionId }; },
  } });
  return { db, jobs, count: () => ({ payments, runs }) };
}
async function signature(terms: unknown) {
  const transaction = await buildSignedTransfer({ network: 'testnet', fromAccountId: '0.0.30', privateKey: randomBytes(32).toString('hex'), payTo: '0.0.10', amount: 50000000n, asset: '0.0.0', feePayer: '0.0.20', validSeconds: 120 });
  return encodeHeader({ x402Version: 2, accepted: terms, payload: { transaction } });
}

test('paid job can be retrieved repeatedly with one settlement and one computation; doubles', async () => {
  const { db, jobs, count } = setup();
  try {
    const input = { workspaceId: 'w', operationId: 'op', accessToken: token, spec: fixtureEvaluationSpec };
    const job = await jobs.prepare(input);
    assert.equal((await jobs.prepare(input)).jobId, job.jobId);
    assert.equal((await jobs.execute(job.jobId)).status, 402);
    assert.throws(() => jobs.report(job.jobId, token), /not ready/);
    const signed = await signature(job.requirements);
    const outcomes = await Promise.all([jobs.execute(job.jobId, signed), jobs.execute(job.jobId, signed)]);
    assert.ok(outcomes.some(r => r.status === 200));
    await jobs.idle();
    assert.equal(jobs.report(job.jobId, token).source, 'fixture');
    assert.equal((await jobs.execute(job.jobId, signed)).status, 200);
    jobs.report(job.jobId, token);
    assert.deepEqual(count(), { payments: 1, runs: 1 });
    assert.throws(() => jobs.report(job.jobId, 'wrong'), /Unauthorized/);
    await assert.rejects(jobs.prepare({ ...input, accessToken: 'another-valid-token' }), /Unauthorized/);
    await assert.rejects(jobs.prepare({ ...input, spec: { ...fixtureEvaluationSpec, generation: 'different' } }), /conflict/);
  } finally { await jobs.close(); db.close(); }
});

test('uncertain payment survives service reconstruction and never triggers new settlement; doubles', async () => {
  const { db, jobs, count } = setup(true);
  try {
    const job = await jobs.prepare({ workspaceId: 'w', operationId: 'op', accessToken: token, spec: fixtureEvaluationSpec });
    const signed = await signature(job.requirements);
    assert.equal((await jobs.execute(job.jobId, signed)).status, 502);
    assert.equal(jobs.status(job.jobId, token).paymentStatus, 'settlement_unknown');
    await jobs.close();
    const restored = setup(true, db);
    restored.jobs.resume();
    assert.equal((await restored.jobs.execute(job.jobId, signed)).status, 502);
    assert.deepEqual(count(), { payments: 1, runs: 0 });
    assert.deepEqual(restored.count(), { payments: 0, runs: 0 });
    await restored.jobs.close();
  } finally { await jobs.close(); db.close(); }
});
