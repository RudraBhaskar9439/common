import { Address, BigInt, ByteArray, Bytes, crypto, ethereum } from '@graphprotocol/graph-ts';
import { newMockEvent } from 'matchstick-as/assembly/index';
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

/**
 * The contract stores keccak256(utf8(label)) — `toId` in the adapter. Hashing the same
 * way here keeps the fixtures readable and exercises the real identifier scheme rather
 * than inventing opaque byte strings.
 */
export function id32(label: string): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(ByteArray.fromUTF8(label)));
}

export const ZERO_ID = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000000000000000000000000000',
);

export const OPERATOR = Address.fromString('0xa8F6C40A598F67aB461d5291BBC264B138d93f1E');
export const HBAR = '0.0.0';
export const PRICE = BigInt.fromString('50000000');

function at<T extends ethereum.Event>(event: T, timestamp: i32, block: i32): T {
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(block);
  return event;
}

export function workspaceCreated(label: string, timestamp: i32, block: i32): WorkspaceCreated {
  const event = changetype<WorkspaceCreated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('workspaceId', ethereum.Value.fromFixedBytes(id32(label))));
  event.parameters.push(new ethereum.EventParam('operator', ethereum.Value.fromAddress(OPERATOR)));
  return at(event, timestamp, block);
}

export function workspaceFunded(
  label: string, amount: BigInt, budget: BigInt, policyVersion: i32, timestamp: i32, block: i32,
): WorkspaceFunded {
  const event = changetype<WorkspaceFunded>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('workspaceId', ethereum.Value.fromFixedBytes(id32(label))));
  event.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(amount)));
  event.parameters.push(new ethereum.EventParam('budget', ethereum.Value.fromUnsignedBigInt(budget)));
  event.parameters.push(new ethereum.EventParam('policyVersion', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(policyVersion))));
  return at(event, timestamp, block);
}

export function agentAuthorized(
  label: string, agent: string, authorized: boolean, policyVersion: i32, timestamp: i32, block: i32,
): AgentAuthorized {
  const event = changetype<AgentAuthorized>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('workspaceId', ethereum.Value.fromFixedBytes(id32(label))));
  event.parameters.push(new ethereum.EventParam('agentId', ethereum.Value.fromFixedBytes(id32(agent))));
  event.parameters.push(new ethereum.EventParam('authorized', ethereum.Value.fromBoolean(authorized)));
  event.parameters.push(new ethereum.EventParam('policyVersion', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(policyVersion))));
  return at(event, timestamp, block);
}

export function purchaseReserved(
  label: string, operation: string, key: string, agent: string,
  amount: BigInt, asset: string, expiresAt: i32, timestamp: i32, block: i32,
): PurchaseReserved {
  const event = changetype<PurchaseReserved>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('workspaceId', ethereum.Value.fromFixedBytes(id32(label))));
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  event.parameters.push(new ethereum.EventParam('purchaseKey', ethereum.Value.fromFixedBytes(id32(key))));
  event.parameters.push(new ethereum.EventParam('agentId', ethereum.Value.fromFixedBytes(id32(agent))));
  event.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(amount)));
  event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromString(asset)));
  event.parameters.push(new ethereum.EventParam('payTo', ethereum.Value.fromString('0.0.10463575')));
  event.parameters.push(new ethereum.EventParam('resource', ethereum.Value.fromString('https://paid.example/datasets/daily-transfers')));
  event.parameters.push(new ethereum.EventParam('expiresAt', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(expiresAt))));
  event.parameters.push(new ethereum.EventParam('policyVersion', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))));
  return at(event, timestamp, block);
}

export function paymentPending(operation: string, timestamp: i32, block: i32): PaymentPending {
  const event = changetype<PaymentPending>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  return at(event, timestamp, block);
}

export function settlementUnknown(operation: string, timestamp: i32, block: i32): SettlementUnknownFlagged {
  const event = changetype<SettlementUnknownFlagged>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  return at(event, timestamp, block);
}

export function paymentSettled(
  operation: string, transactionId: string, amount: BigInt, settledAt: i32, timestamp: i32, block: i32,
): PaymentSettled {
  const event = changetype<PaymentSettled>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  event.parameters.push(new ethereum.EventParam('transactionId', ethereum.Value.fromString(transactionId)));
  event.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(amount)));
  event.parameters.push(new ethereum.EventParam('settledAt', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(settledAt))));
  return at(event, timestamp, block);
}

export function deliveryRecorded(
  operation: string, usable: boolean, freshUntil: i32, resultRef: string, failureReason: string,
  timestamp: i32, block: i32,
): DeliveryRecorded {
  const event = changetype<DeliveryRecorded>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  event.parameters.push(new ethereum.EventParam('usable', ethereum.Value.fromBoolean(usable)));
  event.parameters.push(new ethereum.EventParam('freshUntil', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(freshUntil))));
  event.parameters.push(new ethereum.EventParam('resultRef', ethereum.Value.fromString(resultRef)));
  event.parameters.push(new ethereum.EventParam('failureReason', ethereum.Value.fromString(failureReason)));
  return at(event, timestamp, block);
}

export function reservationReleased(operation: string, reason: i32, timestamp: i32, block: i32): ReservationReleased {
  const event = changetype<ReservationReleased>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(id32(operation))));
  event.parameters.push(new ethereum.EventParam('reason', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(reason))));
  return at(event, timestamp, block);
}

export function decisionRecorded(
  label: string, decision: string, agent: string, decisionType: i32,
  operationId: Bytes, hcsSequenceNumber: string, timestamp: i32, block: i32,
): DecisionRecorded {
  const event = changetype<DecisionRecorded>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('workspaceId', ethereum.Value.fromFixedBytes(id32(label))));
  event.parameters.push(new ethereum.EventParam('decisionId', ethereum.Value.fromFixedBytes(id32(decision))));
  event.parameters.push(new ethereum.EventParam('agentId', ethereum.Value.fromFixedBytes(id32(agent))));
  event.parameters.push(new ethereum.EventParam('decisionType', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(decisionType))));
  event.parameters.push(new ethereum.EventParam('operationId', ethereum.Value.fromFixedBytes(operationId)));
  event.parameters.push(new ethereum.EventParam('hcsSequenceNumber', ethereum.Value.fromString(hcsSequenceNumber)));
  return at(event, timestamp, block);
}
