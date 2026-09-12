import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CommonDatabase } from '@common/result-store';
import { createEvaluationRunner, defaultEvaluationSpec, verifyLocalEvaluationSpec } from '@common/evaluation-runner';
import { createEvaluationJobs } from './evaluation-jobs.js';
import { FacilitatorClient, encodeHeader } from './payment/x402.js';
import { loadConfig, loadEnvFileIfPresent } from './config.js';

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 65536) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string,string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body));
}
export function createJobHandler(jobs: ReturnType<typeof createEvaluationJobs>, mirrorUrl: string, artifactDir?: string, admissionKey?: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/' && req.method === 'GET') return writeJson(res, 200, { service: 'Common open-model browser evaluations', network: 'hedera:testnet', protocol: 'x402 v2', admissionKeyRequired: Boolean(admissionKey), catalogue: '/catalogue', prepare: 'POST /jobs', execute: 'GET /jobs/:id/execute', delivery: 'GET /jobs/:id/report with Bearer job token', description: 'Real Qwen inference and five controlled browser tasks; payment buys execution and a reusable measured report.' });
      if (path === '/catalogue' && req.method === 'GET') return writeJson(res, 200, { spec: await defaultEvaluationSpec() });
      if (path === '/health') return writeJson(res, 200, { status: 'ok', service: 'open-model-evaluation', paymentMode: 'hedera-testnet', syntheticData: false });
      if (path === '/jobs' && req.method === 'POST') {
        if (admissionKey && !timingSafeEqual(createHash('sha256').update(admissionKey).digest(), createHash('sha256').update(String(req.headers['x-common-service-key'] ?? '')).digest())) {
          return writeJson(res, 403, { error: 'Provider access key required to prepare jobs' });
        }
        const input = await readJson(req) as Parameters<typeof jobs.prepare>[0];
        const job = await jobs.prepare(input);
        return writeJson(res, 201, { jobId: job.jobId, status: job.status, requirements: job.requirements });
      }
      const artifact = /^\/jobs\/([a-f0-9-]{36})\/artifacts\/([a-f0-9]{64}\.(png|zip))$/.exec(path);
      if (artifact && req.method === 'GET' && artifactDir) {
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        const report = jobs.report(artifact[1]!, token);
        if (!report.tasks.some(t => t.traceId === artifact[2] || t.screenshotId === artifact[2])) return writeJson(res, 403, { error: 'Artifact not in report' });
        const bytes = await readFile(join(artifactDir, artifact[2]!));
        res.writeHead(200, { 'content-type': artifact[3] === 'png' ? 'image/png' : 'application/zip', 'cache-control': 'private, no-store' }); res.end(bytes); return;
      }
      const match = /^\/jobs\/([a-f0-9-]{36})(?:\/(execute|report|reconcile|retry))?$/.exec(path);
      if (!match) return writeJson(res, 404, { error: 'not_found' });
      const id = match[1]!; const action = match[2];
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (action === 'execute' && req.method === 'GET') {
        const signature = req.headers['payment-signature'];
        const result = await jobs.execute(id, typeof signature === 'string' ? signature : undefined);
        return writeJson(res, result.status, result.body, result.requirements ? { 'payment-required': encodeHeader({ x402Version: 2, accepts: [result.requirements] }) } : {});
      }
      if (!action && req.method === 'GET') return writeJson(res, 200, jobs.status(id, token));
      if (action === 'report' && req.method === 'GET') return writeJson(res, 200, jobs.report(id, token));
      if (action === 'reconcile' && req.method === 'POST') {
        await jobs.reconcile(id, token, mirrorUrl);
        return writeJson(res, 200, jobs.status(id, token));
      }
      // Re-run a paid job after a provider-side failure. Same receipt; never a new charge.
      if (action === 'retry' && req.method === 'POST') {
        jobs.retry(id, token);
        return writeJson(res, 200, jobs.status(id, token));
      }
      return writeJson(res, 405, { error: 'method_not_allowed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      return writeJson(res, /Unauthorized/.test(message) ? 403 : /not found/.test(message) ? 404 : 400, { error: message });
    }
  };
}

export async function startEvaluationService() {
  loadEnvFileIfPresent(fileURLToPath(new URL('../../../.env', import.meta.url)));
  loadEnvFileIfPresent();
  const config = loadConfig();
  const publicUrl = process.env['PUBLIC_SERVICE_URL'] ?? `http://127.0.0.1:${config.port}`;
  const admissionKey = process.env['COMMON_SERVICE_KEY'];
  if (!['localhost', '127.0.0.1'].includes(new URL(publicUrl).hostname) && (!publicUrl.startsWith('https://') || !admissionKey || admissionKey.length < 24)) throw new Error('Hosted service requires HTTPS and an admission key of at least 24 characters');
  if (config.network !== 'hedera:testnet' || config.priceAsset !== '0.0.0') throw new Error('This deployment supports testnet HBAR only');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = resolve(root, process.env['COMMON_DATA_DIR'] ?? '.common-data');
  const db = new CommonDatabase(join(dir, 'service.sqlite'));
  const jobs = createEvaluationJobs({ database: db, config,
    publicUrl,
    facilitator: new FacilitatorClient(config.facilitatorUrl),
    runner: createEvaluationRunner({ artifactDir: join(dir, 'service-artifacts') }),
    verifySpec: verifyLocalEvaluationSpec,
  });
  const handler = createJobHandler(jobs, process.env['HEDERA_MIRROR_NODE_URL'] ?? 'https://testnet.mirrornode.hedera.com', join(dir, 'service-artifacts'), admissionKey);
  const server = createServer((req,res) => { void handler(req,res); });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', done); });
  jobs.resume();
  console.log(`Hedera evaluation service: http://127.0.0.1:${config.port}`);
  return { server, jobs, close: async () => { server.close(); await jobs.close(); db.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startEvaluationService();
