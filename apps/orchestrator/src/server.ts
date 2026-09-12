import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommonDatabase } from '@common/result-store';
import { createEvaluationRunner, defaultEvaluationSpec, assertRunnableSpec } from '@common/evaluation-runner';
import { summarizeEvaluation } from '@common/agent-tools';
import type { DecisionRecord, DecisionReceipt, EvaluationSpec, TaskEvaluation } from '@common/interfaces';
import { readWebAsset } from '@common/web';
import { createEvaluationWorkflow, type EvaluationExecutor } from './workflows/evaluation.js';
import { createPaidEvaluator } from './services/paid-evaluator.js';
import { safeErrorMessage } from './services/errors.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function startApplication(options: { port?: number; dataDir?: string; executor?: EvaluationExecutor; specProvider?: () => Promise<EvaluationSpec>; workspaceId?: string; readOnly?: boolean } = {}) {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* Optional for local mode. */ }
  const dataDir = resolve(ROOT, options.dataDir ?? process.env['COMMON_DATA_DIR'] ?? '.common-data');
  const db = new CommonDatabase(join(dataDir, 'app.sqlite'));
  const workspaceId = options.workspaceId ?? process.env['COMMON_WORKSPACE_ID'] ?? 'local-demo';
  const mode = process.env['COMMON_MODE'] ?? 'local';
  if (!['local', 'hedera-testnet'].includes(mode)) throw new Error('Unsupported COMMON_MODE');
  const readOnly = options.readOnly ?? process.env['COMMON_READ_ONLY'] === 'yes';
  const executor: EvaluationExecutor = options.executor ?? (readOnly
    ? { mode: mode as EvaluationExecutor['mode'], execute: async () => { throw new Error('Read-only review cannot start an evaluation'); } }
    : mode === 'hedera-testnet'
    ? createPaidEvaluator(db, process.env['PAID_SERVICE_URL'] ?? 'http://127.0.0.1:3002')
    : { mode: 'local', execute: async operation => ({ report: await createEvaluationRunner({ artifactDir: join(dataDir, 'artifacts'), onProgress: task => db.set('progress', operation.operationId, task) }).run({ jobId: operation.operationId, spec: operation.spec }) }) });
  const workflow = createEvaluationWorkflow({ database: db, workspaceId, executor });
  const specProvider = options.specProvider ?? defaultEvaluationSpec;
  const session = randomBytes(32).toString('hex');
  let origin = '';
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const host = req.headers.host;
      const allowedHosts = [new URL(origin).host, new URL(origin).host.replace('127.0.0.1', 'localhost')];
      if (!host || !allowedHosts.includes(host)) return json(res, 403, { error: 'Invalid host' });
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !allowedHosts.some(h => requestOrigin === `http://${h}`)) return json(res, 403, { error: 'Cross-origin requests refused' });
      res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('x-frame-options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
      const url = new URL(req.url ?? '/', origin); const path = url.pathname;
      const assets: Record<string, { name: 'index.html' | 'app.js' | 'style.css'; type: string }> = {
        '/': { name: 'index.html', type: 'text/html; charset=utf-8' }, '/app.js': { name: 'app.js', type: 'text/javascript' }, '/style.css': { name: 'style.css', type: 'text/css' },
      };
      const asset = assets[path];
      if (asset && req.method === 'GET') {
        if (path === '/') res.setHeader('set-cookie', `common_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' }); res.end(await readWebAsset(asset.name)); return;
      }
      const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('common_session='))?.slice('common_session='.length) ?? '';
      if (cookie.length !== session.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(session))) return json(res, 401, { error: 'Open the local application to start a session' });
      if (readOnly && req.method !== 'GET') return json(res, 403, { error: 'Read-only review: new evaluations and transaction retries are disabled' });
      if (path === '/api/state' && req.method === 'GET') {
        let spec: EvaluationSpec | undefined; let readinessError: string | undefined;
        try { spec = await specProvider(); } catch (err) { readinessError = safeErrorMessage(err); }
        const decisions = db.list<DecisionRecord>('decisions').map(r => ({ ...r.value, publication: (() => {
          const receipt = db.get<DecisionReceipt>('decision-receipts', r.id);
          return receipt?.hcsStatus === 'confirmed' ? `HCS sequence ${receipt.hcsSequenceNumber ?? 'confirmed'}` : 'HCS publication pending';
        })() })).filter(d => d.workspaceId === workspaceId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        return json(res, 200, { workspaceId, mode: executor.mode, readOnly, spec, readinessError,
          operations: workflow.operations().map(o => ({ ...o, progress: db.get<TaskEvaluation>('progress', o.operationId) })),
          stats: await workflow.memory.getWorkspaceStats(workspaceId), decisions,
        });
      }
      if (path === '/api/evaluations' && req.method === 'POST') {
        const input = await body(req) as unknown as { requestId: string; agentId: string; spec: EvaluationSpec };
        assertRunnableSpec(input.spec);
        return json(res, 202, await workflow.request(input));
      }
      const resume = /^\/api\/evaluations\/([a-f0-9-]{36})\/resume$/.exec(path);
      if (resume && req.method === 'POST') { workflow.retry(resume[1]!); return json(res, 202, { status: 'resuming' }); }
      const reportMatch = /^\/api\/reports\/([a-f0-9-]{36})$/.exec(path);
      if (reportMatch && req.method === 'GET') {
        const report = await workflow.report(reportMatch[1]!);
        if (url.searchParams.has('download')) { res.setHeader('content-disposition', `attachment; filename="common-${reportMatch[1]}.json"`); return json(res, 200, report); }
        return json(res, 200, { report, summary: summarizeEvaluation(report) });
      }
      const artifactMatch = /^\/api\/artifacts\/([a-f0-9-]{36})\/([a-f0-9]{64}\.(png|zip))$/.exec(path);
      if (artifactMatch && req.method === 'GET') {
        const operation = workflow.get(artifactMatch[1]!);
        const report = await workflow.report(operation.operationId); const id = artifactMatch[2]!;
        if (!report.tasks.some(t => t.traceId === id || t.screenshotId === id)) return json(res, 403, { error: 'Artifact does not belong to this report' });
        let bytes: Buffer;
        if (operation.mode === 'local') bytes = await readFile(join(dataDir, 'artifacts', id));
        else {
          const remote = db.get<{ jobId: string; token: string }>('remote-jobs', operation.operationId);
          if (!remote) throw new Error('Remote job unavailable');
          const response = await fetch(`${process.env['PAID_SERVICE_URL'] ?? 'http://127.0.0.1:3002'}/jobs/${remote.jobId}/artifacts/${id}`, { headers: { authorization: `Bearer ${remote.token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
          if (!response.ok) throw new Error('Artifact unavailable'); bytes = Buffer.from(await response.arrayBuffer());
        }
        if (artifactMatch[3] === 'zip') res.setHeader('content-disposition', `attachment; filename="${id}"`);
        res.writeHead(200, { 'content-type': artifactMatch[3] === 'png' ? 'image/png' : 'application/zip', 'cache-control': 'private, no-store' }); res.end(bytes); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) { json(res, 400, { error: safeErrorMessage(err) }); }
  };
  const server = createServer((req,res) => { void handler(req,res); });
  await new Promise<void>((done,reject) => { server.once('error',reject); server.listen(options.port ?? Number(process.env['COMMON_PORT'] ?? 3000), '127.0.0.1', done); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  if (!readOnly) workflow.resume();
  const timer = setInterval(() => { if (!readOnly) void workflow.flushDecisions(); }, 5000); timer.unref();
  console.log(`Common: ${origin} (${executor.mode}; ${readOnly ? 'read-only; transactions disabled' : executor.mode === 'local' ? 'no blockchain payments' : 'testnet payment enabled'})`);
  return { origin, workflow, database: db, close: async () => { clearInterval(timer); await new Promise<void>(done => server.close(() => done())); await workflow.close(); db.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startApplication();
