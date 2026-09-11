import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Workspace, WorkspaceAssetSpend } from '../generated/schema';

export const ZERO = BigInt.fromI32(0);
export const ZERO_BYTES32 = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000000000000000000000000000',
);

export const STATUS_RESERVED = 'RESERVED';
export const STATUS_PAYMENT_PENDING = 'PAYMENT_PENDING';
export const STATUS_SETTLEMENT_UNKNOWN = 'SETTLEMENT_UNKNOWN';
export const STATUS_PAID = 'PAID';
export const STATUS_DELIVERED = 'DELIVERED';
export const STATUS_DELIVERY_FAILED = 'DELIVERY_FAILED';
export const STATUS_RELEASED = 'RELEASED';
export const STATUS_EXPIRED = 'EXPIRED';

export const RELEASE_EXPLICIT: i32 = 0;
export const RELEASE_EXPIRED: i32 = 1;
export const RELEASE_RECONCILED_ABSENT: i32 = 2;

/**
 * An empty string is the contract's way of saying "absent" — `resultRef` on a failed
 * delivery, `hcsSequenceNumber` on a decision that predates HCS. Storing "" would make
 * a missing value look like a present one.
 */
export function emptyToNull(value: string): string | null {
  if (value.length == 0) return null;
  return value;
}

/** Seeded settlements carry a placeholder id and moved no money. Never counted as spend. */
export function isPlaceholderSettlement(raw: string): boolean {
  return raw.startsWith('SEED-PLACEHOLDER');
}

/**
 * Hedera renders one transaction id two ways: `0.0.X@seconds.nanos` from an SDK receipt
 * and `0.0.X-seconds-nanos` from the mirror node. Both have been emitted for the same
 * real transfer, so raw strings must be normalised before anything is counted.
 *
 * Anything that does not match the dash form is returned unchanged, which leaves the
 * already-canonical form and the seed placeholder untouched.
 */
export function canonicalTransactionId(raw: string): string {
  if (raw.indexOf('@') >= 0) return raw;
  const parts = raw.split('-');
  if (parts.length != 3) return raw;
  const account = parts[0];
  // An account id is 0.0.x — three dot-separated segments. Guards against splitting
  // an unrelated hyphenated string into a plausible-looking id.
  if (account.split('.').length != 3) return raw;
  return account + '@' + parts[1] + '.' + parts[2];
}

export function decisionTypeOf(raw: i32): string {
  if (raw == 0) return 'BUY';
  if (raw == 1) return 'REUSE';
  if (raw == 2) return 'WAIT';
  if (raw == 3) return 'REJECT';
  return 'BUY';
}

/**
 * WorkspaceCreated always precedes the other events, but writing defensively costs one
 * load and means a start block that missed the creation still produces usable rows
 * rather than dropping every purchase in that workspace.
 */
export function loadOrCreateWorkspace(id: Bytes, event: ethereum.Event): Workspace {
  let workspace = Workspace.load(id);
  if (workspace != null) return workspace;

  workspace = new Workspace(id);
  workspace.operator = Bytes.empty();
  workspace.policyVersion = ZERO;
  workspace.budget = ZERO;
  workspace.createdAt = event.block.timestamp;
  workspace.createdAtBlock = event.block.number;
  workspace.lastUpdatedAt = event.block.timestamp;
  workspace.reservedCount = 0;
  workspace.settledCount = 0;
  workspace.deliveredUsableCount = 0;
  workspace.deliveryFailureCount = 0;
  workspace.releasedCount = 0;
  workspace.expiredCount = 0;
  workspace.settlementUnknownCount = 0;
  workspace.reuseDecisionCount = 0;
  workspace.buyDecisionCount = 0;
  workspace.waitDecisionCount = 0;
  workspace.rejectDecisionCount = 0;
  workspace.decisionCount = 0;
  workspace.save();
  return workspace;
}

export function assetSpendId(workspaceId: Bytes, asset: string): string {
  return workspaceId.toHexString() + '-' + asset;
}

export function loadOrCreateAssetSpend(workspaceId: Bytes, asset: string): WorkspaceAssetSpend {
  const id = assetSpendId(workspaceId, asset);
  let spend = WorkspaceAssetSpend.load(id);
  if (spend != null) return spend;

  spend = new WorkspaceAssetSpend(id);
  spend.workspace = workspaceId;
  spend.asset = asset;
  spend.settledAmount = ZERO;
  spend.settledPayments = 0;
  spend.rawSettledAmount = ZERO;
  spend.rawSettledPayments = 0;
  return spend;
}

export function authorizationId(workspaceId: Bytes, agentId: Bytes): string {
  return workspaceId.toHexString() + '-' + agentId.toHexString();
}
