import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import type { EvaluationJob, EvaluationSpec, EvaluationRunner, EvaluationReport } from '@common/interfaces';
import { validateEvaluationSpec } from '@common/interfaces';
import { evaluationSpecHash, validateEvaluationReport } from '@common/agent-tools';
import { CommonDatabase } from '@common/result-store';
import { signedTransferIdentity } from '@common/hedera-adapter';
import { decodePaymentPayload, receiptOf, type PaymentPayload, type PaymentRequirements, type SettleResponse, type VerifyResponse } from './payment/x402.js';
import type { PaidServiceConfig } from './config.js';

export interface PaidEvaluationJob extends EvaluationJob {
  spec: EvaluationSpec;
  tokenHash: string;
  requirements: PaymentRequirements;
  paymentStatus: 'awaiting_payment' | 'settlement_unknown' | 'paid';
  signedTransactionId?: string;
  /** Provider-side re-runs granted after an infrastructure failure. Never a new payment. */
  retryCount?: number;
}

/**
 * How many times a paid job may be re-run after the PROVIDER's infrastructure fails.
 * A job only reaches `failed` when the runner throws — a model failing its tasks yields a
 * completed report — so every retry here is compensating for our own fault, not the
 * customer's. Bounded so a persistently broken host cannot loop forever.
 */
export const MAX_INFRASTRUCTURE_RETRIES = 2;
export interface JobFacilitator {
  verify(payload: PaymentPayload, terms: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, terms: PaymentRequirements): Promise<SettleResponse>;
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const sameId = (id: string) => id.replace(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/, '$1-$2-$3');

export function createEvaluationJobs(options: {
  database: CommonDatabase; runner: EvaluationRunner; facilitator: JobFacilitator;
  config: PaidServiceConfig; publicUrl: string;
  verifySpec: (spec: EvaluationSpec) => Promise<void>;
}) {
  const { database: db } = options;
  let worker: Promise<void> | undefined;
  let closing = false;
  function get(jobId: string): PaidEvaluationJob {
    const job = db.get<PaidEvaluationJob>('service-jobs', jobId);
    if (!job) throw new Error('Job not found');
    return job;
  }
  function authorized(jobId: string, token: string): PaidEvaluationJob {
    const job = get(jobId);
    if (!timingSafeEqual(Buffer.from(job.tokenHash), Buffer.from(hash(token)))) throw new Error('Unauthorized job access');
    return job;
  }
  function paid(job: PaidEvaluationJob, transactionId: string): void {
    db.transaction(() => {
      const current = get(job.jobId);
      if (current.paymentStatus === 'paid') return;
      db.set('service-jobs', job.jobId, { ...current, transactionId, paymentStatus: 'paid', status: 'queued', updatedAt: new Date().toISOString() });
    });
  }
  function schedule(): void {
    if (worker || closing) return;
    worker = (async () => {
      while (!closing) {
        const next = db.transaction(() => {
          const queued = db.list<PaidEvaluationJob>('service-jobs').find(r => r.value.status === 'queued' && r.value.paymentStatus === 'paid');
          if (!queued) return undefined;
          const job = { ...queued.value, status: 'running' as const, updatedAt: new Date().toISOString() };
          db.set('service-jobs', job.jobId, job); return job;
        });
        if (!next) break;
        try {
          const report = await options.runner.run({ jobId: next.jobId, spec: next.spec });
          validateEvaluationReport(report, next.spec);
          if (report.jobId !== next.jobId) throw new Error('Wrong job report');
          db.transaction(() => {
            db.set('service-reports', next.jobId, report);
            db.set('service-jobs', next.jobId, { ...next, status: 'completed', reportId: next.jobId, updatedAt: new Date().toISOString() });
          });
        } catch (err) {
          db.set('service-jobs', next.jobId, { ...next, status: 'failed', error: err instanceof Error ? err.message : 'Evaluation failed', updatedAt: new Date().toISOString() });
        }
      }
    })().finally(() => { worker = undefined; });
  }
  return {
    async prepare(input: { operationId: string; workspaceId: string; accessToken: string; spec: EvaluationSpec }) {
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.accessToken) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.workspaceId)) throw new Error('Invalid job identity');
      validateEvaluationSpec(input.spec);
      await options.verifySpec(input.spec);
      const specHash = evaluationSpecHash(input.spec);
      return db.transaction(() => {
        const key = JSON.stringify([input.workspaceId, input.operationId]);
        const existing = db.get<string>('service-operations', key);
        if (existing) {
          const job = authorized(existing, input.accessToken);
          if (job.specHash !== specHash) throw new Error('Operation parameters conflict');
          return job;
        }
        if (db.list('service-jobs').length >= 256) throw new Error('Demo job capacity reached');
        const jobId = randomUUID(); const now = new Date().toISOString();
        const job: PaidEvaluationJob = {
          jobId, operationId: input.operationId, workspaceId: input.workspaceId, specHash, spec: input.spec,
          status: 'awaiting_payment', paymentStatus: 'awaiting_payment', createdAt: now, updatedAt: now,
          tokenHash: hash(input.accessToken), requirements: {
            scheme: 'exact', network: options.config.network, amount: options.config.priceAmount,
            asset: options.config.priceAsset, payTo: options.config.payTo,
            maxTimeoutSeconds: options.config.maxTimeoutSeconds,
            resource: `${options.publicUrl.replace(/\/$/, '')}/jobs/${jobId}/execute`,
            description: `Open-model browser evaluation ${specHash}`, mimeType: 'application/json', extra: { feePayer: options.config.feePayer },
          },
        };
        db.insert('service-jobs', jobId, job); db.insert('service-operations', key, jobId); return job;
      });
    },
    get,
    status(jobId: string, token: string) {
      const { tokenHash: _, ...job } = authorized(jobId, token); return job;
    },
    report(jobId: string, token: string): EvaluationReport {
      const job = authorized(jobId, token);
      if (job.paymentStatus !== 'paid' || job.status !== 'completed') throw new Error('Report not ready');
      const report = db.get<EvaluationReport>('service-reports', jobId);
      if (!report) throw new Error('Report missing'); return report;
    },
    async execute(jobId: string, signature?: string): Promise<{ status: number; body: unknown; requirements?: PaymentRequirements }> {
      let job = get(jobId);
      if (job.paymentStatus === 'paid') { schedule(); return { status: 200, body: { payment: { transactionId: job.transactionId }, content: { jobId, status: job.status } } }; }
      if (job.paymentStatus === 'settlement_unknown') return { status: 502, body: { settlementCertainty: 'unknown', error: 'Reconcile the existing transaction' } };
      if (!signature) return { status: 402, body: { x402Version: 2, accepts: [job.requirements] }, requirements: job.requirements };
      let submissionStarted = false;
      try {
        const payload = decodePaymentPayload(signature);
        if (payload.x402Version !== 2) throw new Error('x402 v2 required');
        const identity = signedTransferIdentity(payload.payload.transaction);
        const verification = await options.facilitator.verify(payload, job.requirements);
        if (!verification.isValid) return { status: 402, body: { error: 'payment_invalid', settlementCertainty: 'none' } };
        const claimed = db.transaction(() => {
          job = get(jobId);
          if (job.paymentStatus !== 'awaiting_payment') return false;
          job = { ...job, paymentStatus: 'settlement_unknown', signedTransactionId: identity.transactionId, updatedAt: new Date().toISOString() };
          db.set('service-jobs', jobId, job); return true;
        });
        if (!claimed) return { status: 502, body: { settlementCertainty: 'unknown' } };
        submissionStarted = true;
        const settlement = await options.facilitator.settle(payload, job.requirements);
        const receipt = receiptOf(settlement);
        if (!settlement.success || sameId(receipt) !== sameId(identity.transactionId)) return { status: 502, body: { settlementCertainty: 'unknown' } };
        paid(job, receipt); schedule();
        return { status: 200, body: { payment: { transactionId: receipt }, content: { jobId, status: 'queued' } } };
      } catch {
        return { status: submissionStarted ? 502 : 400, body: { error: 'payment_request_failed', settlementCertainty: submissionStarted ? 'unknown' : 'none' } };
      }
    },
    async reconcile(jobId: string, token: string, mirrorUrl: string) {
      const job = authorized(jobId, token);
      if (job.paymentStatus !== 'settlement_unknown' || !job.signedTransactionId) return job;
      const id = sameId(job.signedTransactionId);
      const response = await fetch(`${mirrorUrl.replace(/\/$/, '')}/api/v1/transactions/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return job;
      const body = await response.json() as { transactions?: { transaction_id: string; result: string; transfers: { account: string; amount: number }[] }[] };
      if (body.transactions?.some(t => t.transaction_id === id && t.result === 'SUCCESS' && t.transfers?.some(x => x.account === job.requirements.payTo && Number.isSafeInteger(x.amount) && BigInt(x.amount) === BigInt(job.requirements.amount)))) { paid(job, job.signedTransactionId); schedule(); }
      return get(jobId);
    },
    /**
     * Re-run a paid job whose computation failed on our side. The customer holds a valid
     * receipt for work that was never delivered; re-running it costs us compute, not them
     * money. Refused for unpaid jobs, for jobs that did not fail, and past the retry bound.
     * The same job, spec and receipt are kept — nothing new is created or charged.
     */
    retry(jobId: string, token: string): PaidEvaluationJob {
      const next = db.transaction(() => {
        const job = authorized(jobId, token);
        if (job.paymentStatus !== 'paid') throw new Error('Only a paid job can be retried');
        if (job.status !== 'failed') throw new Error(`Job is ${job.status}, not failed`);
        const used = job.retryCount ?? 0;
        if (used >= MAX_INFRASTRUCTURE_RETRIES) throw new Error(`Retry limit reached (${MAX_INFRASTRUCTURE_RETRIES}); this job needs operator attention`);
        const { error: _discarded, ...rest } = job;
        const queued: PaidEvaluationJob = { ...rest, status: 'queued', retryCount: used + 1, updatedAt: new Date().toISOString() };
        db.set('service-jobs', jobId, queued);
        return queued;
      });
      schedule();
      return next;
    },
    /** Single worker process per database. Recover stopped computation; never repeat settlement. */
    resume() {
      for (const { value: job } of db.list<PaidEvaluationJob>('service-jobs')) if (job.status === 'running' && job.paymentStatus === 'paid') db.set('service-jobs', job.jobId, { ...job, status: 'queued' });
      schedule();
    },
    async idle() { await worker; },
    async close() { closing = true; await worker; },
  };
}
