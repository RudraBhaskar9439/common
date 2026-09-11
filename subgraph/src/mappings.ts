import { Bytes } from '@graphprotocol/graph-ts';
import {
  AgentAuthorized,
  DecisionRecorded,
  DeliveryRecorded,
  PaymentPending,
  PaymentSettled,
  PurchaseReserved,
  ReservationReleased,
  SettlementUnknownFlagged,
  WorkspaceCreated,
  WorkspaceFunded,
} from '../generated/CommonBudget/CommonBudget';
import {
  AgentAuthorization,
  Decision,
  Purchase,
  SettlementTransfer,
} from '../generated/schema';
import {
  authorizationId,
  canonicalTransactionId,
  decisionTypeOf,
  emptyToNull,
  isPlaceholderSettlement,
  loadOrCreateAssetSpend,
  loadOrCreateWorkspace,
  RELEASE_EXPIRED,
  STATUS_DELIVERED,
  STATUS_DELIVERY_FAILED,
  STATUS_EXPIRED,
  STATUS_PAID,
  STATUS_PAYMENT_PENDING,
  STATUS_RELEASED,
  STATUS_RESERVED,
  STATUS_SETTLEMENT_UNKNOWN,
  ZERO_BYTES32,
} from './lib';

// ------------------------------------------------------------------ workspace

export function handleWorkspaceCreated(event: WorkspaceCreated): void {
  const workspace = loadOrCreateWorkspace(event.params.workspaceId, event);
  workspace.operator = event.params.operator;
  workspace.createdAt = event.block.timestamp;
  workspace.createdAtBlock = event.block.number;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}

export function handleWorkspaceFunded(event: WorkspaceFunded): void {
  const workspace = loadOrCreateWorkspace(event.params.workspaceId, event);
  // The event carries the resulting cumulative budget, so take it rather than adding.
  workspace.budget = event.params.budget;
  workspace.policyVersion = event.params.policyVersion;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}

export function handleAgentAuthorized(event: AgentAuthorized): void {
  const workspace = loadOrCreateWorkspace(event.params.workspaceId, event);
  workspace.policyVersion = event.params.policyVersion;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();

  const id = authorizationId(event.params.workspaceId, event.params.agentId);
  let authorization = AgentAuthorization.load(id);
  if (authorization == null) authorization = new AgentAuthorization(id);
  authorization.workspace = event.params.workspaceId;
  authorization.agentId = event.params.agentId;
  // Authorization is revocable, so the latest event wins rather than the first.
  authorization.authorized = event.params.authorized;
  authorization.policyVersion = event.params.policyVersion;
  authorization.updatedAt = event.block.timestamp;
  authorization.updatedAtBlock = event.block.number;
  authorization.save();
}

// ------------------------------------------------------------------- purchase

export function handlePurchaseReserved(event: PurchaseReserved): void {
  const workspace = loadOrCreateWorkspace(event.params.workspaceId, event);
  workspace.policyVersion = event.params.policyVersion;
  workspace.reservedCount = workspace.reservedCount + 1;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();

  // Keyed by operationId, so a replayed log updates this row instead of creating a
  // second one. De-duplication is structural, not a check that can be forgotten.
  let purchase = Purchase.load(event.params.operationId);
  if (purchase == null) purchase = new Purchase(event.params.operationId);

  purchase.workspace = event.params.workspaceId;
  purchase.purchaseKey = event.params.purchaseKey;
  purchase.agentId = event.params.agentId;
  purchase.amount = event.params.amount;
  purchase.asset = event.params.asset;
  purchase.payTo = event.params.payTo;
  purchase.resource = event.params.resource;
  purchase.expiresAt = event.params.expiresAt;
  purchase.policyVersion = event.params.policyVersion;
  purchase.status = STATUS_RESERVED;
  purchase.reservedAt = event.block.timestamp;
  purchase.reservedAtBlock = event.block.number;
  purchase.reservedTxHash = event.transaction.hash;
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();
}

/**
 * Lifecycle events carry only operationId. A missing Purchase means the reservation is
 * outside the indexed range, which is a start-block problem — recorded in the log rather
 * than papered over with a synthetic row that would have no workspace.
 */
function loadPurchaseForLifecycle(operationId: Bytes): Purchase | null {
  return Purchase.load(operationId);
}

export function handlePaymentPending(event: PaymentPending): void {
  const purchase = loadPurchaseForLifecycle(event.params.operationId);
  if (purchase == null) return;
  purchase.status = STATUS_PAYMENT_PENDING;
  purchase.paymentPendingAt = event.block.timestamp;
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();
}

export function handleSettlementUnknownFlagged(event: SettlementUnknownFlagged): void {
  const purchase = loadPurchaseForLifecycle(event.params.operationId);
  if (purchase == null) return;
  purchase.status = STATUS_SETTLEMENT_UNKNOWN;
  // Kept for the life of the row, including after reconciliation resolves it, so
  // "was this ever uncertain?" stays answerable.
  purchase.settlementUnknownAt = event.block.timestamp;
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();

  const workspace = loadOrCreateWorkspace(purchase.workspace, event);
  workspace.settlementUnknownCount = workspace.settlementUnknownCount + 1;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}

export function handlePaymentSettled(event: PaymentSettled): void {
  const purchase = loadPurchaseForLifecycle(event.params.operationId);
  if (purchase == null) return;

  const raw = event.params.transactionId;
  const canonical = canonicalTransactionId(raw);
  const placeholder = isPlaceholderSettlement(raw);

  purchase.status = STATUS_PAID;
  purchase.transactionId = raw;
  purchase.settledAt = event.params.settledAt;
  purchase.settlement = canonical;
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();

  // One row per logical transfer. Two renderings of the same id collapse here.
  let transfer = SettlementTransfer.load(canonical);
  let firstInWorkspace = true;
  if (transfer == null) {
    transfer = new SettlementTransfer(canonical);
    transfer.rawTransactionIds = [raw];
    transfer.occurrences = 1;
    transfer.workspaces = [purchase.workspace];
    transfer.amount = event.params.amount;
    transfer.asset = purchase.asset;
    transfer.isPlaceholder = placeholder;
    transfer.firstSeenAt = event.block.timestamp;
    transfer.firstSeenAtBlock = event.block.number;
  } else {
    transfer.occurrences = transfer.occurrences + 1;

    const renderings = transfer.rawTransactionIds;
    if (!renderings.includes(raw)) {
      renderings.push(raw);
      transfer.rawTransactionIds = renderings;
    }

    const workspaces = transfer.workspaces;
    if (workspaces.includes(purchase.workspace)) {
      firstInWorkspace = false;
    } else {
      workspaces.push(purchase.workspace);
      transfer.workspaces = workspaces;
    }
  }
  transfer.save();

  const workspace = loadOrCreateWorkspace(purchase.workspace, event);
  workspace.settledCount = workspace.settledCount + 1;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();

  const spend = loadOrCreateAssetSpend(purchase.workspace, purchase.asset);
  // Raw totals always advance, so the index can be reconciled against the event log.
  spend.rawSettledAmount = spend.rawSettledAmount.plus(event.params.amount);
  spend.rawSettledPayments = spend.rawSettledPayments + 1;
  // Reported spend counts distinct real transfers once. A placeholder moved no money.
  if (!placeholder && firstInWorkspace) {
    spend.settledAmount = spend.settledAmount.plus(event.params.amount);
    spend.settledPayments = spend.settledPayments + 1;
  }
  spend.save();
}

export function handleDeliveryRecorded(event: DeliveryRecorded): void {
  const purchase = loadPurchaseForLifecycle(event.params.operationId);
  if (purchase == null) return;

  const usable = event.params.usable;
  purchase.status = usable ? STATUS_DELIVERED : STATUS_DELIVERY_FAILED;
  purchase.usable = usable;
  purchase.freshUntil = event.params.freshUntil;
  // An unusable delivery carries an empty resultRef. Absent, not an empty reference.
  purchase.resultRef = emptyToNull(event.params.resultRef);
  purchase.failureReason = emptyToNull(event.params.failureReason);
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();

  const workspace = loadOrCreateWorkspace(purchase.workspace, event);
  if (usable) {
    workspace.deliveredUsableCount = workspace.deliveredUsableCount + 1;
  } else {
    // Delivery failed. The payment stands, the claim stands, no refund, no repurchase.
    workspace.deliveryFailureCount = workspace.deliveryFailureCount + 1;
  }
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}

export function handleReservationReleased(event: ReservationReleased): void {
  const purchase = loadPurchaseForLifecycle(event.params.operationId);
  if (purchase == null) return;

  const reason = event.params.reason;
  // The contract sets Expired only for the expiry reason; explicit and
  // reconciled-absent both land on Released.
  purchase.status = reason == RELEASE_EXPIRED ? STATUS_EXPIRED : STATUS_RELEASED;
  purchase.releaseReason = reason;
  purchase.releasedAt = event.block.timestamp;
  purchase.lastUpdatedAt = event.block.timestamp;
  purchase.lastUpdatedAtBlock = event.block.number;
  purchase.save();

  const workspace = loadOrCreateWorkspace(purchase.workspace, event);
  if (reason == RELEASE_EXPIRED) {
    workspace.expiredCount = workspace.expiredCount + 1;
  } else {
    workspace.releasedCount = workspace.releasedCount + 1;
  }
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}

// ------------------------------------------------------------------- decision

export function handleDecisionRecorded(event: DecisionRecorded): void {
  const workspace = loadOrCreateWorkspace(event.params.workspaceId, event);

  const existing = Decision.load(event.params.decisionId);
  if (existing != null) {
    // `recordDecision` writes no state and has no guard, so the same decisionId can be
    // re-emitted with a different payload. First write wins; a later contradictory
    // emission is made visible rather than silently overwriting the audit trail.
    existing.reEmissionCount = existing.reEmissionCount + 1;
    existing.save();
    return;
  }

  const decision = new Decision(event.params.decisionId);
  decision.workspace = event.params.workspaceId;
  decision.agentId = event.params.agentId;
  decision.decisionType = decisionTypeOf(event.params.decisionType);
  decision.operationId = event.params.operationId;

  // Reuse and wait decisions need not reference an operation.
  if (event.params.operationId != ZERO_BYTES32) {
    const referenced = Purchase.load(event.params.operationId);
    if (referenced != null) decision.purchase = event.params.operationId;
  }

  // Decisions written before HCS existed carry "". Not a data error; absent rationale.
  const sequence = emptyToNull(event.params.hcsSequenceNumber);
  decision.hcsSequenceNumber = sequence;
  decision.rationaleAvailable = sequence != null;

  decision.recordedAt = event.block.timestamp;
  decision.recordedAtBlock = event.block.number;
  decision.logIndex = event.logIndex;
  decision.txHash = event.transaction.hash;
  decision.reEmissionCount = 0;
  decision.save();

  const kind = decision.decisionType;
  if (kind == 'REUSE') {
    workspace.reuseDecisionCount = workspace.reuseDecisionCount + 1;
  } else if (kind == 'BUY') {
    workspace.buyDecisionCount = workspace.buyDecisionCount + 1;
  } else if (kind == 'WAIT') {
    workspace.waitDecisionCount = workspace.waitDecisionCount + 1;
  } else {
    workspace.rejectDecisionCount = workspace.rejectDecisionCount + 1;
  }
  workspace.decisionCount = workspace.decisionCount + 1;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.save();
}
