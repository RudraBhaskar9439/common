/**
 * Read-only health check for Kavish's components. Spends nothing, signs nothing,
 * submits nothing — every call here is a GET or an eth_call.
 *
 *   npx tsx infra/scripts/health-check.ts
 *
 * Run this before a demo. It catches the failures that are embarrassing live: a stopped
 * paid service, an unfunded treasury, a rotated facilitator fee payer, or an RPC relay
 * that is rate-limiting.
 */
import { JsonRpcProvider, Contract } from 'ethers';

// Read the adapter's own .env so the contract and treasury checks run without the
// operator exporting anything by hand. Shell variables still win.
for (const file of ['packages/hedera-adapter/.env', 'apps/paid-service/.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent: rely on the ambient environment */
  }
}

/** Distinguishes a real pass from a check that could not run. */
class Skipped extends Error {}

interface Check {
  name: string;
  run: () => Promise<string>;
}

const PAID_SERVICE = process.env['PAID_SERVICE_URL'] ?? 'http://localhost:3002';
const FACILITATOR = process.env['BLOCKY402_FACILITATOR_URL'] ?? 'https://api.testnet.blocky402.com';
const MIRROR = process.env['HEDERA_MIRROR_NODE_URL'] ?? 'https://testnet.mirrornode.hedera.com';
const RPC = process.env['HEDERA_JSON_RPC_URL'] ?? 'https://testnet.hashio.io/api';
const CONTRACT = process.env['COMMON_CONTRACT_ADDRESS'] ?? '';
const TREASURY = process.env['HEDERA_ACCOUNT_ID'] ?? '';

/** Below this the demo will fail partway through. One payment is 0.5 HBAR. */
const MIN_TREASURY_TINYBARS = 200_000_000n;

const checks: Check[] = [
  {
    name: 'paid service',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/health`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { payTo?: string; datasets?: string[] };
      return `up, payTo ${body.payTo}, datasets: ${body.datasets?.join(', ')}`;
    },
  },
  {
    name: 'paid service gate',
    async run() {
      const response = await fetch(`${PAID_SERVICE}/datasets/daily-transfers`);
      if (response.status !== 402) throw new Error(`expected 402, got ${response.status}`);
      if (!response.headers.get('payment-required')) throw new Error('402 without PAYMENT-REQUIRED header');
      return '402 with payment requirements';
    },
  },
  {
    name: 'facilitator',
    async run() {
      const response = await fetch(`${FACILITATOR}/supported`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { kinds?: Array<{ network?: string; extra?: { feePayer?: string } }> };
      const hedera = body.kinds?.find((k) => k.network?.startsWith('hedera:'));
      if (!hedera) throw new Error('facilitator does not currently support hedera');
      return `hedera live, feePayer ${hedera.extra?.feePayer}`;
    },
  },
  {
    name: 'mirror node',
    async run() {
      if (!TREASURY) throw new Skipped('HEDERA_ACCOUNT_ID not set');
      const response = await fetch(`${MIRROR}/api/v1/accounts/${TREASURY}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { balance?: { balance?: number } };
      const balance = BigInt(body.balance?.balance ?? 0);
      if (balance < MIN_TREASURY_TINYBARS) {
        throw new Error(`treasury balance ${balance} tinybars is below the ${MIN_TREASURY_TINYBARS} floor`);
      }
      return `treasury ${TREASURY} holds ${balance} tinybars`;
    },
  },
  {
    name: 'contract',
    async run() {
      if (!CONTRACT) throw new Skipped('COMMON_CONTRACT_ADDRESS not set');
      const provider = new JsonRpcProvider(RPC);
      const code = await provider.getCode(CONTRACT);
      if (code === '0x') throw new Error('no contract deployed at that address');
      const contract = new Contract(
        CONTRACT,
        ['function isAgentAuthorized(bytes32,bytes32) view returns (bool)'],
        provider,
      );
      // Any successful eth_call proves the relay and the contract are both reachable.
      await contract.getFunction('isAgentAuthorized')(`0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`);
      return `deployed and callable at ${CONTRACT}`;
    },
  },
];

async function main(): Promise<void> {
  console.log('Common health check (read-only)\n');
  let failed = 0;
  let skipped = 0;

  for (const check of checks) {
    try {
      console.log(`  PASS  ${check.name.padEnd(20)} ${await check.run()}`);
    } catch (err) {
      if (err instanceof Skipped) {
        skipped += 1;
        console.log(`  SKIP  ${check.name.padEnd(20)} ${err.message}`);
        continue;
      }
      failed += 1;
      console.log(`  FAIL  ${check.name.padEnd(20)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A skipped check is not a pass. Say so, so an unconfigured run is never mistaken
  // for a healthy one before a demo.
  const summary = [
    failed === 0 ? 'All checks passed.' : `${failed} check(s) FAILED.`,
    skipped > 0 ? `${skipped} skipped — configuration missing, not verified.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  console.log(`\n${summary}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
