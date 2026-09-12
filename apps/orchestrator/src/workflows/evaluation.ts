import { randomUUID } from 'node:crypto';
import { CommonError, type EvaluationSpec, type EvaluationReport, type PaymentReceipt, type DecisionRecord, type DecisionReceipt, type Purchase } from '@common/interfaces';
import { evaluationPurchaseKey, validateEvaluationReport } from '@common/agent-tools';
import { CommonDatabase, createResultStore } from '@common/result-store';
import { createMemoryReader, type ObservedCompletion } from '@common/memory-client';
import { safeErrorMessage } from '../services/errors.js';

export interface EvaluationOperation {
  operationId: string; workspaceId: string; agentId: string; purchaseKey: string; spec: EvaluationSpec;
  mode: 'local' | 'hedera-testnet'; status: 'queued' | 'running' | 'settlement_unknown' | 'completed' | 'failed';
  createdAt: string; updatedAt: string; error?: string; receipt?: PaymentReceipt; resultId?: string;
}
export interface EvaluationExecutor {
  mode: EvaluationOperation['mode'];
  execute(operation: EvaluationOperation): Promise<{ report: EvaluationReport; receipt?: PaymentReceipt }>;
  publishDecision?: (decision: DecisionRecord) => Promise<DecisionReceipt>;
  recordDelivery?: (operation: EvaluationOperation, report: EvaluationReport, usable: boolean) => Promise<void>;
}
export interface RequestRecord { requestId: string; workspaceId: string; agentId: string; operationId: string; purchaseKey: string; kind: 'acquire' | 'reuse' }

/** One worker per application database. Public methods bind the authenticated workspace. */
export function createEvaluationWorkflow(options: { database: CommonDatabase; workspaceId: string; executor: EvaluationExecutor }) {
  const { database: db, workspaceId, executor } = options;
  const resultStore = createResultStore({ database: db, workspaceId });
  const memory = createMemoryReader(db, workspaceId);
  let worker: Promise<void> | undefined; let closed = false; let publication: Promise<void> | undefined;
  const scoped = (id: string) => JSON.stringify([workspaceId, id]);
  function operation(id: string) {
    const row = db.get<EvaluationOperation>('evaluations', id);
    if (!row || row.workspaceId !== workspaceId) throw new CommonError('NOT_FOUND', 'Evaluation not found');
    return row;
  }
  function decision(request: RequestRecord, type: DecisionRecord['type'], reason: string) {
    const row: DecisionRecord = { schemaVersion: 1, decisionId: `${request.requestId}-${type}`, workspaceId,
      agentId: request.agentId, operationId: request.operationId, type,
      chosen: type === 'reuse' ? 'Existing compatible evaluation report' : type === 'wait' ? 'Wait for current evaluation' : type === 'reject' ? 'Keep operation blocked' : 'Run bounded model evaluation',
      rejected: type === 'reuse' || type === 'wait' ? 'Run the same evaluation again' : 'Use an unavailable or incompatible result', reason, createdAt: new Date().toISOString(),
    };
    if (db.insert('decisions', scoped(row.decisionId), row) && executor.publishDecision) db.insert('decision-outbox', scoped(row.decisionId), row);
  }
  async function reportFor(row: EvaluationOperation) {
    if (!row.resultId) throw new Error('Result missing');
    const stored = await resultStore.get({ id: row.resultId, workspaceId });
    validateEvaluationReport(stored.content, row.spec);
    const report = stored.content;
    if (Date.parse(report.freshUntil) <= Date.now() || report.tasks.some(t => t.outcome === 'infrastructure_error')) throw new Error('Report is stale or has infrastructure errors; request a new measurement generation');
    if (row.mode === 'hedera-testnet' && report.source !== 'live') throw new Error('A live paid evaluation cannot reuse fixture evidence');
    return report;
  }
  async function completeRequests(row: EvaluationOperation) {
    await reportFor(row);
    for (const { value: request } of db.list<RequestRecord>('requests')) {
      if (request.workspaceId !== workspaceId || request.operationId !== row.operationId) continue;
      const completion: ObservedCompletion = { workspaceId, requestId: request.requestId, operationId: row.operationId, kind: request.kind, completedAt: new Date().toISOString() };
      if (db.insert('completions', scoped(request.requestId), completion) && request.kind === 'reuse') decision(request, 'reuse', 'Retrieved a complete, fresh report for the exact model, application and task configuration.');
    }
  }
  function schedule() {
    if (worker || closed) return;
    worker = (async () => {
      while (!closed) {
        const row = db.transaction(() => {
          const next = db.list<EvaluationOperation>('evaluations').find(r => r.value.workspaceId === workspaceId && r.value.mode === executor.mode && r.value.status === 'queued');
          if (!next) return undefined;
          const running = { ...next.value, status: 'running' as const, updatedAt: new Date().toISOString() };
          db.set('evaluations', running.operationId, running); return running;
        });
        if (!row) break;
        try {
          const existing = db.get<{ reference: { id: string; workspaceId: string }; content: EvaluationReport }>('results', scoped(row.operationId));
          const acquired = existing ? { report: existing.content, ...(row.receipt ? { receipt: row.receipt } : {}) } : await executor.execute(row);
          validateEvaluationReport(acquired.report, row.spec);
          if (row.mode === 'hedera-testnet' && (!acquired.receipt || acquired.report.source !== 'live')) throw new Error('Paid evaluation lacks live evidence or receipt');
          // Save receipt first; a storage failure cannot erase the fact that payment occurred.
          const withReceipt = { ...row, ...(acquired.receipt ? { receipt: acquired.receipt } : {}) };
          db.set('evaluations', row.operationId, withReceipt);
          await resultStore.put({ reference: { id: row.operationId, workspaceId }, content: acquired.report });
          const usable = !acquired.report.tasks.some(t => t.outcome === 'infrastructure_error');
          await executor.recordDelivery?.(withReceipt, acquired.report, usable);
          const finished: EvaluationOperation = { ...withReceipt, status: usable ? 'completed' : 'failed', resultId: row.operationId, updatedAt: new Date().toISOString(), ...(!usable ? { error: 'Evaluation contains infrastructure errors' } : {}) };
          const purchase: Purchase = { operationId: row.operationId, workspaceId, purchaseKey: row.purchaseKey,
            status: usable ? 'delivered' : 'delivery_failed', amount: acquired.receipt?.amount ?? { amount: '0', tokenId: '0.0.0', decimals: 8 },
            ...(acquired.receipt ? { receipt: acquired.receipt } : {}), result: { id: row.operationId, workspaceId },
            outcome: { usable, freshUntil: acquired.report.freshUntil, capabilities: ['browser-evaluation'] },
          };
          db.transaction(() => { db.set('evaluations', row.operationId, finished); db.set('purchases', row.operationId, purchase); });
          if (usable) await completeRequests(finished);
        } catch (err) {
          const current = operation(row.operationId);
          const uncertain = err instanceof CommonError && err.code === 'SETTLEMENT_UNKNOWN';
          db.set('evaluations', row.operationId, { ...current, status: uncertain ? 'settlement_unknown' : 'failed', error: safeErrorMessage(err), updatedAt: new Date().toISOString() });
        }
      }
    })().finally(() => { worker = undefined; });
  }
  return {
    memory,
    async request(input: { requestId: string; agentId: string; spec: EvaluationSpec }) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId) || !['agent-a', 'agent-b'].includes(input.agentId)) throw new CommonError('UNAUTHORIZED', 'Invalid request identity or agent');
      const purchaseKey = evaluationPurchaseKey(input.spec);
      const request = db.transaction(() => {
        const previous = db.get<RequestRecord>('requests', scoped(input.requestId));
        if (previous) {
          if (previous.agentId !== input.agentId || previous.purchaseKey !== purchaseKey) throw new Error('Request ID has conflicting parameters');
          return previous;
        }
        const claimKey = scoped(`${executor.mode}:${purchaseKey}`);
        const claimed = db.get<string>('evaluation-claims', claimKey);
        const operationId = claimed ?? randomUUID();
        if (!claimed) {
          const now = new Date().toISOString();
          const row: EvaluationOperation = { operationId, workspaceId, agentId: input.agentId, purchaseKey, spec: input.spec, mode: executor.mode, status: 'queued', createdAt: now, updatedAt: now };
          db.insert('evaluations', operationId, row); db.insert('evaluation-claims', claimKey, operationId);
        }
        const record: RequestRecord = { requestId: input.requestId, workspaceId, agentId: input.agentId, operationId, purchaseKey, kind: claimed ? 'reuse' : 'acquire' };
        db.insert('requests', scoped(input.requestId), record);
        decision(record, claimed ? 'wait' : 'buy', claimed ? 'An evaluation already owns this exact configuration. Check its result before starting another run.' : 'No existing evaluation owns this configuration. Acquire one bounded run.');
        return record;
      });
      const row = operation(request.operationId);
      if (row.status === 'completed') {
        try { await completeRequests(row); } catch (err) { decision(request, 'reject', 'The stored report is no longer usable. A new explicit measurement generation is required.'); throw err; }
      }
      schedule(); return { request, operation: row };
    },
    operations() { return db.list<EvaluationOperation>('evaluations').map(r => r.value).filter(r => r.workspaceId === workspaceId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); },
    get: operation,
    async report(id: string) {
      const row = operation(id);
      if (!row.resultId) throw new Error('Report not ready');
      const stored = await resultStore.get({ id: row.resultId, workspaceId });
      validateEvaluationReport(stored.content, row.spec); return stored.content;
    },
    retry(id: string) {
      const row = operation(id);
      if (!['failed', 'settlement_unknown'].includes(row.status)) return;
      db.set('evaluations', id, { ...row, status: 'queued', updatedAt: new Date().toISOString() });
      schedule();
    },
    async flushDecisions() {
      if (publication) return publication;
      if (closed || !executor.publishDecision) return;
      const publish = executor.publishDecision;
      publication = (async () => {
        for (const { id, value } of db.list<DecisionRecord>('decision-outbox')) {
          if (value.workspaceId !== workspaceId) continue;
          try {
            const receipt = await publish(value); db.set('decision-receipts', id, receipt);
            if (receipt.hcsStatus === 'confirmed' && receipt.eventStatus === 'confirmed') db.remove('decision-outbox', id);
          } catch { /* Durable outbox remains; no payment is reachable from this loop. */ }
        }
      })().finally(() => { publication = undefined; });
      return publication;
    },
    resume() {
      for (const { value: row } of db.list<EvaluationOperation>('evaluations')) if (row.workspaceId === workspaceId && row.mode === executor.mode && ['running', 'settlement_unknown'].includes(row.status)) db.set('evaluations', row.operationId, { ...row, status: 'queued' });
      schedule();
    },
    async idle() { await worker; },
    async close() { closed = true; await worker; await publication; },
  };
}
