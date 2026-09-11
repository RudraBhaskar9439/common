/**
 * Phase 4 failure drills, run against the REAL contract on Hedera testnet.
 *
 * Every drill asserts a money-safety property. They are driven through the adapter and
 * the contract directly rather than through a stubbed facilitator, because the states
 * that matter — unknown settlement, expiry, delivery failure — are contract states, and
 * forcing them directly is both cheaper and more honest than mocking a payment.
 *
 *   npx tsx infra/scripts/failure-drills.ts
 *      runs every drill that needs no payment (most of them)
 *
 *   $env:CONFIRM_REAL_PAYMENT="yes"; npx tsx infra/scripts/failure-drills.ts
 *      additionally runs the drills that require one real payment
 *
 * Each run creates a fresh workspace, so drills never collide with earlier runs.
 * Drills also generate the ReservationReleased logs the subgraph still lacks.
 */
import { CommonError } from '../../packages/interfaces/src/index.js';
import { loadAdapterConfig, loadEnvFileIfPresent } from '../../packages/hedera-adapter/src/config.js';
import { BudgetClient, ContractStatus } from '../../packages/hedera-adapter/src/contracts/budget-client.js';
import {
  createHederaSpendingAdapter,
  type ResourceResolver,
} from '../../packages/hedera-adapter/src/adapter.js';

loadEnvFileIfPresent('packages/hedera-adapter/.env');

const CONFIRMED = process.env['CONFIRM_REAL_PAYMENT'] === 'yes';
const RESOURCE_URL = process.env['RESOURCE_URL'] ?? 'http://localhost:3002/datasets/daily-transfers';
const PAY_TO = process.env['PAY_TO_ACCOUNT_ID'] ?? '';

/** Short enough that expiry drills finish quickly, long enough to complete a payment. */
const TTL = 40;
const AMOUNT = 50_000_000n;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;

async function drill(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    passed += 1;
    console.log(`  PASS  ${name}\n        ${detail}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Asserts a call fails with a specific error code. */
async function expectCode(code: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (err) {
    const actual = (err as CommonError).code;
    if (actual === code) return;
    throw new Error(`expected ${code}, got ${actual ?? String(err)}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

async function main(): Promise<void> {
  const config = loadAdapterConfig();
  if (!PAY_TO) throw new Error('Set PAY_TO_ACCOUNT_ID in packages/hedera-adapter/.env');

  const budget = new BudgetClient(config.contractAddress, config.jsonRpcUrl, config.operatorPrivateKey);
  const resolve: ResourceResolver = () => ({ resource: RESOURCE_URL, payTo: PAY_TO, asset: '0.0.0' });
  const adapter = createHederaSpendingAdapter({
    budget,
    resolveResource: resolve,
    network: config.network,
    treasuryAccountId: config.treasuryAccountId,
    treasuryPrivateKey: config.treasuryPrivateKey,
    mirrorNodeUrl: config.mirrorNodeUrl,
    maxPaymentAmount: config.maxPaymentAmount,
    reservationTtlSeconds: TTL,
  });

  const stamp = Date.now();
  const ws = `drill-workspace-${stamp}`;
  const money = { amount: AMOUNT.toString(), tokenId: '0.0.0', decimals: 8 };
  const key = (suffix: string) => `drill:${suffix}:${stamp}`;
  const op = (suffix: string) => `drill-op-${suffix}-${stamp}`;

  console.log(`Phase 4 failure drills — contract ${config.contractAddress}`);
  console.log(`workspace ${ws}, payments ${CONFIRMED ? 'ENABLED' : 'disabled (dry)'}\n`);

  const operator = await budget.operatorAddress();
  await budget.createWorkspace(ws, operator);
  await budget.fundWorkspace(ws, AMOUNT * 4n);
  await budget.setAgentAuthorization(ws, 'agent-a', true);
  await budget.setAgentAuthorization(ws, 'agent-b', true);
  console.log('  setup complete\n');

  // ---------------------------------------------------------------- access
  await drill('an unauthorized agent cannot reserve', async () => {
    await expectCode('UNAUTHORIZED', () =>
      adapter.reserve({ operationId: op('unauth'), workspaceId: ws, agentId: 'agent-never', purchaseKey: key('unauth'), amount: money }),
    );
    return 'agent-never was refused';
  });

  await drill('a reservation beyond the budget is refused', async () => {
    await expectCode('INSUFFICIENT_BUDGET', () =>
      adapter.reserve({
        operationId: op('over'),
        workspaceId: ws,
        agentId: 'agent-a',
        purchaseKey: key('over'),
        amount: { ...money, amount: (AMOUNT * 100n).toString() },
      }),
    );
    return 'over-budget reservation refused, budget untouched';
  });

  // ----------------------------------------------------------- competition
  await drill('two agents competing produce exactly one reservation', async () => {
    const k = key('race');
    await adapter.reserve({ operationId: op('race-a'), workspaceId: ws, agentId: 'agent-a', purchaseKey: k, amount: money });
    await expectCode('PURCHASE_PENDING', () =>
      adapter.reserve({ operationId: op('race-b'), workspaceId: ws, agentId: 'agent-b', purchaseKey: k, amount: money }),
    );
    return 'agent-b rejected; one claim stands';
  });

  await drill('the same operation id with a conflicting amount is refused', async () => {
    await expectCode('UNAUTHORIZED', () =>
      adapter.reserve({
        operationId: op('race-a'),
        workspaceId: ws,
        agentId: 'agent-a',
        purchaseKey: key('race'),
        amount: { ...money, amount: (AMOUNT + 1n).toString() },
      }),
    );
    return 'conflicting parameters rejected; the original reservation is intact';
  });

  // ------------------------------------------------- crash before payment
  await drill('a crash before payment releases safely and frees the key', async () => {
    const k = key('crash-before');
    const before = await budget.availableBudget(ws);
    await adapter.reserve({ operationId: op('crash-before'), workspaceId: ws, agentId: 'agent-a', purchaseKey: k, amount: money });
    const committed = await budget.availableBudget(ws);
    if (committed !== before - AMOUNT) throw new Error('budget was not committed on reserve');

    // The crash: nothing else happens. Recovery releases the untouched reservation.
    await adapter.release(op('crash-before'));

    const after = await budget.availableBudget(ws);
    if (after !== before) throw new Error(`budget not restored: ${after} vs ${before}`);

    // The key is claimable again, so a later agent can buy it.
    await adapter.reserve({ operationId: op('crash-before-2'), workspaceId: ws, agentId: 'agent-b', purchaseKey: k, amount: money });
    await adapter.release(op('crash-before-2'));
    return 'budget restored and the purchase key was reclaimable (ReservationReleased reason 0)';
  });

  // ----------------------------------------- crash after submission (unknown)
  await drill('unknown settlement blocks release and repayment', async () => {
    const k = key('unknown');
    const id = op('unknown');
    await adapter.reserve({ operationId: id, workspaceId: ws, agentId: 'agent-a', purchaseKey: k, amount: money });
    await budget.markPaymentPending(id);
    await budget.flagSettlementUnknown(id);

    // Release must be refused: the transfer may exist.
    await expectCode('SETTLEMENT_UNKNOWN', () => adapter.release(id));

    // The purchase key stays claimed, so no second agent can buy the same thing.
    await expectCode('PURCHASE_PENDING', () =>
      adapter.reserve({ operationId: op('unknown-2'), workspaceId: ws, agentId: 'agent-b', purchaseKey: k, amount: money }),
    );
    return 'release refused, key still claimed (SettlementUnknownFlagged emitted)';
  });

  await drill('an unknown settlement is not resolved while its window is open', async () => {
    // Reconciliation must stay inconclusive: no transfer exists, but one could still land.
    const operation = await adapter.reconcile(op('unknown'));
    if (operation.status !== 'settlement_unknown') {
      throw new Error(`expected to remain settlement_unknown, got ${operation.status}`);
    }
    return 'stayed stuck rather than guessing';
  });

  await drill('an unknown settlement resolves to released once proven absent', async () => {
    const before = await budget.availableBudget(ws);
    console.log(`        waiting ${TTL}s for the validity window to close...`);
    await sleep((TTL + 5) * 1000);

    const operation = await adapter.reconcile(op('unknown'));
    if (operation.status !== 'released') throw new Error(`expected released, got ${operation.status}`);

    const after = await budget.availableBudget(ws);
    if (after !== before + AMOUNT) throw new Error('budget was not returned after reconciliation');
    return 'proven absent, budget returned (ReservationReleased reason 2)';
  });

  // ------------------------------------------------------------- expiry
  await drill('a lapsed unpaid reservation expires and frees its budget', async () => {
    const id = op('expiry');
    const before = await budget.availableBudget(ws);
    await adapter.reserve({ operationId: id, workspaceId: ws, agentId: 'agent-a', purchaseKey: key('expiry'), amount: money });

    console.log(`        waiting ${TTL}s for the reservation to lapse...`);
    await sleep((TTL + 5) * 1000);

    // A competing reservation lazily expires the lapsed claim and takes it.
    await adapter.reserve({ operationId: op('expiry-2'), workspaceId: ws, agentId: 'agent-b', purchaseKey: key('expiry'), amount: money });
    await adapter.release(op('expiry-2'));

    const after = await budget.availableBudget(ws);
    if (after !== before) throw new Error(`budget not restored after expiry: ${after} vs ${before}`);
    return 'lapsed claim expired and was reclaimed (ReservationReleased reason 1)';
  });

  // -------------------------------------------------- payment-dependent
  if (!CONFIRMED) {
    console.log('\n  SKIP  paid delivery failure — needs CONFIRM_REAL_PAYMENT=yes');
    console.log('  SKIP  repeated execution after payment — needs CONFIRM_REAL_PAYMENT=yes');
  } else {
    const id = op('paid');
    const k = key('paid');
    await adapter.reserve({ operationId: id, workspaceId: ws, agentId: 'agent-a', purchaseKey: k, amount: money });
    const payment = await adapter.executePayment({ operationId: id });
    if (payment.status === 'settlement_unknown') await adapter.reconcile(id);

    await drill('a paid operation cannot be paid again', async () => {
      await expectCode('UNAUTHORIZED', () => adapter.executePayment({ operationId: id }));
      return 'second executePayment refused; no double payment';
    });

    await drill('delivery failure keeps the payment and does not free the key', async () => {
      const spentBefore = await budget.availableBudget(ws);
      await adapter.recordDelivery({
        operationId: id,
        usable: false,
        freshUntil: new Date(),
        resultRef: '',
        failureReason: 'provider returned a corrupt payload',
      });

      const operation = await adapter.getOperation(id);
      if (operation.status !== 'delivery_failed') throw new Error(`expected delivery_failed, got ${operation.status}`);

      // No refund: the money genuinely left.
      const spentAfter = await budget.availableBudget(ws);
      if (spentAfter !== spentBefore) throw new Error('delivery failure incorrectly moved the budget');

      // And no automatic repurchase: the key stays claimed.
      await expectCode('PURCHASE_PENDING', () =>
        adapter.reserve({ operationId: op('paid-2'), workspaceId: ws, agentId: 'agent-b', purchaseKey: k, amount: money }),
      );
      return 'payment stands, no refund, no automatic repurchase';
    });
  }

  console.log(`\n${failed === 0 ? `All ${passed} drills passed.` : `${failed} of ${passed + failed} drills FAILED.`}`);
  console.log(`workspace ${ws} — https://hashscan.io/testnet/contract/${config.contractAddress}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error('\nDrill run failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
