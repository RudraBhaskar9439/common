import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { CommonDatabase } from '@common/result-store';
import { createEvaluationRunner, verifyLocalEvaluationSpec } from '@common/evaluation-runner';
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
export function createJobHandler(jobs: ReturnType<typeof createEvaluationJobs>, mirrorUrl: string, artifactDir?: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/health') return writeJson(res, 200, { status: 'ok', service: 'open-model-evaluation', paymentMode: 'hedera-testnet', syntheticData: false });
      if (path === '/jobs' && req.method === 'POST') {
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
      const match = /^\/jobs\/([a-f0-9-]{36})(?:\/(execute|report|reconcile))?$/.exec(path);
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
  if (config.network !== 'hedera:testnet' || config.priceAsset !== '0.0.0') throw new Error('This deployment supports testnet HBAR only');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = resolve(root, process.env['COMMON_DATA_DIR'] ?? '.common-data');
  const db = new CommonDatabase(join(dir, 'service.sqlite'));
  const jobs = createEvaluationJobs({ database: db, config,
    publicUrl: process.env['PUBLIC_SERVICE_URL'] ?? `http://127.0.0.1:${config.port}`,
    facilitator: new FacilitatorClient(config.facilitatorUrl),
    runner: createEvaluationRunner({ artifactDir: join(dir, 'service-artifacts') }),
    verifySpec: verifyLocalEvaluationSpec,
  });
  const handler = createJobHandler(jobs, process.env['HEDERA_MIRROR_NODE_URL'] ?? 'https://testnet.mirrornode.hedera.com', join(dir, 'service-artifacts'));
  const server = createServer((req,res) => { void handler(req,res); });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', done); });
  jobs.resume();
  console.log(`Hedera evaluation service: http://127.0.0.1:${config.port}`);
  return { server, jobs, close: async () => { server.close(); await jobs.close(); db.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startEvaluationService();
