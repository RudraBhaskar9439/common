/**
 * Live verification against the real services. No payment, no signing, no chain writes —
 * every check here is a GET or a read-only query, so it is safe to run repeatedly.
 *
 *   npx tsx infra/scripts/live-verify.ts
 *
 * Complements the unit tests rather than replacing them:
 *   - Unit tests use stubs to force conditions the real services will not produce on
 *     demand (a facilitator that hangs, a mirror node that vanishes).
 *   - This file proves the same logic against the REAL paid service, the REAL Blocky402
 *     facilitator and the REAL Hedera mirror node.
 *
 * Both matter. A stub can drift from reality; a live run cannot cover failure paths.
 */
import { reconcileSettlement } from '../../packages/hedera-adapter/src/reconciliation/mirror-node.js';

for (const file of ['packages/hedera-adapter/.env', 'apps/paid-service/.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent */
  }
}

const PAID_SERVICE = process.env['PAID_SERVICE_URL'] ?? 'http://localhost:3002';
const FACILITATOR = process.env['BLOCKY402_FACILITATOR_URL'] ?? 'https://api.testnet.blocky402.com';
const MIRROR = process.env['HEDERA_MIRROR_NODE_URL'] ?? 'https://testnet.mirrornode.hedera.com';
const TREASURY = process.env['HEDERA_ACCOUNT_ID'] ?? '0.0.10463485';
const SELLER = process.env['PAY_TO_ACCOUNT_ID'] ?? '0.0.10463575';
const PRICE = BigInt(process.env['PRICE_AMOUNT'] ?? '50000000');

const PAST = Math.floor(Date.now() / 1000) - 3600;
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
/** Wide enough to include every payment this project has ever made. */
const LONG_AGO = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

interface Check {
  group: string;
  name: string;
  run: () => Promise<string>;
}

const checks: Check[] = [
  // --- the gate, against the real service --------------------------------
  {
    group: 'gate',
    name: 'unpaid request is refused with full requirements',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/datasets/daily-transfers`);
      if (response.status !== 402) throw new Error(`expected 402, got ${response.status}`);
      const header = response.headers.get('payment-required');
      if (!header) throw new Error('no PAYMENT-REQUIRED header');
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
        accepts: Array<{ scheme: string; network: string; payTo: string; extra?: { feePayer?: string } }>;
      };
      const req = decoded.accepts[0];
      if (!req) throw new Error('no payment requirements offered');
      if (req.scheme !== 'exact') throw new Error(`unexpected scheme ${req.scheme}`);
      if (!req.network.startsWith('hedera:')) throw new Error(`unexpected network ${req.network}`);
      if (!req.extra?.feePayer) throw new Error('requirements omit extra.feePayer');
      return `402, ${req.network}, payTo ${req.payTo}, feePayer ${req.extra.feePayer}`;
    },
  },
  {
    group: 'gate',
    name: 'unpaid request leaks no content',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/datasets/daily-transfers`);
      const body = (await response.json()) as Record<string, unknown>;
      if (body['content'] !== undefined) throw new Error('content was delivered without payment');
      return 'no content before payment';
    },
  },
  {
    group: 'gate',
    name: 'malformed payment header is rejected',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/datasets/daily-transfers`, {
        headers: { 'payment-signature': 'not-base64-json' },
      });
      if (response.status !== 400) throw new Error(`expected 400, got ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      if (body['content'] !== undefined) throw new Error('content delivered despite malformed payment');
      return 'rejected with 400, no content';
    },
  },
  {
    group: 'gate',
    name: 'unknown dataset is refused',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/datasets/does-not-exist`);
      if (response.status !== 404) throw new Error(`expected 404, got ${response.status}`);
      return 'refused with 404';
    },
  },

  // --- the facilitator, live ---------------------------------------------
  {
    group: 'facilitator',
    name: 'advertised feePayer matches what the service offers',
    async run() {
      const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as {
        kinds?: Array<{ network?: string; extra?: { feePayer?: string } }>;
      };
      const hedera = supported.kinds?.find((k) => k.network?.startsWith('hedera:'));
      if (!hedera?.extra?.feePayer) throw new Error('facilitator advertises no hedera feePayer');

      const header = (await fetch(`${PAID_SERVICE}/datasets/daily-transfers`)).headers.get('payment-required');
      const offered = JSON.parse(Buffer.from(header ?? '', 'base64').toString('utf8')) as {
        accepts: Array<{ extra?: { feePayer?: string } }>;
      };
      const serviceFeePayer = offered.accepts[0]?.extra?.feePayer;

      if (serviceFeePayer !== hedera.extra.feePayer) {
        throw new Error(
          `service offers feePayer ${serviceFeePayer} but facilitator advertises ${hedera.extra.feePayer} — every payment will fail`,
        );
      }
      return `both agree on ${hedera.extra.feePayer}`;
    },
  },

  // --- reconciliation, against the REAL mirror node -----------------------
  {
    group: 'reconciliation',
    name: 'finds a real past payment',
    async run() {
      const result = await reconcileSettlement({
        mirrorNodeUrl: MIRROR,
        payTo: SELLER,
        payer: TREASURY,
        amount: PRICE,
        validUntilEpochSeconds: PAST,
        notBeforeEpochSeconds: LONG_AGO,
      });
      if (result.status !== 'found') {
        throw new Error(`expected to find a past ${PRICE} payment, got ${result.status}`);
      }
      return `found ${result.transactionId}`;
    },
  },
  {
    group: 'reconciliation',
    name: 'ignores payments that predate the reservation',
    async run() {
      // The same query that just succeeded, bounded to "only transfers from now on".
      // Every real payment is older than that, so a correct implementation finds none.
      const result = await reconcileSettlement({
        mirrorNodeUrl: MIRROR,
        payTo: SELLER,
        payer: TREASURY,
        amount: PRICE,
        validUntilEpochSeconds: PAST,
        notBeforeEpochSeconds: Math.floor(Date.now() / 1000),
      });
      if (result.status !== 'absent') {
        throw new Error(`an earlier payment was wrongly adopted: ${result.status}`);
      }
      return 'earlier identical payments correctly ignored';
    },
  },
  {
    group: 'reconciliation',
    name: 'reports absent for a payment that never happened',
    async run() {
      // An amount no operation has ever used, with a window that has closed.
      const result = await reconcileSettlement({
        mirrorNodeUrl: MIRROR,
        payTo: SELLER,
        payer: TREASURY,
        amount: 13_579n,
        validUntilEpochSeconds: PAST,
        notBeforeEpochSeconds: LONG_AGO,
      });
      if (result.status !== 'absent') throw new Error(`expected absent, got ${result.status}`);
      return 'correctly reports absent';
    },
  },
  {
    group: 'reconciliation',
    name: 'stays inconclusive while the window is still open',
    async run() {
      // The dangerous case: calling this "absent" would release the budget and permit
      // a second payment for a transfer that may still land.
      const result = await reconcileSettlement({
        mirrorNodeUrl: MIRROR,
        payTo: SELLER,
        payer: TREASURY,
        amount: 13_579n,
        validUntilEpochSeconds: FUTURE,
        notBeforeEpochSeconds: LONG_AGO,
      });
      if (result.status !== 'inconclusive') throw new Error(`expected inconclusive, got ${result.status}`);
      return 'correctly refuses to conclude';
    },
  },
  {
    group: 'reconciliation',
    name: 'ignores a payment from a different payer',
    async run() {
      const result = await reconcileSettlement({
        mirrorNodeUrl: MIRROR,
        payTo: SELLER,
        payer: '0.0.999999999',
        amount: PRICE,
        validUntilEpochSeconds: PAST,
        notBeforeEpochSeconds: LONG_AGO,
      });
      if (result.status !== 'absent') throw new Error(`expected absent for a foreign payer, got ${result.status}`);
      return 'correctly ignores a foreign payer';
    },
  },
];

async function main(): Promise<void> {
  console.log('Live verification against real services — no payment, no signing\n');
  let failed = 0;
  let group = '';

  for (const check of checks) {
    if (check.group !== group) {
      group = check.group;
      console.log(`  ${group}`);
    }
    try {
      console.log(`    PASS  ${check.name.padEnd(52)} ${await check.run()}`);
    } catch (err) {
      failed += 1;
      console.log(`    FAIL  ${check.name.padEnd(52)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    failed === 0
      ? `\nAll ${checks.length} live checks passed.`
      : `\n${failed} of ${checks.length} live checks FAILED.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
