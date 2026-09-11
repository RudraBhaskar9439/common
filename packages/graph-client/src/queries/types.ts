export interface Meta {
  block: { number: number };
  hasIndexingErrors: boolean;
}

export interface RawSettlement {
  id: string;
  occurrences: number;
  isPlaceholder: boolean;
}

export interface RawPurchase {
  id: string;
  workspace: { id: string };
  purchaseKey: string;
  agentId: string;
  amount: string;
  asset: string;
  payTo: string;
  resource: string;
  expiresAt: string;
  policyVersion: string;
  status: string;
  paymentPendingAt: string | null;
  settlementUnknownAt: string | null;
  transactionId: string | null;
  settledAt: string | null;
  usable: boolean | null;
  freshUntil: string | null;
  resultRef: string | null;
  failureReason: string | null;
  releaseReason: number | null;
  releasedAt: string | null;
  reservedAt: string;
  settlement: RawSettlement | null;
}

export interface RawDecision {
  id: string;
  workspace: { id: string };
  agentId: string;
  decisionType: string;
  operationId: string;
  hcsSequenceNumber: string | null;
  rationaleAvailable: boolean;
  recordedAt: string;
  reEmissionCount: number;
  purchase: { id: string; resultRef: string | null } | null;
}

export interface RawAssetSpend {
  asset: string;
  settledAmount: string;
  settledPayments: number;
  rawSettledAmount: string;
  rawSettledPayments: number;
}

export interface RawWorkspace {
  id: string;
  budget: string;
  policyVersion: string;
  reservedCount: number;
  settledCount: number;
  deliveredUsableCount: number;
  deliveryFailureCount: number;
  releasedCount: number;
  expiredCount: number;
  settlementUnknownCount: number;
  reuseDecisionCount: number;
  buyDecisionCount: number;
  waitDecisionCount: number;
  rejectDecisionCount: number;
  decisionCount: number;
  spendByAsset: RawAssetSpend[];
}
