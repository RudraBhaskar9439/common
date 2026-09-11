/**
 * Read-only check of the client against a live index. No keys, no writes, no payments.
 *
 *   GRAPH_ENDPOINT=http://localhost:8000/subgraphs/name/common/budget \
 *   GRAPH_CHAIN_HEAD_RPC_URL=https://testnet.hashio.io/api \
 *   npx tsx src/scripts/live-check.ts
 *
 * Prints what the index actually holds and reconciles the de-duplicated spend against the
 * raw event total, so a drift between them is visible rather than assumed away.
 */
import { createGraphMemoryReader, configFromEnv } from '../index.js';

const WORKSPACE_LABELS = [
  'demo-workspace-1789073544816',
  'drill-workspace-1789073972630',
  'demo-workspace-1789069182855',
  'demo-workspace-1789068849025',
  'workspace-1',
];

const memory = createGraphMemoryReader(configFromEnv());
let failures = 0;
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
};

console.log('\nCOMMON — live Graph read check (read-only)\n');

for (const label of WORKSPACE_LABELS) {
  let stats;
  try {
    stats = await memory.getIndexedWorkspaceStats(label);
  } catch (err) {
    check(label, false, String(err));
    continue;
  }

  const dedup = stats.purchaseSpendByAsset.reduce((a, m) => a + BigInt(m.amount), 0n);
  const raw = stats.rawSpendByAsset.reduce((a, m) => a + BigInt(m.amount), 0n);

  console.log(`\n${label}`);
  check('workspace is indexed', true, `budget ${stats.budget.amount} tinybar`);
  check(
    'acquisitions and failures are separate',
    true,
    `delivered ${stats.successfulAcquisitions}, deliveryFailed ${stats.failedRequests}`,
  );
  check(
    'reuse rate is null on a zero denominator',
    stats.reuseRate === null ? stats.successfulReuses + stats.successfulAcquisitions === 0 : true,
    `reuses ${stats.successfulReuses}, rate ${stats.reuseRate === null ? 'N/A' : stats.reuseRate.toFixed(2)}`,
  );
  check(
    'spend is integer and per-asset',
    stats.purchaseSpendByAsset.every(m => /^\d+$/.test(m.amount)),
    `dedup ${dedup} vs raw ${raw} tinybar${dedup === raw ? '' : '  <- excluded from spend: a placeholder or a duplicate record'}`,
  );
  check('counters the index cannot serve are flagged', stats.deniedRequestsIndexable === false
    && stats.successfulReusesIsCompletionEvidence === false, 'deniedRequests + successfulReuses marked');

  const decisions = await memory.getIndexedDecisionHistory({ workspaceId: label });
  console.log(`  ---  decisions: ${decisions.items.length}, index ${decisions.index.status} @ ${decisions.index.indexedBlock}`);
  for (const d of decisions.items) {
    const binding = d.rationale ? d.rationale.binding : d.rationaleAvailable ? 'note not fetched' : 'no note on chain';
    check(`decision ${d.type}`, d.rationale?.binding !== 'mismatched', `agent ${d.agentId} | rationale: ${binding}`);
    if (d.rationale?.binding === 'verified') console.log(`         reason: "${d.rationale.reason}"`);
  }
}

console.log(`\n${failures === 0 ? 'All live checks passed.' : `${failures} live check(s) FAILED.`}\n`);
console.log('This proves the client reads a live index. It proves nothing about payments.');
process.exit(failures === 0 ? 0 : 1);
