/**
 * Pagination is keyset on `id`, ascending, with `id_gt: cursor`.
 *
 * Not `skip`: offset pagination silently duplicates or omits rows when the index advances
 * between pages, and graph-node caps `skip` anyway. Keyset pagination cannot skip or
 * repeat a row, which matters here because a missed purchase reads as "nobody bought
 * this" and can lead to paying twice.
 *
 * The cost is that pages are ordered by identifier rather than by time. Every item
 * carries `reservedAt` / `recordedAt`, and the result sets per purchase key are small, so
 * a caller that needs chronology can order what it receives. Stated as a trade-off rather
 * than presented as chronological ordering it does not have.
 */

const PURCHASE_FIELDS = `
  id
  workspace { id }
  purchaseKey
  agentId
  amount
  asset
  payTo
  resource
  expiresAt
  policyVersion
  status
  paymentPendingAt
  settlementUnknownAt
  transactionId
  settledAt
  usable
  freshUntil
  resultRef
  failureReason
  releaseReason
  releasedAt
  reservedAt
  settlement { id occurrences isPlaceholder }
`;

export const FIND_PURCHASES = `
  query FindPurchases($workspace: Bytes!, $purchaseKey: Bytes!, $cursor: Bytes!, $first: Int!) {
    _meta { block { number } hasIndexingErrors }
    purchases(
      where: { workspace: $workspace, purchaseKey: $purchaseKey, id_gt: $cursor }
      orderBy: id
      orderDirection: asc
      first: $first
    ) { ${PURCHASE_FIELDS} }
  }
`;

export const GET_PURCHASE = `
  query GetPurchase($id: ID!) {
    _meta { block { number } hasIndexingErrors }
    purchase(id: $id) { ${PURCHASE_FIELDS} }
  }
`;

export const DECISION_HISTORY = `
  query DecisionHistory($workspace: Bytes!, $cursor: Bytes!, $first: Int!) {
    _meta { block { number } hasIndexingErrors }
    decisions(
      where: { workspace: $workspace, id_gt: $cursor }
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      workspace { id }
      agentId
      decisionType
      operationId
      hcsSequenceNumber
      rationaleAvailable
      recordedAt
      reEmissionCount
      purchase { id resultRef }
    }
  }
`;

export const WORKSPACE_STATS = `
  query WorkspaceStats($workspace: ID!) {
    _meta { block { number } hasIndexingErrors }
    workspace(id: $workspace) {
      id
      budget
      policyVersion
      reservedCount
      settledCount
      deliveredUsableCount
      deliveryFailureCount
      releasedCount
      expiredCount
      settlementUnknownCount
      reuseDecisionCount
      buyDecisionCount
      waitDecisionCount
      rejectDecisionCount
      decisionCount
      spendByAsset {
        asset
        settledAmount
        settledPayments
        rawSettledAmount
        rawSettledPayments
      }
    }
  }
`;

/** The zero id — the lowest possible Bytes cursor, so the first page starts from it. */
export const ZERO_CURSOR = '0x0000000000000000000000000000000000000000000000000000000000000000';
