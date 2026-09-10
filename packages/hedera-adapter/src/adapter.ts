/**
 * SpendingAdapter over the deployed CommonBudget contract and the x402 payment path.
 *
 * The safety rules this enforces, in one place:
 *  - An agent never holds a key. It calls these five methods; this module signs.
 *  - A payment is only signed against an active reservation whose bound parameters
 *    match the transfer exactly.
 *  - Uncertainty is recorded on-chain as SettlementUnknown, which blocks release and
 *    re-payment until reconciliation resolves it.
 *  - `release` is refused while settlement is unknown — the contract enforces this too,
 *    so a bug here cannot cause a double spend on its own.
 */
import { CommonError } from '@common/interfaces';
import type {
  DecisionReceipt,
  DecisionRecord,
  Money,
  Operation,
  OperationStatus,
  PaymentReceipt,
  PaymentResult,
  Reservation,
  ReserveInput,
  SpendingAdapter,
} from '@common/interfaces';
import { BudgetClient, ContractStatus, computeParamsHash, type BoundParameters } from './contracts/budget-client.js';
import { executePaidRequest } from './payments/x402-client.js';
import { reconcileSettlement } from './reconciliation/mirror-node.js';
import type { DecisionNotePublisher, PublishedNote } from './hcs/decision-notes.js';

/** Where a purchase key can actually be bought, and who gets paid. */
export interface ResourceBinding {
  resource: string;
  payTo: string;
  asset: string;
}

export type ResourceResolver = (purchaseKey: string) => ResourceBinding | undefined;

export interface HederaAdapterDeps {
  budget: BudgetClient;
  resolveResource: ResourceResolver;
  network: 'testnet' | 'mainnet' | 'previewnet';
  treasuryAccountId: string;
  treasuryPrivateKey: string;
  mirrorNodeUrl: string;
  maxPaymentAmount: bigint;
  reservationTtlSeconds?: number;
  /**
   * Optional. Without it, decisions still record their contract event and report
   * `hcsStatus: 'pending'` — exactly the behaviour before HCS existed, so nothing
   * downstream breaks when no topic is configured.
   */
  notes?: DecisionNotePublisher;
}

const STATUS_MAP: Record<ContractStatus, OperationStatus> = {
  [ContractStatus.None]: 'released',
  [ContractStatus.Reserved]: 'reserved',
  [ContractStatus.PaymentPending]: 'payment_pending',
  [ContractStatus.SettlementUnknown]: 'settlement_unknown',
  [ContractStatus.Paid]: 'paid',
  [ContractStatus.Delivered]: 'delivered',
  [ContractStatus.DeliveryFailed]: 'delivery_failed',
  [ContractStatus.Released]: 'released',
  [ContractStatus.Expired]: 'expired',
};

/**
 * Remembers the string identifiers and bound parameters behind each operation, because
 * the contract stores one-way hashes. This is a cache, never the source of authority:
 * status and amounts are always read from the contract.
 *
 * Durable ownership of this state is Rudra's call — pass a persisted implementation to
 * survive restarts. In memory, a restart loses the binding and executePayment for an
 * in-flight operation must be re-driven with its original input.
 */
export interface RememberedOperation extends BoundParameters {
  agentId: string;
  /** Unix seconds when the reservation was created. Bounds reconciliation. */
  reservedAt: number;
  /** Unix seconds after which an absent transfer is conclusive. */
  expiresAt: number;
}

export interface OperationRegistry {
  remember(operationId: string, params: RememberedOperation): void;
  recall(operationId: string): RememberedOperation | undefined;
}

export function createMemoryRegistry(): OperationRegistry {
  const rows = new Map<string, RememberedOperation>();
  return {
    remember(operationId, params) {
      rows.set(operationId, params);
    },
    recall(operationId) {
      return rows.get(operationId);
    },
  };
}

export interface HederaSpendingAdapter extends SpendingAdapter {
  /** Payment and delivery are separate outcomes; this records the second. */
  recordDelivery(input: {
    operationId: string;
    usable: boolean;
    freshUntil: Date;
    resultRef: string;
    failureReason?: string;
  }): Promise<void>;
  /** The only way out of settlement_unknown. Safe to call repeatedly. */
  reconcile(operationId: string): Promise<Operation>;
  /**
   * Republishes decision notes whose HCS write failed. Publishes only — it cannot reach
   * payment execution, so it can never replay a payment. Safe to call on a timer.
   */
  retryDecisionNotes(): Promise<PublishedNote[]>;
}

export function createHederaSpendingAdapter(
  deps: HederaAdapterDeps,
  registry: OperationRegistry = createMemoryRegistry(),
): HederaSpendingAdapter {
  const ttl = deps.reservationTtlSeconds ?? 3600;

  const moneyOf = (amount: bigint, asset: string): Money => ({
    amount: amount.toString(),
    tokenId: asset,
    decimals: asset === '0.0.0' ? 8 : 0,
  });

  async function readOperation(operationId: string): Promise<Operation> {
    const onChain = await deps.budget.getOperation(operationId);
    const remembered = registry.recall(operationId);
    return {
      operationId,
      workspaceId: remembered?.workspaceId ?? onChain.workspaceId,
      purchaseKey: remembered?.purchaseKey ?? onChain.purchaseKey,
      status: STATUS_MAP[onChain.status],
      amount: moneyOf(onChain.amount, remembered?.asset ?? '0.0.0'),
    };
  }

  return {
    async reserve(input: ReserveInput): Promise<Reservation> {
      const binding = deps.resolveResource(input.purchaseKey);
      if (!binding) {
        throw new CommonError('NOT_FOUND', `No provider is bound to purchase key ${input.purchaseKey}`);
      }

      const amount = BigInt(input.amount.amount);
      if (amount > deps.maxPaymentAmount) {
        throw new CommonError('INSUFFICIENT_BUDGET', `Amount ${amount} exceeds the per-operation ceiling`);
      }

      const params: BoundParameters = {
        workspaceId: input.workspaceId,
        purchaseKey: input.purchaseKey,
        amount,
        asset: binding.asset,
        payTo: binding.payTo,
        resource: binding.resource,
      };

      await deps.budget.reserve({
        operationId: input.operationId,
        agentId: input.agentId,
        ttlSeconds: ttl,
        params,
      });

      const reservedAt = Math.floor(Date.now() / 1000);
      const expiresAt = reservedAt + ttl;
      registry.remember(input.operationId, { ...params, agentId: input.agentId, reservedAt, expiresAt });

      return {
        operationId: input.operationId,
        workspaceId: input.workspaceId,
        purchaseKey: input.purchaseKey,
        status: 'reserved',
        amount: input.amount,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      };
    },

    async executePayment({ operationId }): Promise<PaymentResult> {
      const bound = registry.recall(operationId);
      if (!bound) {
        throw new CommonError(
          'NOT_FOUND',
          `No bound parameters for ${operationId}. After a restart, re-drive the operation with its original input.`,
        );
      }

      const onChain = await deps.budget.getOperation(operationId);

      // Refuse to pay unless the chain still says this reservation is live and its
      // bound parameters are byte-identical to what we are about to sign.
      if (onChain.status !== ContractStatus.Reserved) {
        if (onChain.status === ContractStatus.SettlementUnknown) {
          return { status: 'settlement_unknown', operationId };
        }
        throw new CommonError('UNAUTHORIZED', `Operation is ${ContractStatus[onChain.status]}, not reserved`);
      }
      if (onChain.paramsHash !== computeParamsHash(bound)) {
        throw new CommonError('UNAUTHORIZED', 'Bound parameters do not match the on-chain reservation');
      }

      await deps.budget.markPaymentPending(operationId);

      const outcome = await executePaidRequest({
        resourceUrl: bound.resource,
        network: deps.network,
        fromAccountId: deps.treasuryAccountId,
        privateKey: deps.treasuryPrivateKey,
        maxAmount: deps.maxPaymentAmount,
        expectedPayTo: bound.payTo,
        expectedAsset: bound.asset,
      });

      if (outcome.status === 'paid') {
        await deps.budget.recordSettlement(operationId, outcome.transactionId, bound.amount);
        const receipt: PaymentReceipt = {
          operationId,
          transactionId: outcome.transactionId,
          amount: moneyOf(bound.amount, bound.asset),
        };
        return { status: 'paid', receipt };
      }

      if (outcome.status === 'settlement_unknown') {
        // Record uncertainty on-chain BEFORE returning, so a crash here still leaves the
        // operation blocked rather than releasable.
        await deps.budget.flagSettlementUnknown(operationId);
        return { status: 'settlement_unknown', operationId };
      }

      // Verified failure: nothing was submitted. The reservation stays live so the
      // caller may retry with the same operation id, or release it explicitly.
      return { status: 'failed', operationId, reason: outcome.reason };
    },

    getOperation: readOperation,

    async release(operationId: string): Promise<void> {
      // Pre-check for a readable error. Hedera's JSON-RPC relay does not return decodable
      // custom-error data, so a contract revert here would surface as an unhelpful
      // "unknown custom error". The contract still enforces the rule — this only makes
      // the refusal legible, and a stale read cannot weaken it.
      const onChain = await deps.budget.getOperation(operationId);
      if (onChain.status === ContractStatus.SettlementUnknown) {
        throw new CommonError(
          'SETTLEMENT_UNKNOWN',
          'Settlement is unknown; reconcile before releasing. The transfer may exist.',
        );
      }
      await deps.budget.release(operationId);
    },

    async recordDecision(input: DecisionRecord): Promise<DecisionReceipt> {
      const types: Record<DecisionRecord['type'], number> = { buy: 0, reuse: 1, wait: 2, reject: 3 };

      // HCS FIRST, then the event carrying its sequence number.
      //
      // The two writes are not atomic, so the order decides which failure is survivable.
      // This way a contract failure orphans a published note, which is harmless. The
      // reverse would emit an event with an empty sequence number and permanently break
      // the link unless a second event patched it.
      //
      // If publication fails the event is still written with an empty sequence number and
      // the note is queued. `retryDecisionNotes()` republishes it. That retry touches no
      // payment code, by construction.
      let hcsSequenceNumber = '';
      let hcsStatus: DecisionReceipt['hcsStatus'] = 'pending';

      if (deps.notes) {
        try {
          const published = await deps.notes.publish(input);
          hcsSequenceNumber = published.sequenceNumber;
          hcsStatus = 'confirmed';
        } catch {
          deps.notes.queue(input);
        }
      }

      const eventTransactionId = await deps.budget.recordDecision({
        workspaceId: input.workspaceId,
        decisionId: input.decisionId,
        agentId: input.agentId,
        decisionType: types[input.type],
        operationId: input.operationId ?? '',
        hcsSequenceNumber,
      });

      const receipt: DecisionReceipt = {
        decisionId: input.decisionId,
        hcsStatus,
        eventStatus: 'confirmed',
        eventTransactionId,
      };
      if (hcsSequenceNumber) receipt.hcsSequenceNumber = hcsSequenceNumber;
      return receipt;
    },

    async retryDecisionNotes() {
      // Publishes queued notes and nothing else. This function has no access to payment
      // execution, so an HCS retry cannot replay a payment even if called in a loop.
      if (!deps.notes) return [];
      return deps.notes.retryPending();
    },

    async recordDelivery(input): Promise<void> {
      await deps.budget.recordDelivery(
        input.operationId,
        input.usable,
        Math.floor(input.freshUntil.getTime() / 1000),
        input.resultRef,
        input.failureReason ?? '',
      );
    },

    async reconcile(operationId: string): Promise<Operation> {
      const bound = registry.recall(operationId);
      const onChain = await deps.budget.getOperation(operationId);

      if (onChain.status !== ContractStatus.SettlementUnknown) return readOperation(operationId);
      if (!bound) throw new CommonError('NOT_FOUND', `No bound parameters for ${operationId}; cannot reconcile`);

      const result = await reconcileSettlement({
        mirrorNodeUrl: deps.mirrorNodeUrl,
        payTo: bound.payTo,
        payer: deps.treasuryAccountId,
        amount: bound.amount,
        validUntilEpochSeconds: bound.expiresAt,
        // Without this bound, an identical transfer from an EARLIER operation would be
        // adopted as this one's payment, marking a stuck operation paid when it was not.
        notBeforeEpochSeconds: bound.reservedAt,
      });

      if (result.status === 'found') {
        await deps.budget.recordSettlement(operationId, result.transactionId, bound.amount);
      } else if (result.status === 'absent') {
        await deps.budget.releaseAfterReconciliation(operationId);
      }
      // 'inconclusive': stay stuck. This is correct, not a failure.

      return readOperation(operationId);
    },
  };
}
