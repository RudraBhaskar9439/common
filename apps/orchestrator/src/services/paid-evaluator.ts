import { randomBytes } from 'node:crypto';
import { CommonError, type EvaluationReport, type Operation, type Money } from '@common/interfaces';
import { createLiveAdapter, type HederaSpendingAdapter } from '@common/hedera-adapter';
import { CommonDatabase } from '@common/result-store';
import { validateEvaluationReport } from '@common/agent-tools';
import { createPersistentOperationRegistry } from './operation-registry.js';
import type { EvaluationExecutor } from '../workflows/evaluation.js';

interface RemoteJob { token: string; jobId?: string; resource?: string; payTo?: string; amount?: string; asset?: string; purchaseKey: string }

export function createPaidEvaluator(database: CommonDatabase, serviceUrl: string): EvaluationExecutor {
  if (process.env['CONFIRM_TESTNET_PAYMENT'] !== 'yes' || process.env['HEDERA_NETWORK'] !== 'testnet') throw new Error('Live mode requires explicit testnet payment configuration');
  const base = new URL(serviceUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid service URL');
  let adapter: HederaSpendingAdapter | undefined;
  function getAdapter() {
    adapter ??= createLiveAdapter(purchaseKey => {
      const row = database.list<RemoteJob>('remote-jobs').find(r => r.value.purchaseKey === purchaseKey)?.value;
      return row?.resource && row.payTo && row.asset ? { resource: row.resource, payTo: row.payTo, asset: row.asset } : undefined;
    }, createPersistentOperationRegistry(database));
    return adapter;
  }
  async function request(path: string, token: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body['error'] === 'string' ? body['error'] : `Service returned ${response.status}`);
    return body;
  }
  return {
    mode: 'hedera-testnet',
    publishDecision: record => getAdapter().recordDecision(record),
    async recordDelivery(operation, report, usable) {
      const state = await getAdapter().getOperation(operation.operationId);
      if (state.status === 'paid') await getAdapter().recordDelivery({ operationId: operation.operationId, usable, freshUntil: new Date(report.freshUntil), resultRef: operation.operationId, ...(!usable ? { failureReason: 'Evaluation infrastructure failed' } : {}) });
      else if (!['delivered', 'delivery_failed'].includes(state.status)) throw new CommonError('SETTLEMENT_UNKNOWN', 'Payment must be confirmed before delivery');
    },
    async execute(operation) {
      let remote = database.get<RemoteJob>('remote-jobs', operation.operationId);
      if (!remote) { remote = { token: randomBytes(32).toString('base64url'), purchaseKey: operation.purchaseKey }; database.insert('remote-jobs', operation.operationId, remote); }
      if (!remote.jobId) {
        const prepared = await request('/jobs', remote.token, { method: 'POST', body: JSON.stringify({ operationId: operation.operationId, workspaceId: operation.workspaceId, accessToken: remote.token, spec: operation.spec }) });
        const terms = prepared['requirements'] as { resource: string; payTo: string; amount: string; asset: string; network: string };
        const jobId = prepared['jobId'];
        if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) ||
          terms.resource !== new URL(`/jobs/${jobId}/execute`, base).href ||
          !/^0\.0\.\d+$/.test(terms.payTo) || !/^[1-9]\d*$/.test(terms.amount) ||
          terms.network !== 'hedera:testnet' || terms.asset !== '0.0.0') throw new Error('Provider returned unsupported payment terms');
        remote = { ...remote, jobId: String(prepared['jobId']), resource: terms.resource, payTo: terms.payTo, amount: terms.amount, asset: terms.asset };
        database.set('remote-jobs', operation.operationId, remote);
      }
      const spending = getAdapter();
      let state: Operation | undefined;
      try { state = await spending.getOperation(operation.operationId); }
      catch (err) { if (!(err instanceof CommonError) || err.code !== 'NOT_FOUND') throw err; }
      const amount: Money = { amount: remote.amount!, tokenId: '0.0.0', decimals: 8 };
      if (!state) state = await spending.reserve({ operationId: operation.operationId, workspaceId: operation.workspaceId, agentId: operation.agentId, purchaseKey: operation.purchaseKey, amount });
      if (state.status === 'payment_pending' || state.status === 'settlement_unknown') state = await spending.reconcile(operation.operationId);
      let receipt = state.receipt;
      if (state.status === 'reserved') {
        const result = await spending.executePayment({ operationId: operation.operationId });
        if (result.status === 'settlement_unknown') throw new CommonError('SETTLEMENT_UNKNOWN', 'Waiting for the original Hedera transaction; no replacement payment will be sent');
        if (result.status === 'failed') throw new Error(result.reason);
        receipt = result.receipt;
      } else if (!['paid', 'delivered', 'delivery_failed'].includes(state.status)) {
        throw new CommonError('SETTLEMENT_UNKNOWN', `Operation remains ${state.status}; reconcile before continuing`);
      }
      if (!receipt) throw new CommonError('SETTLEMENT_UNKNOWN', 'Confirmed receipt not available in durable registry');
      // Preserve payment evidence even if subsequent polling/delivery fails.
      database.set('evaluations', operation.operationId, { ...operation, receipt });
      const deadline = Date.now() + operation.spec.maxTaskDurationMs * operation.spec.taskIds.length * operation.spec.models.length * operation.spec.repetitions + 60000;
      while (Date.now() < deadline) {
        const job = await request(`/jobs/${remote.jobId}`, remote.token);
        if (job['paymentStatus'] === 'settlement_unknown') await request(`/jobs/${remote.jobId}/reconcile`, remote.token, { method: 'POST' });
        if (job['status'] === 'failed') throw new Error(String(job['error'] ?? 'Paid evaluation failed; payment retained'));
        if (job['status'] === 'completed') {
          const report = await request(`/jobs/${remote.jobId}/report`, remote.token) as unknown as EvaluationReport;
          validateEvaluationReport(report, operation.spec);
          if (report.source !== 'live') throw new Error('Live provider returned fixture evidence');
          return { report, receipt };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Paid evaluation delivery timed out; resume this operation to retrieve it without repayment');
    },
  };
}
