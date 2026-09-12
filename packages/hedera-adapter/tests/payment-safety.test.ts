import assert from 'node:assert/strict';
import test from 'node:test';
import { executePaidRequest } from '../src/payments/x402-client.js';
import { createHederaSpendingAdapter, createMemoryRegistry } from '../src/adapter.js';
import { computeParamsHash, ContractStatus, type OnChainOperation } from '../src/contracts/budget-client.js';
import { reconcileSettlement } from '../src/reconciliation/mirror-node.js';
import { PrivateKey } from '@hashgraph/sdk';

const terms = { scheme: 'exact', network: 'hedera:testnet', amount: '50000000', asset: '0.0.0', payTo: '0.0.10', maxTimeoutSeconds: 120, resource: 'http://provider.invalid/data', extra: { feePayer: '0.0.20' } };
for (const scenario of ['matching-receipt', 'different-receipt', 'http-402', 'network-timeout'] as const) {
  test(`signed request ${scenario} respects submission identity; no network`, async () => {
    let id = ''; let requests = 0;
    const result = await executePaidRequest({
      resourceUrl: terms.resource, network: 'testnet', fromAccountId: '0.0.30', privateKey: PrivateKey.generateECDSA().toStringRaw(),
      maxAmount: 100000000n, expectedAmount: 50000000n,
      beforeSubmit: async identity => { id = identity.transactionId; assert.ok(identity.validUntilEpochSeconds > Date.now()/1000); },
      fetchImpl: async () => {
        requests++;
        if (requests === 1) return Response.json({ x402Version: 2, accepts: [terms] }, { status: 402 });
        assert.ok(id);
        if (scenario === 'network-timeout') throw new Error('fixture timeout');
        if (scenario === 'http-402') return Response.json({ settlementCertainty: 'none' }, { status: 402 });
        return Response.json({ payment: { transactionId: scenario === 'matching-receipt' ? id : '0.0.20@1.000000001' }, content: { jobId: 'fixture' } });
      },
    });
    assert.equal(result.status, scenario === 'matching-receipt' ? 'paid' : 'settlement_unknown');
    assert.equal(requests, 2);
  });
}
for (const [name, changed] of [
  ['amount above reservation but below global cap', { amount: '60000000' }],
  ['amount below reservation', { amount: '40000000' }],
  ['wrong network', { network: 'hedera:mainnet' }],
  ['wrong resource', { resource: 'http://other.invalid/data' }],
  ['wrong recipient', { payTo: '0.0.11' }],
  ['wrong asset', { asset: '0.0.12' }],
  ['malformed amount', { amount: 'invalid' }],
  ['negative validity', { maxTimeoutSeconds: -1 }],
] as const) {
  test(`refuses ${name} before signing or pending state`, async () => {
    let requests = 0; let prepared = false;
    const result = await executePaidRequest({
      resourceUrl: terms.resource, network: 'testnet', fromAccountId: '0.0.30', privateKey: 'intentionally-invalid-test-key',
      maxAmount: 100000000n, expectedAmount: 50000000n, expectedPayTo: terms.payTo, expectedAsset: terms.asset,
      beforeSubmit: async () => { prepared = true; },
      fetchImpl: async () => { requests++; return Response.json({ x402Version: 2, accepts: [{ ...terms, ...changed }] }, { status: 402 }); },
    });
    assert.equal(result.status, 'failed'); assert.equal(requests, 1); assert.equal(prepared, false);
    assert.doesNotMatch(JSON.stringify(result), /intentionally-invalid-test-key/);
  });
}

test('provider failure leaves a reservation retryable and releasable; local budget double', async () => {
  const params = { workspaceId: 'w', purchaseKey: 'p', amount: 50000000n, asset: '0.0.0', payTo: terms.payTo, resource: terms.resource };
  let status = ContractStatus.Reserved; let pendingWrites = 0;
  const chain: OnChainOperation = { workspaceId: 'w', purchaseKey: 'p', amount: params.amount, agentId: 'a', status, expiresAt: Math.floor(Date.now()/1000)+300, policyVersion: 1, paramsHash: computeParamsHash(params) };
  const budget = {
    reserve: async () => ({ transactionHash: 'fixture', paramsHash: chain.paramsHash }),
    getOperation: async () => ({ ...chain, status }),
    markPaymentPending: async () => { pendingWrites++; status = ContractStatus.PaymentPending; return 'fixture'; },
    release: async () => { assert.equal(status, ContractStatus.Reserved); status = ContractStatus.Released; return 'fixture'; },
    recordSettlement: async () => 'fixture', flagSettlementUnknown: async () => 'fixture',
    recordDecision: async () => 'fixture', recordDelivery: async () => 'fixture', releaseAfterReconciliation: async () => 'fixture',
  };
  const registry = createMemoryRegistry();
  const adapter = createHederaSpendingAdapter({ budget, resolveResource: () => params, network: 'testnet', treasuryAccountId: '0.0.30', treasuryPrivateKey: 'unused-fixture', mirrorNodeUrl: 'http://mirror.invalid', maxPaymentAmount: 100000000n, fetchImpl: async () => new Response('', { status: 404 }) }, registry);
  const input = { operationId: 'op', workspaceId: 'w', agentId: 'a', purchaseKey: 'p', amount: { amount: '50000000', tokenId: '0.0.0', decimals: 8 } };
  const reservation = await adapter.reserve(input);
  assert.equal(Date.parse(reservation.expiresAt), chain.expiresAt * 1000);
  assert.equal((await adapter.executePayment({ operationId: 'op' })).status, 'failed');
  assert.equal((await adapter.executePayment({ operationId: 'op' })).status, 'failed');
  assert.equal(pendingWrites, 0);
  await adapter.release('op');
  assert.equal(status, ContractStatus.Released);
});

test('equal-price transaction from another operation cannot settle this one', async () => {
  const result = await reconcileSettlement({ mirrorNodeUrl: 'http://mirror.invalid', transactionId: '0.0.20@100.000000001', payTo: '0.0.10', payer: '0.0.30', amount: 50n, validUntilEpochSeconds: 200, notBeforeEpochSeconds: 0,
    fetchImpl: async url => {
      assert.match(String(url), /transactions\/0\.0\.20-100-000000001$/);
      return Response.json({ transactions: [{ transaction_id: '0.0.20-101-000000001', result: 'SUCCESS', consensus_timestamp: '102.0', transfers: [{ account: '0.0.10', amount: 50 }, { account: '0.0.30', amount: -50 }] }] });
    },
  });
  assert.equal(result.status, 'inconclusive');
});

test('legacy operation without signed identity cannot infer absence', async () => {
  let called = false;
  const result = await reconcileSettlement({ mirrorNodeUrl: 'http://mirror.invalid', payTo: '0.0.10', payer: '0.0.30', amount: 50n, validUntilEpochSeconds: 0, notBeforeEpochSeconds: 0, fetchImpl: async () => { called = true; return Response.json({ transactions: [] }); } });
  assert.equal(result.status, 'inconclusive'); assert.equal(called, false);
});
