# graph-client

**Owner:** Aditya

`MemoryReader` over the Common subgraph. Purchase discovery, decision history and
workspace statistics.

**This module reads.** It holds no keys and authorizes nothing. An empty or lagging result
is **not** permission to buy — only the contract reservation is. A transport failure
therefore raises rather than returning an empty page, because "we could not ask" and
"nothing was bought" must never look alike.

## Use it

```ts
import { createGraphMemoryReader, configFromEnv } from '@common/graph-client';

const memory = createGraphMemoryReader(configFromEnv());

const page = await memory.findPurchases({
  workspaceId: 'demo-workspace-1789073544816',   // plaintext; hashed for you
  purchaseKey: 'thegraph:uniswap-v3:pools:top10:block-21000000:ws-1',
});

console.log(page.index);        // { status: 'synced' | 'lagging' | 'unknown', indexedBlock }
console.log(page.nextCursor);   // keyset cursor, or null
```

Configuration names are in `.env.example`. `GRAPH_ENDPOINT` is required; everything else
degrades explicitly rather than silently.

## What it does that is not obvious

**Identifiers are one-way.** The contract stores `keccak256(utf8(label))`. Pass plaintext
and it is hashed for the query, then echoed back on the results — so a consumer comparing
`purchase.workspaceId` against its own query succeeds instead of meeting hex. Where no
preimage is known the hex is returned, never a guess. An already-hashed id is accepted too.

**Duplicate transfers are collapsed.** Hedera renders one transaction id two ways, and one
real transfer is already recorded against two operations on chain. Ids are canonicalised to
`0.0.X@seconds.nanos`; `settlementOccurrences` above 1 means the ledger recorded a
duplicate. Verified against the mirror node: this collapses exactly the one real pair.

**Decision rationale is verified, not trusted.** `chosen`, `rejected` and `reason` are not
on chain — they are in the HCS note at the sequence number the event committed to. The
topic has **no submit key**, so anyone may post to it. So the note is bound by re-hashing
its plaintext identifiers against the indexed `bytes32`; only a four-way match returns
`binding: 'verified'`. A forged note is returned as `'mismatched'` and its text never
replaces an indexed identifier. Anyone can post to the topic; nobody can post at a
sequence number the contract already pointed at.

**Pagination is keyset, not offset.** `skip` silently duplicates or omits rows when the
index advances mid-page, and a missed purchase reads as "nobody bought this". The cost is
that pages are ordered by identifier rather than by time; every item carries `reservedAt`,
and the result set per purchase key is small.

**Money stays integer.** Amounts are strings in the smallest unit, never `Number`.
Decimals are not on chain, so they come from an asset registry that mirrors the Hedera
adapter exactly (`0.0.0` → 8). An unknown asset reports 0 decimals — wrong for display,
never wrong about what was paid.

## Three things the index cannot tell you

Flagged in the return values rather than filled with a plausible zero.

| | Why |
| --- | --- |
| `outcome.capabilities` is always `[]`, and `capabilitiesIndexed: false` | `DeliveryRecorded` carries no capability field. **Gating reuse on this array rejects every otherwise-reusable purchase** — read capabilities from the result store |
| `deniedRequests` is `0`, and `deniedRequestsIndexable: false` | A denied reservation reverts. A reverted transaction emits no logs, and `trace_filter` is unimplemented on the relay. Structurally unindexable; source it from the orchestrator |
| `successfulReuses`, with `successfulReusesIsCompletionEvidence: false` | The chain records that an agent *decided* to reuse. Nothing on chain says it then completed its task |

`reuseRate` is `null` when the denominator is zero, never `0`.

## Beyond the shared interface

`createGraphMemoryReader` returns `GraphMemoryReader extends MemoryReader`, following the
pattern `@common/hedera-adapter` uses for `SpendingAdapter`. Prefer the `Indexed*` methods
— `findIndexedPurchases`, `getIndexedDecisionHistory`, `getIndexedWorkspaceStats` — which
expose what the index can and cannot claim. The plain `MemoryReader` methods stay
compatible; `getDecisionHistory` fills unavailable rationale with the exported
`RATIONALE_UNAVAILABLE` sentinel so a consumer can test for it rather than match prose.

Proposals to widen the shared interface are in `docs/workstreams/aditya.md` §5.

## Verification

```sh
npm test --workspace @common/graph-client     # 21 tests, no network
```

Stubs live only in `tests/`, and only to force what a live endpoint will not produce on
demand: a timeout, an indexing error, a forged HCS note. **No `src/` path has a mock,
fallback or fake-success mode.** These tests prove the client's logic; they prove nothing
about a live index. That needs a deployed subgraph.

Identifiers and the HCS note in `tests/fixtures.ts` are copied verbatim from Hedera
testnet, so the real identifier scheme and note shape are exercised rather than invented
ones. The GraphQL responses are constructed and labelled as fixtures.
