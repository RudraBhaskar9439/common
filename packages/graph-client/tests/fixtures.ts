/**
 * FIXTURES. Not live data.
 *
 * The identifiers and the HCS note are copied verbatim from Hedera testnet
 * (`demo-workspace-1789073544816`, HCS topic 0.0.10465595 sequence 2), so the tests
 * exercise the real identifier scheme and the real note shape rather than invented ones.
 * The GraphQL responses themselves are constructed.
 */
export const WORKSPACE_LABEL = 'demo-workspace-1789073544816';
export const WORKSPACE_ID = '0xce2d9c7f59da069ab1a0ebc9027e8e52e22ced3ac8b57e2522ad4744eabf98d8';
export const AGENT_LABEL = 'agent-b';
export const AGENT_ID = '0xa2faf6b08bba11a93beb07658ac68fe8df088dae5da5f2783488103412e1fd35';
export const DECISION_LABEL = 'decision-b-1789073544816';
export const DECISION_ID = '0xdd3811334e6eb0674dc0f4ef81a5c63100bdd0651c6c858d0f69ad2081703814';
export const OPERATION_LABEL = 'op-a-1789073544816';
export const OPERATION_ID = '0x640a27e8643bf3ea959854dc6a31c6aa5cf4fbb5be5e2448a52dd9b2bcdb58c8';
export const PURCHASE_KEY_LABEL = 'thegraph:demo-key';

export const REAL_TX = '0.0.7162784@1789073600.680467509';

export const META = { block: { number: 40392127 }, hasIndexingErrors: false };

export const PURCHASE_ROW = {
  id: OPERATION_ID,
  workspace: { id: WORKSPACE_ID },
  purchaseKey: '0xf4590f97a5de959d68a16cb08e3b3894bae03ceef03f0390b2fb33616e788065',
  agentId: AGENT_ID,
  amount: '50000000',
  asset: '0.0.0',
  payTo: '0.0.10463575',
  resource: 'https://paid.example/datasets/daily-transfers',
  expiresAt: '1789077200',
  policyVersion: '2',
  status: 'DELIVERED',
  paymentPendingAt: '1789073590',
  settlementUnknownAt: null,
  transactionId: REAL_TX,
  settledAt: '1789073614',
  usable: true,
  freshUntil: '1789160024',
  resultRef: 'result-1789073544816',
  failureReason: null,
  releaseReason: null,
  releasedAt: null,
  reservedAt: '1789073580',
  settlement: { id: REAL_TX, occurrences: 1, isPlaceholder: false },
};

/** The real note, byte-for-byte as published to topic 0.0.10465595 sequence 2. */
export const HCS_NOTE = {
  schemaVersion: 1,
  decisionId: DECISION_LABEL,
  workspaceId: WORKSPACE_LABEL,
  agentId: AGENT_LABEL,
  type: 'reuse',
  chosen: 'result-1789073544816',
  rejected: 'Buy a second copy',
  reason: 'A fresh delivered result already exists for this purchase key.',
  createdAt: '2026-09-10T20:53:55.155Z',
  operationId: OPERATION_LABEL,
  result: null,
  disclaimer:
    'Agent-stated reasoning. The consensus timestamp attests when this was written, not that it is true.',
};

export const DECISION_ROW = {
  id: DECISION_ID,
  workspace: { id: WORKSPACE_ID },
  agentId: AGENT_ID,
  decisionType: 'REUSE',
  operationId: OPERATION_ID,
  hcsSequenceNumber: '2',
  rationaleAvailable: true,
  recordedAt: '1789073636',
  reEmissionCount: 0,
  purchase: { id: OPERATION_ID, resultRef: 'result-1789073544816' },
};

export const WORKSPACE_ROW = {
  id: WORKSPACE_ID,
  budget: '500000000',
  policyVersion: '3',
  reservedCount: 2,
  settledCount: 1,
  deliveredUsableCount: 1,
  deliveryFailureCount: 0,
  releasedCount: 1,
  expiredCount: 0,
  settlementUnknownCount: 0,
  reuseDecisionCount: 1,
  buyDecisionCount: 0,
  waitDecisionCount: 0,
  rejectDecisionCount: 0,
  decisionCount: 1,
  spendByAsset: [
    { asset: '0.0.0', settledAmount: '50000000', settledPayments: 1, rawSettledAmount: '100000000', rawSettledPayments: 2 },
  ],
};

export interface StubCall { url: string; body: unknown }

/**
 * A fetch stub. Stubs live only in tests: they force conditions a live endpoint will not
 * produce on demand — a timeout, an indexing error, a forged HCS note.
 */
export function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json: unknown } | Promise<never>,
): { impl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const result = await handler(url, init);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.json,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

export function topicMessage(note: unknown, consensus = '1789073636.373918118'): unknown {
  return {
    message: Buffer.from(JSON.stringify(note), 'utf8').toString('base64'),
    consensus_timestamp: consensus,
    sequence_number: 2,
  };
}
