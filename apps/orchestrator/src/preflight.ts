import { defaultEvaluationSpec } from '@common/evaluation-runner';
import { CommonDatabase } from '@common/result-store';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url))); } catch { /* optional */ }
const checks: { name: string; ok: boolean; detail: string }[] = [];
try {
  const spec = await defaultEvaluationSpec();
  checks.push({ name: 'Open models and inference runtime', ok: true, detail: spec.models.map(m => `${m.id} ${m.quantization}`).join(', ') });
} catch { checks.push({ name: 'Open models and inference runtime', ok: false, detail: 'Start Ollama and pull qwen3:1.7b and qwen3:4b' }); }
try { const browser = await chromium.launch(); await browser.close(); checks.push({ name: 'Chromium', ok: true, detail: 'Browser launched and closed' }); }
catch { checks.push({ name: 'Chromium', ok: false, detail: 'Run npx playwright install chromium' }); }
const dir = await mkdtemp(join(tmpdir(), 'common-preflight-'));
try {
  const path = join(dir, 'check.sqlite'); const first = new CommonDatabase(path); first.set('check','restart',{ok:true}); first.close();
  const second = new CommonDatabase(path); const ok = second.get<{ok:boolean}>('check','restart')?.ok === true; second.close();
  checks.push({ name: 'Durable SQLite', ok, detail: 'Written and reopened a temporary database' });
} finally { await rm(dir, { recursive: true, force: true }); }
const required = ['HEDERA_ACCOUNT_ID','HEDERA_PRIVATE_KEY','HEDERA_EVM_PRIVATE_KEY','COMMON_CONTRACT_ADDRESS','HCS_TOPIC_ID','PAY_TO_ACCOUNT_ID','FACILITATOR_FEE_PAYER_ACCOUNT_ID'];
const missing = required.filter(name => !process.env[name]);
console.log(JSON.stringify({ local: checks, liveTestnet: { configured: missing.length === 0, missing, verified: false,
  note: 'Configuration presence only; no signer constructed, request signed or payment submitted. Fresh deployment, workspace setup, facilitator and actual settlement still need verification.' } }, null, 2));
if (checks.some(c => !c.ok)) process.exitCode = 1;
