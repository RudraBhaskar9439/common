/**
 * Seeds the deployed contract with one full lifecycle so the subgraph has REAL
 * onchain events to index: workspace created and funded, two agents authorized,
 * one purchase key claimed by agent A, agent B rejected, payment settled,
 * delivery recorded, agent B records a reuse decision.
 *
 *   npm run seed:testnet
 *
 * SUBMITS REAL TRANSACTIONS to whichever network is selected. On testnet this costs
 * only testnet HBAR. The `recordSettlement` call below writes a PLACEHOLDER
 * transaction id — it is seed data for indexing, NOT evidence that a payment happened.
 * Real settlement evidence comes from the x402 payment path in packages/hedera-adapter.
 *
 * Requires COMMON_CONTRACT_ADDRESS and HEDERA_EVM_PRIVATE_KEY in the environment.
 */
const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

const { ethers } = hre;
const id = (s) => ethers.id(s);

const WS = id('workspace-1');
const AGENT_A = id('agent-a');
const AGENT_B = id('agent-b');
const KEY = id('hedera-mirror:daily-transfers:2026-09-10:workspace-1');
const OP_1 = id('op-seed-1');
const OP_2 = id('op-seed-2');

const ASSET = '0.0.0';
const RESOURCE = 'http://localhost:3002/datasets/daily-transfers';
const AMOUNT = 50_000_000n;
const BUDGET = 500_000_000n;
const TTL = 3600;

const steps = [];

async function send(label, promise) {
  process.stdout.write(`  ${label.padEnd(30)}`);
  const receipt = await (await promise).wait();
  const events = [];
  for (const log of receipt.logs) {
    try {
      events.push(contract.interface.parseLog(log).name);
    } catch {
      /* not ours */
    }
  }
  steps.push({
    step: label,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    events,
  });
  console.log(`${receipt.hash}  [${events.join(', ')}]`);
  return receipt;
}

let contract;

async function main() {
  const address = process.env.COMMON_CONTRACT_ADDRESS;
  if (!address) throw new Error('Set COMMON_CONTRACT_ADDRESS in contracts/.env');

  const [operator] = await ethers.getSigners();
  if (!operator) throw new Error('No signer. Set HEDERA_EVM_PRIVATE_KEY.');

  contract = await ethers.getContractAt('CommonBudget', address);
  const payTo = process.env.PAY_TO_ACCOUNT_ID || '0.0.0';

  console.log(`network:  ${hre.network.name}`);
  console.log(`contract: ${address}`);
  console.log(`operator: ${operator.address}\n`);

  await send('createWorkspace', contract.createWorkspace(WS, operator.address));
  await send('fundWorkspace', contract.fundWorkspace(WS, BUDGET));
  await send('authorizeAgentA', contract.setAgentAuthorization(WS, AGENT_A, true));
  await send('authorizeAgentB', contract.setAgentAuthorization(WS, AGENT_B, true));

  const paramsHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'uint256', 'string', 'string', 'string'],
      [WS, KEY, AMOUNT, ASSET, payTo, RESOURCE],
    ),
  );

  await send(
    'agentA.reserve',
    contract.reserve(OP_1, WS, AGENT_A, KEY, AMOUNT, ASSET, payTo, RESOURCE, TTL, paramsHash),
  );

  process.stdout.write('  agentB.reserve (must fail)     ');
  try {
    await (
      await contract.reserve(OP_2, WS, AGENT_B, KEY, AMOUNT, ASSET, payTo, RESOURCE, TTL, paramsHash)
    ).wait();
    throw new Error('SEED FAILED: the second reservation was accepted');
  } catch (err) {
    const msg = String(err);
    if (msg.includes('SEED FAILED')) throw err;
    console.log('rejected as expected (PurchaseAlreadyReserved)');
    steps.push({ step: 'agentB.reserve', rejected: true, reason: 'PurchaseAlreadyReserved' });
  }

  await send('markPaymentPending', contract.markPaymentPending(OP_1));
  await send(
    'recordSettlement (PLACEHOLDER id)',
    contract.recordSettlement(OP_1, 'SEED-PLACEHOLDER-not-a-real-payment', AMOUNT),
  );
  await send(
    'recordDelivery',
    contract.recordDelivery(OP_1, true, Math.floor(Date.now() / 1000) + 86400, 'result-daily-transfers-1', ''),
  );
  await send(
    'agentB.recordDecision(reuse)',
    contract.recordDecision(WS, id('decision-seed-b1'), AGENT_B, 1, OP_1, ''),
  );

  const out = path.join(__dirname, '..', 'abi', 'seed-transactions.json');
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        note: 'Real onchain transactions. recordSettlement carries a placeholder id and is NOT payment evidence.',
        network: hre.network.name,
        chainId: hre.network.config.chainId,
        contract: address,
        operator: operator.address,
        workspaceId: WS,
        purchaseKey: KEY,
        steps,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nWrote ${out}`);
  console.log(`hashscan: https://hashscan.io/testnet/contract/${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
