/**
 * Public surface of the Hedera adapter.
 *
 * Rudra: construct with `createLiveAdapter()` and use the SpendingAdapter methods. You
 * hold no keys in code — the treasury key is read from the environment by this module.
 */
export {
  createHederaSpendingAdapter,
  createMemoryRegistry,
  type HederaAdapterDeps,
  type HederaSpendingAdapter,
  type OperationRegistry,
  type ResourceBinding,
  type ResourceResolver,
} from './adapter.js';

export { BudgetClient, ContractStatus, computeParamsHash, toId } from './contracts/budget-client.js';
export {
  buildNote,
  createDecisionNotePublisher,
  readNote,
  type DecisionNotePublisher,
  type PublishedNote,
} from './hcs/decision-notes.js';
export { reconcileSettlement, type ReconciliationResult } from './reconciliation/mirror-node.js';
export { executePaidRequest, type PaidRequestOutcome } from './payments/x402-client.js';
export { buildSignedTransfer } from './payments/transfer.js';
export { loadAdapterConfig, loadEnvFileIfPresent, type HederaAdapterConfig } from './config.js';

import { createHederaSpendingAdapter, type HederaSpendingAdapter, type ResourceResolver } from './adapter.js';
import { BudgetClient } from './contracts/budget-client.js';
import { createDecisionNotePublisher } from './hcs/decision-notes.js';
import { loadAdapterConfig, loadEnvFileIfPresent } from './config.js';

/**
 * Builds an adapter from the environment. Requires HEDERA_ACCOUNT_ID,
 * HEDERA_PRIVATE_KEY and COMMON_CONTRACT_ADDRESS. See .env.example.
 *
 * `resolveResource` maps a purchase key to the provider that sells it. Without a
 * binding, `reserve` refuses — an operation must always know what it is buying, from
 * whom, and for how much.
 */
export function createLiveAdapter(resolveResource: ResourceResolver): HederaSpendingAdapter {
  loadEnvFileIfPresent();
  const config = loadAdapterConfig();

  // HCS is optional. Without HCS_TOPIC_ID the adapter behaves exactly as it did before
  // decision notes existed: the contract event is still written, and hcsStatus reports
  // 'pending' honestly rather than claiming a note that was never published.
  const notes = config.hcsTopicId
    ? createDecisionNotePublisher({
        network: config.network,
        topicId: config.hcsTopicId,
        accountId: config.treasuryAccountId,
        privateKey: config.treasuryPrivateKey,
      })
    : undefined;

  return createHederaSpendingAdapter({
    budget: new BudgetClient(config.contractAddress, config.jsonRpcUrl, config.operatorPrivateKey),
    resolveResource,
    network: config.network,
    treasuryAccountId: config.treasuryAccountId,
    treasuryPrivateKey: config.treasuryPrivateKey,
    mirrorNodeUrl: config.mirrorNodeUrl,
    maxPaymentAmount: config.maxPaymentAmount,
    ...(notes ? { notes } : {}),
  });
}

/** Convenience resolver for a single provider serving every purchase key. */
export function singleProviderResolver(binding: {
  resource: string;
  payTo: string;
  asset?: string;
}): ResourceResolver {
  return () => ({ resource: binding.resource, payTo: binding.payTo, asset: binding.asset ?? '0.0.0' });
}
