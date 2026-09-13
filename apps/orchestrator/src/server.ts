import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { createOpenAIBuyer, policyBuyer } from './agents/buyer.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function startApplication(options: { port?: number; dataDir?: string; executor?: EvaluationExecutor; specProvider?: () => Promise<EvaluationSpec>; workspaceId?: string; readOnly?: boolean; publicReview?: boolean; publicOrigin?: string; operatorPassword?: string } = {}) {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* Optional for local mode. */ }
  const publicOrigin = options.publicOrigin ?? process.env['COMMON_PUBLIC_ORIGIN'];
  const operatorPassword = options.operatorPassword ?? process.env['COMMON_OPERATOR_PASSWORD'];
  const publicReview = options.publicReview ?? process.env['COMMON_PUBLIC_REVIEW'] === 'yes';
  if (publicReview && (!operatorPassword || operatorPassword.length < 24)) throw new Error('Public review requires an operator password of at least 24 characters to protect spending');
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://') || !operatorPassword || operatorPassword.length < 24)) {
    throw new Error('Hosted mode requires an HTTPS origin and an operator password of at least 24 characters');
  }
  const authHash = operatorPassword ? createHash('sha256').update(`Basic ${Buffer.from(`operator:${operatorPassword}`).toString('base64')}`).digest() : undefined;
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
  // Buyer agent: a hosted model makes the buy/reuse/reject call when COMMON_BUYER=openai
  // and a key is present. Otherwise the deterministic policy decides — identical to the
  // behaviour before the agent existed. The money path is unaffected either way.
  const buyer = process.env['COMMON_BUYER'] === 'openai' && process.env['OPENAI_API_KEY']
    ? createOpenAIBuyer({ apiKey: process.env['OPENAI_API_KEY'], ...(process.env['OPENAI_MODEL'] ? { model: process.env['OPENAI_MODEL'] } : {}), ...(process.env['OPENAI_BASE_URL'] ? { baseUrl: process.env['OPENAI_BASE_URL'] } : {}) })
    : policyBuyer;
  const priceTinybar = BigInt(/^\d{1,20}$/.test(process.env['PRICE_AMOUNT'] ?? '') ? process.env['PRICE_AMOUNT']! : '50000000');
  const workflow = createEvaluationWorkflow({ database: db, workspaceId, executor, buyer, priceTinybar });
  const specProvider = options.specProvider ?? defaultEvaluationSpec;
  const session = randomBytes(32).toString('hex');
  const sessionLifetimeMs = 8 * 60 * 60 * 1000;
  const signSession = (value: string) => createHmac('sha256', session).update(value).digest('hex');
  function authenticatedCookie(cookie: string) {
    const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(cookie);
    if (!match || Number(match[1]) <= Date.now() || Number(match[1]) > Date.now() + sessionLifetimeMs) return false;
    return timingSafeEqual(Buffer.from(match[3]!, 'hex'), Buffer.from(signSession(`${match[1]}.${match[2]}`), 'hex'));
  }
  function issueCookie(res: ServerResponse) {
    const payload = `${Date.now() + sessionLifetimeMs}.${randomBytes(16).toString('hex')}`;
    const value = authHash ? `${payload}.${signSession(payload)}` : session;
    res.setHeader('set-cookie', `common_session=${value}; HttpOnly; SameSite=Strict; Path=/${publicOrigin ? '; Secure' : ''}; Max-Age=28800`);
  }
  let loginWindow = Date.now(); let loginAttempts = 0;
  let origin = '';
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const host = req.headers.host;
      const allowedOrigins = publicOrigin ? [publicOrigin] : [origin, origin.replace('127.0.0.1', 'localhost')];
      const allowedHosts = allowedOrigins.map(o => new URL(o).host);
      if (!host || !allowedHosts.includes(host)) return json(res, 403, { error: 'Invalid host' });
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !allowedOrigins.includes(requestOrigin)) return json(res, 403, { error: 'Cross-origin requests refused' });
      res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('x-frame-options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const url = new URL(req.url ?? '/', origin); const path = url.pathname;
      const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('common_session='))?.slice('common_session='.length) ?? '';
      const basicAuthenticated = Boolean(authHash && timingSafeEqual(authHash, createHash('sha256').update(req.headers.authorization ?? '').digest()));
      const sessionAuthenticated = authHash ? authenticatedCookie(cookie) : cookie.length === session.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(session));
      if (path === '/auth/login' && req.method === 'POST' && authHash) {
        if (!requestOrigin || !allowedOrigins.includes(requestOrigin) || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Sign in from the Common page' });
        if (Date.now() - loginWindow >= 60000) { loginWindow = Date.now(); loginAttempts = 0; }
        if (++loginAttempts > 20) { res.setHeader('retry-after', '60'); return json(res, 429, { error: 'Too many sign-in attempts. Try again in a minute.' }); }
        const input = await body(req);
        const provided = `Basic ${Buffer.from(`${input['username']}:${input['password']}`).toString('base64')}`;
        if (!timingSafeEqual(authHash, createHash('sha256').update(provided).digest())) return json(res, 401, { error: 'Incorrect username or password' });
        issueCookie(res); return json(res, 200, { signedIn: true });
      }
      const signedIn = !authHash || basicAuthenticated || sessionAuthenticated;
      const assets: Record<string, { name: Parameters<typeof readWebAsset>[0]; type: string }> = {
        '/': { name: signedIn || publicReview ? 'index.html' : 'login.html', type: 'text/html; charset=utf-8' },
        '/login': { name: 'login.html', type: 'text/html; charset=utf-8' },
        '/app.js': { name: 'app.js', type: 'text/javascript' }, '/style.css': { name: 'style.css', type: 'text/css' },
        '/login.js': { name: 'login.js', type: 'text/javascript' }, '/login.css': { name: 'login.css', type: 'text/css' },
      };
      const publicLoginAsset = ['/', '/login', '/login.js', '/login.css'].includes(path);
      // Public access is an explicit list of evidence GET routes, never a spending session.
      const publicRead = publicReview && req.method === 'GET' && (
        ['/', '/app.js', '/style.css', '/api/state'].includes(path)
        || /^\/api\/reports\/[a-f0-9-]{36}$/.test(path)
        || /^\/api\/artifacts\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|zip)$/.test(path)
      );
      if (!signedIn && !publicLoginAsset && !publicRead) return json(res, 401, { error: 'Sign in to Common to continue' });
      const asset = assets[path];
      if (asset && req.method === 'GET') {
        if (path === '/' && signedIn && !sessionAuthenticated) issueCookie(res);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' }); res.end(await readWebAsset(asset.name)); return;
      }
      if (!sessionAuthenticated && !publicRead) return json(res, 401, { error: 'Open the application to start a session' });
      if (readOnly && req.method !== 'GET') return json(res, 403, { error: 'Read-only review: new evaluations and transaction retries are disabled' });
      if (path === '/api/state' && req.method === 'GET') {
        let spec: EvaluationSpec | undefined; let readinessError: string | undefined;
        try { spec = await specProvider(); } catch (err) { readinessError = safeErrorMessage(err); }
        const decisions = db.list<DecisionRecord>('decisions').map(r => ({ ...r.value, publication: (() => {
          const receipt = db.get<DecisionReceipt>('decision-receipts', r.id);
          return receipt?.hcsStatus === 'confirmed' ? `HCS sequence ${receipt.hcsSequenceNumber ?? 'confirmed'}` : 'HCS publication pending';
        })() })).filter(d => d.workspaceId === workspaceId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        return json(res, 200, { workspaceId, mode: executor.mode, readOnly: readOnly || !sessionAuthenticated, publicReview: publicReview && !sessionAuthenticated, spec, readinessError, buyer: buyer === policyBuyer ? 'policy' : process.env['OPENAI_MODEL'] || 'gpt-4o-mini',
          operations: workflow.operations().map(o => ({ ...o, progress: db.get<TaskEvaluation>('progress', o.operationId) })),
          stats: await workflow.memory.getWorkspaceStats(workspaceId), decisions,
        });
      }
      if (path === '/api/evaluations' && req.method === 'POST') {
        const input = await body(req) as unknown as { requestId: string; agentId: string; spec: EvaluationSpec; goal?: string; budgetTinybar?: string };
        assertRunnableSpec(input.spec);
        return json(res, 202, await (typeof input.goal === 'string' ? workflow.request({ ...input, goal: input.goal }) : workflow.request(input)));
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
