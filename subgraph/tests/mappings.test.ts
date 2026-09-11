import { BigInt } from '@graphprotocol/graph-ts';
import { afterEach, assert, describe, test, clearStore } from 'matchstick-as/assembly/index';
import {
  handleAgentAuthorized,
  handleDecisionRecorded,
  handleDeliveryRecorded,
  handlePaymentPending,
  handlePaymentSettled,
  handlePurchaseReserved,
  handleReservationReleased,
  handleSettlementUnknownFlagged,
  handleWorkspaceCreated,
  handleWorkspaceFunded,
} from '../src/mappings';
import { canonicalTransactionId, emptyToNull, isPlaceholderSettlement } from '../src/lib';
import {
  agentAuthorized, decisionRecorded, deliveryRecorded, HBAR, id32, paymentPending,
  paymentSettled, PRICE, purchaseReserved, reservationReleased, settlementUnknown,
  workspaceCreated, workspaceFunded, ZERO_ID,
} from './helpers';

const WS = 'demo-workspace-1';
const OP = 'op-a-1';
const KEY = 'thegraph:uniswap-v3:pools:top10:block-21000000:demo-workspace-1';
const REAL_TX = '0.0.7162784@1789069246.329605799';
const MIRROR_TX = '0.0.7162784-1789069246-329605799';
const SEED_TX = 'SEED-PLACEHOLDER-not-a-real-payment';
const BUDGET = BigInt.fromString('500000000');

function fundedWorkspace(label: string): void {
  handleWorkspaceCreated(workspaceCreated(label, 1000, 100));
  handleWorkspaceFunded(workspaceFunded(label, BUDGET, BUDGET, 2, 1001, 101));
  handleAgentAuthorized(agentAuthorized(label, 'agent-a', true, 3, 1002, 102));
}

function reserveAndSettle(label: string, op: string, key: string, tx: string): void {
  handlePurchaseReserved(purchaseReserved(label, op, key, 'agent-a', PRICE, HBAR, 99000, 1003, 103));
  handlePaymentPending(paymentPending(op, 1004, 104));
  handlePaymentSettled(paymentSettled(op, tx, PRICE, 1005, 1005, 105));
}

describe('pure helpers', () => {
  test('canonicalises the mirror-node rendering of a transaction id', () => {
    assert.stringEquals(REAL_TX, canonicalTransactionId(MIRROR_TX));
    assert.stringEquals(REAL_TX, canonicalTransactionId(REAL_TX));
  });

  test('leaves anything that is not a transaction id alone', () => {
    assert.stringEquals(SEED_TX, canonicalTransactionId(SEED_TX));
    assert.stringEquals('a-b-c', canonicalTransactionId('a-b-c'));
    assert.assertTrue(isPlaceholderSettlement(SEED_TX));
    assert.assertTrue(!isPlaceholderSettlement(REAL_TX));
  });

  test('treats an empty string as absent', () => {
    assert.assertTrue(emptyToNull('') == null);
    assert.stringEquals('1', emptyToNull('1')!);
  });
});

describe('workspace', () => {
  afterEach(() => { clearStore(); });

  test('records creation, funding and authorization', () => {
    fundedWorkspace(WS);
    const id = id32(WS).toHexString();
    assert.entityCount('Workspace', 1);
    assert.fieldEquals('Workspace', id, 'budget', '500000000');
    assert.fieldEquals('Workspace', id, 'policyVersion', '3');
    assert.entityCount('AgentAuthorization', 1);
    assert.fieldEquals(
      'AgentAuthorization', id + '-' + id32('agent-a').toHexString(), 'authorized', 'true',
    );
  });

  test('a workspace created but never funded has zero budget, not a missing row', () => {
    handleWorkspaceCreated(workspaceCreated('empty-workspace', 1000, 100));
    assert.fieldEquals('Workspace', id32('empty-workspace').toHexString(), 'budget', '0');
    assert.fieldEquals('Workspace', id32('empty-workspace').toHexString(), 'reservedCount', '0');
    assert.entityCount('Purchase', 0);
  });

  test('revoking authorization overwrites rather than appending', () => {
    fundedWorkspace(WS);
    handleAgentAuthorized(agentAuthorized(WS, 'agent-a', false, 4, 1010, 110));
    assert.entityCount('AgentAuthorization', 1);
    assert.fieldEquals(
      'AgentAuthorization',
      id32(WS).toHexString() + '-' + id32('agent-a').toHexString(),
      'authorized', 'false',
    );
  });
});

describe('the reuse path', () => {
  afterEach(() => { clearStore(); });

  test('reserve, settle, deliver usable, then a linked reuse decision', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, OP, KEY, REAL_TX);
    handleDeliveryRecorded(deliveryRecorded(OP, true, 99999, 'result-1', '', 1006, 106));
    handleDecisionRecorded(
      decisionRecorded(WS, 'decision-b-1', 'agent-b', 1, id32(OP), '2', 1007, 107),
    );

    const op = id32(OP).toHexString();
    const ws = id32(WS).toHexString();
    assert.fieldEquals('Purchase', op, 'status', 'DELIVERED');
    assert.fieldEquals('Purchase', op, 'usable', 'true');
    assert.fieldEquals('Purchase', op, 'resultRef', 'result-1');
    assert.fieldEquals('Purchase', op, 'freshUntil', '99999');
    assert.fieldEquals('Purchase', op, 'transactionId', REAL_TX);
    assert.fieldEquals('Purchase', op, 'settlement', REAL_TX);
    assert.fieldEquals('Purchase', op, 'purchaseKey', id32(KEY).toHexString());

    assert.fieldEquals('Workspace', ws, 'deliveredUsableCount', '1');
    assert.fieldEquals('Workspace', ws, 'deliveryFailureCount', '0');
    assert.fieldEquals('Workspace', ws, 'reuseDecisionCount', '1');

    const decision = id32('decision-b-1').toHexString();
    assert.fieldEquals('Decision', decision, 'decisionType', 'REUSE');
    assert.fieldEquals('Decision', decision, 'purchase', op);
    assert.fieldEquals('Decision', decision, 'hcsSequenceNumber', '2');
    assert.fieldEquals('Decision', decision, 'rationaleAvailable', 'true');
    assert.fieldEquals('Decision', decision, 'reEmissionCount', '0');

    assert.fieldEquals('WorkspaceAssetSpend', ws + '-' + HBAR, 'settledAmount', '50000000');
    assert.fieldEquals('WorkspaceAssetSpend', ws + '-' + HBAR, 'settledPayments', '1');
  });

  test('an unusable delivery records the failure without a result reference', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, OP, KEY, REAL_TX);
    handleDeliveryRecorded(
      deliveryRecorded(OP, false, 1006, '', 'provider returned a corrupt payload', 1006, 106),
    );

    const op = id32(OP).toHexString();
    assert.fieldEquals('Purchase', op, 'status', 'DELIVERY_FAILED');
    assert.fieldEquals('Purchase', op, 'usable', 'false');
    assert.fieldEquals('Purchase', op, 'failureReason', 'provider returned a corrupt payload');
    // The payment stands: a delivery failure does not refund or free the claim.
    assert.fieldEquals('WorkspaceAssetSpend', id32(WS).toHexString() + '-' + HBAR, 'settledAmount', '50000000');
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'deliveryFailureCount', '1');
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'deliveredUsableCount', '0');
  });
});

describe('settlement uncertainty', () => {
  afterEach(() => { clearStore(); });

  test('unknown settlement resolved by reconciliation stays visibly once-uncertain', () => {
    fundedWorkspace(WS);
    handlePurchaseReserved(purchaseReserved(WS, OP, KEY, 'agent-a', PRICE, HBAR, 99000, 1003, 103));
    handlePaymentPending(paymentPending(OP, 1004, 104));
    handleSettlementUnknownFlagged(settlementUnknown(OP, 1005, 105));

    const op = id32(OP).toHexString();
    assert.fieldEquals('Purchase', op, 'status', 'SETTLEMENT_UNKNOWN');
    assert.fieldEquals('Purchase', op, 'settlementUnknownAt', '1005');

    handlePaymentSettled(paymentSettled(OP, REAL_TX, PRICE, 1010, 1010, 110));
    assert.fieldEquals('Purchase', op, 'status', 'PAID');
    // Retained after reconciliation, so "was this ever uncertain?" stays answerable.
    assert.fieldEquals('Purchase', op, 'settlementUnknownAt', '1005');
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'settlementUnknownCount', '1');
  });

  test('all three release reasons map to the right terminal status', () => {
    fundedWorkspace(WS);
    handlePurchaseReserved(purchaseReserved(WS, 'op-x', 'k-x', 'agent-a', PRICE, HBAR, 9, 1003, 103));
    handlePurchaseReserved(purchaseReserved(WS, 'op-y', 'k-y', 'agent-a', PRICE, HBAR, 9, 1003, 103));
    handlePurchaseReserved(purchaseReserved(WS, 'op-z', 'k-z', 'agent-a', PRICE, HBAR, 9, 1003, 103));

    handleReservationReleased(reservationReleased('op-x', 0, 1004, 104));
    handleReservationReleased(reservationReleased('op-y', 1, 1004, 104));
    handleReservationReleased(reservationReleased('op-z', 2, 1004, 104));

    assert.fieldEquals('Purchase', id32('op-x').toHexString(), 'status', 'RELEASED');
    assert.fieldEquals('Purchase', id32('op-y').toHexString(), 'status', 'EXPIRED');
    assert.fieldEquals('Purchase', id32('op-z').toHexString(), 'status', 'RELEASED');
    assert.fieldEquals('Purchase', id32('op-z').toHexString(), 'releaseReason', '2');

    const ws = id32(WS).toHexString();
    assert.fieldEquals('Workspace', ws, 'releasedCount', '2');
    assert.fieldEquals('Workspace', ws, 'expiredCount', '1');
  });
});

describe('de-duplication', () => {
  afterEach(() => { clearStore(); });

  test('one transfer in two renderings is one SettlementTransfer, and spend is not doubled', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, 'op-1', 'k-1', REAL_TX);
    // The same real transfer, recorded against a second operation in the mirror-node form.
    handlePurchaseReserved(purchaseReserved(WS, 'op-2', 'k-2', 'agent-a', PRICE, HBAR, 99000, 1006, 106));
    handlePaymentPending(paymentPending('op-2', 1007, 107));
    handlePaymentSettled(paymentSettled('op-2', MIRROR_TX, PRICE, 1008, 1008, 108));

    assert.entityCount('SettlementTransfer', 1);
    assert.fieldEquals('SettlementTransfer', REAL_TX, 'occurrences', '2');

    const spend = id32(WS).toHexString() + '-' + HBAR;
    // Reported spend counts the transfer once.
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'settledAmount', '50000000');
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'settledPayments', '1');
    // Raw totals still reconcile against the event log.
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'rawSettledAmount', '100000000');
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'rawSettledPayments', '2');
  });

  test('the same transfer in two workspaces counts once in each', () => {
    fundedWorkspace('ws-one');
    fundedWorkspace('ws-two');
    reserveAndSettle('ws-one', 'op-1', 'k-1', REAL_TX);
    reserveAndSettle('ws-two', 'op-2', 'k-2', MIRROR_TX);

    assert.entityCount('SettlementTransfer', 1);
    assert.fieldEquals('SettlementTransfer', REAL_TX, 'occurrences', '2');
    assert.fieldEquals('WorkspaceAssetSpend', id32('ws-one').toHexString() + '-' + HBAR, 'settledAmount', '50000000');
    assert.fieldEquals('WorkspaceAssetSpend', id32('ws-two').toHexString() + '-' + HBAR, 'settledAmount', '50000000');
  });

  test('a placeholder settlement is never counted as spend', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, OP, KEY, SEED_TX);

    assert.fieldEquals('SettlementTransfer', SEED_TX, 'isPlaceholder', 'true');
    const spend = id32(WS).toHexString() + '-' + HBAR;
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'settledAmount', '0');
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'settledPayments', '0');
    // Still reconcilable against the raw event log.
    assert.fieldEquals('WorkspaceAssetSpend', spend, 'rawSettledAmount', '50000000');
  });

  test('a re-emitted decisionId keeps the first write and counts the re-emission', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, OP, KEY, REAL_TX);
    handleDecisionRecorded(decisionRecorded(WS, 'decision-1', 'agent-b', 1, id32(OP), '2', 1007, 107));
    // Same id, contradictory payload: a reject with no rationale.
    handleDecisionRecorded(decisionRecorded(WS, 'decision-1', 'agent-b', 3, ZERO_ID, '', 1008, 108));

    const decision = id32('decision-1').toHexString();
    assert.entityCount('Decision', 1);
    assert.fieldEquals('Decision', decision, 'decisionType', 'REUSE');
    assert.fieldEquals('Decision', decision, 'hcsSequenceNumber', '2');
    assert.fieldEquals('Decision', decision, 'reEmissionCount', '1');
    // The counter follows the stored decision, not the re-emission.
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'reuseDecisionCount', '1');
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'rejectDecisionCount', '0');
  });

  test('replaying PurchaseReserved updates one row rather than creating a second', () => {
    fundedWorkspace(WS);
    handlePurchaseReserved(purchaseReserved(WS, OP, KEY, 'agent-a', PRICE, HBAR, 99000, 1003, 103));
    handlePurchaseReserved(purchaseReserved(WS, OP, KEY, 'agent-a', PRICE, HBAR, 99000, 1003, 103));
    assert.entityCount('Purchase', 1);
  });
});

describe('missing and malformed data', () => {
  afterEach(() => { clearStore(); });

  test('a decision predating HCS reports rationale as unavailable', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, OP, KEY, REAL_TX);
    handleDecisionRecorded(decisionRecorded(WS, 'decision-old', 'agent-b', 1, id32(OP), '', 1007, 107));

    const decision = id32('decision-old').toHexString();
    assert.fieldEquals('Decision', decision, 'rationaleAvailable', 'false');
    assert.assertNull(null);
  });

  test('a decision with the zero operationId links no purchase', () => {
    fundedWorkspace(WS);
    handleDecisionRecorded(decisionRecorded(WS, 'decision-wait', 'agent-b', 2, ZERO_ID, '', 1007, 107));
    assert.fieldEquals('Decision', id32('decision-wait').toHexString(), 'decisionType', 'WAIT');
    assert.fieldEquals('Workspace', id32(WS).toHexString(), 'waitDecisionCount', '1');
  });

  test('a lifecycle event with no indexed reservation creates nothing', () => {
    handlePaymentSettled(paymentSettled('orphan-op', REAL_TX, PRICE, 1005, 1005, 105));
    handleDeliveryRecorded(deliveryRecorded('orphan-op', true, 9, 'r', '', 1006, 106));
    handleReservationReleased(reservationReleased('orphan-op', 0, 1007, 107));
    assert.entityCount('Purchase', 0);
    assert.entityCount('SettlementTransfer', 0);
    assert.entityCount('WorkspaceAssetSpend', 0);
  });

  test('two assets in one workspace stay on separate rows', () => {
    fundedWorkspace(WS);
    reserveAndSettle(WS, 'op-hbar', 'k-1', REAL_TX);
    handlePurchaseReserved(purchaseReserved(WS, 'op-hts', 'k-2', 'agent-a', BigInt.fromI32(7), '0.0.999', 99000, 1006, 106));
    handlePaymentSettled(paymentSettled('op-hts', '0.0.7162784@1789070000.1', BigInt.fromI32(7), 1008, 1008, 108));

    const ws = id32(WS).toHexString();
    assert.entityCount('WorkspaceAssetSpend', 2);
    assert.fieldEquals('WorkspaceAssetSpend', ws + '-0.0.0', 'settledAmount', '50000000');
    assert.fieldEquals('WorkspaceAssetSpend', ws + '-0.0.999', 'settledAmount', '7');
  });
});
