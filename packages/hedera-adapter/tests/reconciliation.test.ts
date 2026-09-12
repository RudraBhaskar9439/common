/**
 * Reconciliation is the only way out of settlement_unknown, so its edge cases are the
 * ones that decide whether a double payment is possible. Tested against a stub mirror
 * node — no network, no chain — and again against the REAL mirror node in
 * infra/scripts/live-verify.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileSettlement, type MirrorTransaction } from '../src/reconciliation/mirror-node.js';

const PAYER = '0.0.10463485';
const PAY_TO = '0.0.10463575';
const AMOUNT = 50_000_000n;
const WINDOW_CLOSES = 1_000_000;

/** Shape copied from a real Hedera testnet mirror node response. */
const matchingTransaction: MirrorTransaction = {
  transaction_id: '0.0.7162784-1789067662-127260536',
  result: 'SUCCESS',
  consensus_timestamp: `${WINDOW_CLOSES - 60}.746448104`,
  transfers: [
    { account: '0.0.802', amount: 265_634, is_approval: false },
    { account: '0.0.7162784', amount: -265_634, is_approval: false },
    { account: PAYER, amount: -50_000_000, is_approval: false },
    { account: PAY_TO, amount: 50_000_000, is_approval: false },
  ],
};

/**
 * STUB mirror node — test-only, never imported by src/. It exists to force conditions
 * the real mirror node will not produce on demand. The same logic is verified against
 * the REAL mirror node in infra/scripts/live-verify.ts.
 */
const stubMirror =
  (transactions: MirrorTransaction[], failWith?: number): typeof fetch =>
  async () =>
    ({
      ok: failWith === undefined,
      status: failWith ?? 200,
      json: async () => ({ transactions }),
    }) as unknown as Response;

/** The reservation opened well before the window closes. */
const RESERVED_AT = WINDOW_CLOSES - 300;

const base = {
  mirrorNodeUrl: 'http://stub.invalid',
  transactionId: matchingTransaction.transaction_id,
  payTo: PAY_TO,
  payer: PAYER,
  amount: AMOUNT,
  validUntilEpochSeconds: WINDOW_CLOSES,
  notBeforeEpochSeconds: RESERVED_AT,
};

test('finds the transfer and returns its real transaction id', async () => {
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([matchingTransaction]),
  });
  assert.equal(result.status, 'found');
  assert.equal(result.status === 'found' && result.transactionId, '0.0.7162784-1789067662-127260536');
});

test('keeps missing mirror data inconclusive even after validity expires', async () => {
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 1,
    fetchImpl: stubMirror([]),
  });
  assert.equal(result.status, 'inconclusive');
});

test('refuses to call an empty result absent while the window is still open', async () => {
  // The dangerous case: a transfer may not have been submitted YET. Calling this
  // absent would release the budget and permit a second payment.
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES - 30,
    fetchImpl: stubMirror([]),
  });
  assert.equal(result.status, 'inconclusive');
});

test('an unreachable mirror node is inconclusive, never absent', async () => {
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 600,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.status, 'inconclusive');
});

test('a mirror node error status is inconclusive, never absent', async () => {
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 600,
    fetchImpl: stubMirror([], 503),
  });
  assert.equal(result.status, 'inconclusive');
});

test('ignores a transfer of the wrong amount', async () => {
  const wrongAmount: MirrorTransaction = {
    ...matchingTransaction,
    transfers: [
      { account: PAYER, amount: -49_999_999, is_approval: false },
      { account: PAY_TO, amount: 49_999_999, is_approval: false },
    ],
  };
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([wrongAmount]),
  });
  assert.equal(result.status, 'inconclusive');
});

test('ignores a correct amount paid by someone else', async () => {
  const otherPayer: MirrorTransaction = {
    ...matchingTransaction,
    transfers: [
      { account: '0.0.999999', amount: -50_000_000, is_approval: false },
      { account: PAY_TO, amount: 50_000_000, is_approval: false },
    ],
  };
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([otherPayer]),
  });
  assert.equal(result.status, 'inconclusive');
});

test('ignores a failed transaction even when the amounts match', async () => {
  const failed: MirrorTransaction = { ...matchingTransaction, result: 'INSUFFICIENT_ACCOUNT_BALANCE' };
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([failed]),
  });
  assert.equal(result.status, 'inconclusive');
});

test('ignores an identical payment made BEFORE this reservation existed', async () => {
  // Regression, found by the Phase 4 drills against live testnet data.
  // Paying the same seller the same price is the normal case, not an edge case, so
  // matching on (payer, payTo, amount) alone adopts an earlier operation's transfer and
  // marks a stuck operation paid when it never was — the exact failure this system
  // exists to prevent, hiding inside the mechanism meant to prevent it.
  const earlierPayment: MirrorTransaction = {
    ...matchingTransaction,
    transaction_id: '0.0.7162784-1000000000-000000000',
    consensus_timestamp: `${RESERVED_AT - 120}.000000000`, // before we reserved
  };

  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([earlierPayment]),
  });

  assert.equal(result.status, 'inconclusive', 'an earlier identical transfer must not be adopted');
});

test('accepts a matching payment made after the reservation', async () => {
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([matchingTransaction]),
  });
  assert.equal(result.status, 'found');
});

test('finds our transfer among unrelated ones', async () => {
  const unrelated: MirrorTransaction = {
    transaction_id: '0.0.2-1789063294-624171210',
    result: 'SUCCESS',
    consensus_timestamp: '1789063300.849879165',
    transfers: [
      { account: '0.0.2', amount: -100_000_000_000, is_approval: false },
      { account: PAY_TO, amount: 100_000_000_000, is_approval: false },
    ],
  };
  const result = await reconcileSettlement({
    ...base,
    nowEpochSeconds: WINDOW_CLOSES + 60,
    fetchImpl: stubMirror([unrelated, matchingTransaction]),
  });
  assert.equal(result.status, 'found');
});
