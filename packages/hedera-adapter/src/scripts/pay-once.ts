/**
 * The Phase 1 experiment: one real x402 paid request against the paid service,
 * settled through the Blocky402 facilitator on Hedera testnet.
 *
 * SAFETY: this script refuses to submit a payment unless CONFIRM_REAL_PAYMENT=yes is
 * set. Without it, it performs the unpaid probe only — contacting the resource, reading
 * the quote, and reporting exactly what it WOULD pay. Nothing is signed or submitted.
 *
 *   npm run pay:once            # dry run: probe and report the quote
 *   CONFIRM_REAL_PAYMENT=yes npm run pay:once   # submits a real payment
 *
 * Writes evidence to packages/hedera-adapter/evidence/paid-request-<timestamp>.json.
 * The treasury key is never written to that file, logged, or echoed in an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapterConfig, loadEnvFileIfPresent } from '../config.js';

loadEnvFileIfPresent();
import { executePaidRequest, type PaymentRequirements } from '../payments/x402-client.js';

const RESOURCE_URL = process.env['RESOURCE_URL'] ?? 'http://localhost:3002/datasets/daily-transfers';
const CONFIRMED = process.env['CONFIRM_REAL_PAYMENT'] === 'yes';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(here, '..', '..', 'evidence');

function writeEvidence(name: string, body: unknown): string {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `${name}-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

async function probe(): Promise<PaymentRequirements | null> {
  const response = await fetch(RESOURCE_URL);
  if (response.status !== 402) {
    console.error(`Expected 402, got ${response.status}. Is the paid service running?`);
    return null;
  }
  const header = response.headers.get('payment-required');
  if (!header) {
    console.error('402 carried no PAYMENT-REQUIRED header.');
    return null;
  }
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
    accepts: PaymentRequirements[];
  };
  return decoded.accepts[0] ?? null;
}

async function main(): Promise<void> {
  const config = loadAdapterConfig();

  console.log('--- x402 paid request ---');
  console.log(`resource:  ${RESOURCE_URL}`);
  console.log(`network:   ${config.networkId}`);
  console.log(`treasury:  ${config.treasuryAccountId}`);
  console.log(`ceiling:   ${config.maxPaymentAmount} (smallest unit)\n`);

  const requirements = await probe();
  if (!requirements) {
    process.exitCode = 1;
    return;
  }

  console.log('quote from the resource:');
  console.log(`  scheme:    ${requirements.scheme}`);
  console.log(`  network:   ${requirements.network}`);
  console.log(`  amount:    ${requirements.amount} of ${requirements.asset}`);
  console.log(`  payTo:     ${requirements.payTo}`);
  console.log(`  feePayer:  ${requirements.extra?.feePayer ?? 'MISSING'}`);
  console.log(`  validFor:  ${requirements.maxTimeoutSeconds}s\n`);

  if (!CONFIRMED) {
    const file = writeEvidence('dry-run-quote', { resource: RESOURCE_URL, requirements, submitted: false });
    console.log('DRY RUN. Nothing was signed or submitted.');
    console.log(`Quote written to ${file}`);
    console.log('\nTo submit a real payment:');
    console.log('  $env:CONFIRM_REAL_PAYMENT = "yes"; npm run pay:once');
    return;
  }

  console.log('CONFIRM_REAL_PAYMENT=yes — submitting a real payment.\n');
  const startedAt = new Date().toISOString();

  const outcome = await executePaidRequest({
    resourceUrl: RESOURCE_URL,
    network: config.network,
    fromAccountId: config.treasuryAccountId,
    privateKey: config.treasuryPrivateKey,
    maxAmount: config.maxPaymentAmount,
  });

  const evidence = {
    startedAt,
    finishedAt: new Date().toISOString(),
    resource: RESOURCE_URL,
    network: config.networkId,
    treasuryAccountId: config.treasuryAccountId,
    outcome,
  };

  switch (outcome.status) {
    case 'paid': {
      const file = writeEvidence('paid-request', evidence);
      console.log('PAID');
      console.log(`  transactionId: ${outcome.transactionId}`);
      console.log(`  payer:         ${outcome.payer ?? 'not reported'}`);
      console.log(`  evidence:      ${file}`);
      console.log(`\nVerify: https://hashscan.io/${config.network}/transaction/${outcome.transactionId}`);
      break;
    }
    case 'failed': {
      const file = writeEvidence('failed-request', evidence);
      console.log('FAILED — nothing was submitted. Safe to retry with the same operation id.');
      console.log(`  reason:   ${outcome.reason}`);
      console.log(`  evidence: ${file}`);
      process.exitCode = 1;
      break;
    }
    case 'settlement_unknown': {
      const file = writeEvidence('settlement-unknown', evidence);
      console.log('SETTLEMENT UNKNOWN — the transfer may or may not exist.');
      console.log(`  reason:   ${outcome.reason}`);
      console.log(`  evidence: ${file}`);
      console.log('\nDO NOT retry. Reconcile against the mirror node first:');
      console.log(`  ${config.mirrorNodeUrl}/api/v1/transactions?account.id=${config.treasuryAccountId}`);
      process.exitCode = 2;
      break;
    }
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected failure:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
