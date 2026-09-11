import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessDelivery, checkRequirement, deriveCapabilities, describePayload } from '../src/index.js';

/** Real shapes, as returned by the live Uniswap V3 subgraph at a pinned block. */
const DAILY = {
  source: 'thegraph', subgraph: '5zvR82Qo…', query: 'daily-transfers', blockNumber: 25955502,
  data: {
    poolDayDatas: [
      { id: 'p-1-20300', date: 1789056000, volumeUSD: '81234567.1', txCount: '4211' },
      { id: 'p-1-20299', date: 1788969600, volumeUSD: '77412233.8', txCount: '3980' },
      { id: 'p-1-20298', date: 1788883200, volumeUSD: '69120044.2', txCount: '3612' },
    ],
  },
};

const POOLS = {
  source: 'thegraph', subgraph: '5zvR82Qo…', query: 'token-holders', blockNumber: 25955502,
  data: {
    pools: [
      { id: '0xa', volumeUSD: '605355461776', totalValueLockedUSD: '421912970', txCount: '12090554',
        token0: { symbol: 'USDC' }, token1: { symbol: 'WETH' } },
      { id: '0xb', volumeUSD: '135068595471', totalValueLockedUSD: '310673392', txCount: '7065172',
        token0: { symbol: 'WETH' }, token1: { symbol: 'USDT' } },
    ],
  },
};

// -------------------------------------------------------- payload inspection

test('reads field names, row counts and date cardinality from a real payload', () => {
  const shape = describePayload(DAILY.data);
  assert.ok(shape.fields.has('volumeusd'));
  assert.ok(shape.fields.has('txcount'));
  assert.equal(shape.rowCount, 3);
  assert.equal(shape.distinctDates, 3);
});

test('a field present but null or empty evidences nothing', () => {
  const shape = describePayload({ rows: [{ volumeUSD: null, txCount: '', date: 1 }] });
  assert.ok(!shape.fields.has('volumeusd'), 'null must not count as present');
  assert.ok(!shape.fields.has('txcount'), 'empty string must not count as present');
  assert.ok(shape.fields.has('date'));
});

test('inspection is bounded, so a pathological payload cannot hang it', () => {
  // A deeply nested structure; the node budget must stop the walk.
  let deep: unknown = { leaf: 1 };
  for (let i = 0; i < 5000; i += 1) deep = { nested: deep };
  const shape = describePayload(deep, 100);
  assert.ok(shape.fields.size > 0);
});

// ------------------------------------------------------ derived capabilities

test('derives capabilities from what the daily series actually contains', () => {
  const { capabilities, evidence } = deriveCapabilities(DAILY.data);
  assert.ok(capabilities.includes('historical-data'));
  assert.ok(capabilities.includes('daily-granularity'));
  assert.ok(capabilities.includes('volume-metrics'));
  assert.ok(capabilities.includes('transaction-counts'));
  // Nothing in this payload is per-holder, so the capability must not be claimed.
  assert.ok(!capabilities.includes('holder-distribution'));
  assert.match(evidence['volume-metrics']!, /volume fields/);
});

test('a single-block snapshot is point-in-time, not historical', () => {
  const { capabilities } = deriveCapabilities(POOLS.data);
  assert.ok(capabilities.includes('point-in-time'));
  assert.ok(capabilities.includes('liquidity-metrics'));
  assert.ok(capabilities.includes('token-metadata'));
  // One block, no date series — claiming history here would be a lie.
  assert.ok(!capabilities.includes('historical-data'));
  assert.ok(!capabilities.includes('daily-granularity'));
});

test('one dated record is a snapshot, not a time series', () => {
  const { capabilities } = deriveCapabilities({ rows: [{ date: 1789056000, volumeUSD: '1' }] });
  assert.ok(!capabilities.includes('historical-data'), 'a single date is not a series');
  assert.ok(capabilities.includes('point-in-time'));
});

// --------------------------------------------------- the objective judgement

test('a well-formed, non-empty payload is a usable delivery', () => {
  const a = assessDelivery(DAILY);
  assert.equal(a.usable, true);
  assert.equal(a.failureReason, undefined);
  assert.equal(a.rowCount, 3);
  assert.ok(a.capabilities.length > 0);
});

test('a corrupt payload is an unusable delivery, with a reason for the chain', () => {
  for (const bad of [null, undefined, 'not-an-object', 42]) {
    const a = assessDelivery(bad);
    assert.equal(a.usable, false, `${String(bad)} must not be usable`);
    assert.match(a.failureReason!, /no payload object/);
  }
  const noBody = assessDelivery({ source: 'thegraph', data: null });
  assert.equal(noBody.usable, false);
  assert.match(noBody.failureReason!, /no data body/);
});

test('a well-formed but empty result set is recorded as unusable, and says why', () => {
  const a = assessDelivery({ source: 'thegraph', data: { pools: [] } });
  assert.equal(a.usable, false);
  assert.match(a.failureReason!, /well-formed but empty/);
  // So a later agent can see this key returns nothing here, rather than buying it again.
});

// -------------------------------- the distinction that keeps memory truthful

test('a buyer whose requirement is unmet does NOT mark the delivery broken', () => {
  // This is the property that stops one buyer's needs poisoning the result for everyone.
  const assessment = assessDelivery(POOLS);
  assert.equal(assessment.usable, true, 'the delivery itself is fine');

  const wantsHolders = checkRequirement(assessment.capabilities, ['holder-distribution']);
  assert.equal(wantsHolders.satisfied, false);
  assert.deepEqual(wantsHolders.missing, ['holder-distribution']);
  assert.match(wantsHolders.explanation, /Unsuitable for this task/);

  // The same result is still suitable for a different agent with different needs.
  const wantsLiquidity = checkRequirement(assessment.capabilities, ['liquidity-metrics', 'point-in-time']);
  assert.equal(wantsLiquidity.satisfied, true);
  assert.match(wantsLiquidity.explanation, /Suitable/);
});

test('requirement checks name exactly what is missing, so a decision can be explained', () => {
  const check = checkRequirement(['point-in-time', 'volume-metrics'], ['historical-data', 'holder-distribution']);
  assert.equal(check.satisfied, false);
  assert.deepEqual(check.missing, ['historical-data', 'holder-distribution']);
  assert.match(check.explanation, /missing historical-data, holder-distribution/);
  assert.match(check.explanation, /Observed: point-in-time, volume-metrics/);
});

test('an empty requirement is satisfied by anything, and says so plainly', () => {
  const check = checkRequirement(['point-in-time'], []);
  assert.equal(check.satisfied, true);
  assert.match(check.explanation, /no specific capability was required/);
});

test('a requirement cannot be satisfied by an observation nobody made', () => {
  const check = checkRequirement([], ['historical-data']);
  assert.equal(check.satisfied, false);
  assert.match(check.explanation, /Observed: none/);
});
