/**
 * Phase 2 gate: one real operation linked across reservation, payment, receipt and
 * on-chain event.
 *
 * Runs the complete story against Hedera testnet and the local paid service:
 *   fresh workspace -> fund -> authorize two agents
 *   -> agent A reserves       (on-chain, atomic)
 *   -> agent B is REJECTED    (the core claim of the project)
 *   -> agent A pays           (real x402 payment through Blocky402)
 *   -> settlement recorded    (real transaction id, on-chain)
 *   -> delivery recorded      (payment and delivery kept separate)
 *   -> agent B records reuse  (no second payment)
 *
 * SAFETY: refuses to run without CONFIRM_REAL_PAYMENT=yes. A dry run performs the
 * read-only checks and reports what it would do.
 *
 *   npm run run:operation                              # dry run
 *   $env:CONFIRM_REAL_PAYMENT="yes"; npm run run:operation
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapterConfig, loadEnvFileIfPresent } from '../config.js';
import { BudgetClient } from '../contracts/budget-client.js';
import { createHederaSpendingAdapter, type ResourceResolver } from '../adapter.js';
import { createDecisionNotePublisher } from '../hcs/decision-notes.js';

const singleProvider =
  (binding: { resource: string; payTo: string; asset: string }): ResourceResolver =>
  () =>
    binding;

loadEnvFileIfPresent();

const CONFIRMED = process.env['CONFIRM_REAL_PAYMENT'] === 'yes';
const RESOURCE_URL = process.env['RESOURCE_URL'] ?? 'http://localhost:3002/datasets/daily-transfers';
const PAY_TO = process.env['PAY_TO_ACCOUNT_ID'] ?? '';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(here, '..', '..', 'evidence');

const steps: Array<Record<string, unknown>> = [];
function record(step: string, detail: Record<string, unknown>): void {
  steps.push({ step, ...detail });
  console.log(`  ${step.padEnd(26)} ${JSON.stringify(detail)}`);
}

async function main(): Promise<void> {
  const config = loadAdapterConfig();
  if (!PAY_TO) throw new Error('Set PAY_TO_ACCOUNT_ID (the seller account) in .env');

  const stamp = Date.now();
  const workspaceId = `demo-workspace-${stamp}`;
  const purchaseKey = `common-paid-service:daily-transfers:${stamp}`;
  const operationA = `op-a-${stamp}`;
  const operationB = `op-b-${stamp}`;
  const amount = BigInt(process.env['PRICE_AMOUNT'] ?? '50000000');

  console.log('--- full operation, Hedera testnet ---');
  console.log(`contract:   ${config.contractAddress}`);
  console.log(`workspace:  ${workspaceId}`);
  console.log(`resource:   ${RESOURCE_URL}`);
  console.log(`treasury:   ${config.treasuryAccountId} -> seller ${PAY_TO}`);
  console.log(`amount:     ${amount} tinybars\n`);

  if (!CONFIRMED) {
    const probe = await fetch(RESOURCE_URL);
    console.log(`paid service responded ${probe.status} (402 expected)`);
    console.log('\nDRY RUN. No workspace created, no payment made.');
    console.log('To run for real:');
    console.log('  $env:CONFIRM_REAL_PAYMENT="yes"; npm run run:operation');
    return;
  }

  const budget = new BudgetClient(config.contractAddress, config.jsonRpcUrl, config.operatorPrivateKey);

  // Publish decision notes when a topic is configured; otherwise the run behaves exactly
  // as it did before HCS existed and reports hcsStatus 'pending' honestly.
  const notes = config.hcsTopicId
    ? createDecisionNotePublisher({
        network: config.network,
        topicId: config.hcsTopicId,
        accountId: config.treasuryAccountId,
        privateKey: config.treasuryPrivateKey,
      })
    : undefined;
  console.log(`hcs topic:  ${config.hcsTopicId || 'not configured — notes will not publish'}\n`);

  const adapter = createHederaSpendingAdapter({
    budget,
    resolveResource: singleProvider({ resource: RESOURCE_URL, payTo: PAY_TO, asset: '0.0.0' }),
    network: config.network,
    treasuryAccountId: config.treasuryAccountId,
    treasuryPrivateKey: config.treasuryPrivateKey,
    mirrorNodeUrl: config.mirrorNodeUrl,
    maxPaymentAmount: config.maxPaymentAmount,
    ...(notes ? { notes } : {}),
  });

  // --- setup -------------------------------------------------------------
  const operator = await budget.operatorAddress();
  record('createWorkspace', { tx: await budget.createWorkspace(workspaceId, operator) });
  record('fundWorkspace', { tx: await budget.fundWorkspace(workspaceId, amount * 10n) });
  record('authorize agent-a', { tx: await budget.setAgentAuthorization(workspaceId, 'agent-a', true) });
  record('authorize agent-b', { tx: await budget.setAgentAuthorization(workspaceId, 'agent-b', true) });

  const money = { amount: amount.toString(), tokenId: '0.0.0', decimals: 8 };

  // --- agent A reserves ---------------------------------------------------
  const reservation = await adapter.reserve({
    operationId: operationA,
    workspaceId,
    agentId: 'agent-a',
    purchaseKey,
    amount: money,
  });
  record('agent A reserved', { status: reservation.status, expiresAt: reservation.expiresAt });

  // --- agent B is rejected: the core claim --------------------------------
  try {
    await adapter.reserve({
      operationId: operationB,
      workspaceId,
      agentId: 'agent-b',
      purchaseKey,
      amount: money,
    });
    throw new Error('FAILED: agent B was allowed to reserve the same purchase key');
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'PURCHASE_PENDING') throw err;
    record('agent B REJECTED', { code, note: 'exactly one purchase, as designed' });
  }

  // --- agent A pays -------------------------------------------------------
  const payment = await adapter.executePayment({ operationId: operationA });
  record('payment', payment as unknown as Record<string, unknown>);

  if (payment.status === 'settlement_unknown') {
    console.log('\n  settlement unknown — reconciling against the mirror node...');
    const reconciled = await adapter.reconcile(operationA);
    record('after reconciliation', { status: reconciled.status });
  }

  const afterPayment = await adapter.getOperation(operationA);
  if (afterPayment.status !== 'paid') {
    console.log(`\nStopping: operation is ${afterPayment.status}, not paid. Nothing was repaid.`);
    writeEvidence({ workspaceId, purchaseKey, operationA, steps, outcome: afterPayment });
    process.exitCode = 2;
    return;
  }

  // --- delivery is a separate outcome -------------------------------------
  await adapter.recordDelivery({
    operationId: operationA,
    usable: true,
    freshUntil: new Date(Date.now() + 86_400_000),
    resultRef: `result-${stamp}`,
  });
  record('delivery recorded', { usable: true });

  // --- agent B reuses instead of buying -----------------------------------
  const decision = await adapter.recordDecision({
    schemaVersion: 1,
    decisionId: `decision-b-${stamp}`,
    workspaceId,
    agentId: 'agent-b',
    type: 'reuse',
    chosen: `result-${stamp}`,
    rejected: 'Buy a second copy',
    reason: 'A fresh delivered result already exists for this purchase key.',
    createdAt: new Date().toISOString(),
    operationId: operationA,
  });
  record('agent B reuse decision', {
    eventTx: decision.eventTransactionId,
    hcs: decision.hcsStatus,
    hcsSequence: decision.hcsSequenceNumber ?? null,
  });

  const final = await adapter.getOperation(operationA);
  const remaining = await budget.availableBudget(workspaceId);

  console.log('\n--- result ---');
  console.log(`operation status:  ${final.status}`);
  console.log(`payments made:     1`);
  console.log(`deliverables:      2 (one purchased, one reused)`);
  console.log(`budget remaining:  ${remaining} of ${amount * 10n} tinybars`);

  const file = writeEvidence({ workspaceId, purchaseKey, operationA, operationB, steps, outcome: final });
  console.log(`\nevidence: ${file}`);
  console.log(`contract: https://hashscan.io/testnet/contract/${config.contractAddress}`);
  if (config.hcsTopicId) {
    console.log(`decisions: https://hashscan.io/testnet/topic/${config.hcsTopicId}`);
  }
  notes?.close();
}

function writeEvidence(body: Record<string, unknown>): string {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `operation-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

main().catch((err: unknown) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
