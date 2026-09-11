# Graph workstream — Aditya

**Scope:** the indexed read layer — `subgraph/`, `packages/graph-client/`.
**Phase:** 0 complete (review and feasibility). Nothing implemented yet, by design.
**Date:** 2026-09-11. Branch `workstream/aditya-graph`.

Evidence and reproduction commands: `docs/workstreams/aditya-evidence.md`.

---

## 0. Headline

Three things came out of Phase 0 that change the plan.

1. **Hedera is not a supported network on The Graph.** Subgraph Studio and the
   decentralized network are not available for chain 296. The only validated path is a
   **self-hosted `graph-node` against the Hashio JSON-RPC relay**. This is sourced in §6,
   not inferred from EVM compatibility.
2. **`Outcome.capabilities` cannot come from the chain.** `DeliveryRecorded` does not carry
   it, so a Graph-backed `MemoryReader` returns `capabilities: []` and
   `findReusablePurchase` rejects every candidate for any non-empty requirement. Proven
   against real chain data in §4. This is the project's headline memory behaviour, so it
   needs a decision before Phase 1.
3. **Two `WorkspaceStats` counters cannot be honestly derived from events**:
   `deniedRequests` (a denial is a revert — no log, and `trace_filter` is unimplemented on
   the relay) and `successfulReuses` as *completion* evidence (only intention is on chain).

Everything else needed for purchase discovery, decision history and spend statistics **is**
present and was verified against 159 real logs.

---

## 1. Baseline checks — actual results

Run on the merged `main` (`938696f`), clean clone, `npm ci` (lockfile unchanged).

| Check | Result |
| --- | --- |
| `npm ci` | passed; `git status` shows `package-lock.json` unmodified |
| `npm run check` (typecheck + build + test) | **passed**, 10/10 tests |
| `npm run demo:mock` | **passed**, prints a fixture reuse decision, `newPaymentsExecuted: 0` |

One environment discrepancy: `package.json` declares `engines.node >=24 <27` and `.nvmrc`
says `24`; this machine ran **Node v22.17.0**. npm did not enforce it and everything passed,
but CI on Node 24 is the authority and I am not testing the declared version locally.
Worth one line in `docs/ENVIRONMENT.md`; not blocking.

---

## 2. The real event surface

I did not take the handoff table on trust. I pulled every log the contract has emitted and
decoded it against `contracts/abi/CommonBudget.json`.

Contract `0x7a6a1edE510692F5f6208733fD849833Fd86A893`, chain 296, blocks 40352293 → head.
**159 logs, and the count is genuine** — chunked queries sum to exactly 159, so the relay is
not silently truncating.

| Event | Real logs | Event | Real logs |
| --- | --- | --- | --- |
| `PurchaseReserved` | 40 | `PaymentSettled` | 9 |
| `AgentAuthorized` | 26 | `DeliveryRecorded` | 8 |
| `ReservationReleased` | 24 | `DecisionRecorded` | 6 |
| `WorkspaceCreated` | 14 | `SettlementUnknownFlagged` | 6 |
| `WorkspaceFunded` | 13 | `PaymentPending` | 13 |

**All ten event types have real logs.** `contracts/README.md` still says
`ReservationReleased` has none — it now has 24, covering all three reason codes
(15 explicit, 5 expired, 4 reconciled-absent). Kavish's message is current; the README is stale.

**Start block 40352293 is correct.** Folding all 159 logs into the entity model produced
**zero orphans** — every `PaymentPending`, `PaymentSettled`, `DeliveryRecorded`,
`SettlementUnknownFlagged` and `ReservationReleased` resolved to a `PurchaseReserved`
already in range. That matters because those five events are keyed only by `operationId`;
an earlier start block would silently produce unattributable payments.

Folded state of the 40 operations: 19 released, 7 reserved, 6 delivered, 5 expired,
2 delivery-failed, 1 paid-not-yet-delivered. 14 workspaces, **one created but never funded**
— the empty-workspace edge case exists naturally in the data.

### Concrete values the mappings must handle

- `asset` is `'0.0.0'` on every reservation — HBAR. `amount` is `50000000` tinybar (0.5 HBAR).
  `decimals` is **not on chain**; `packages/hedera-adapter` already fixes the convention as
  `asset === '0.0.0' ? 8 : 0`. I will mirror it exactly rather than invent a second rule.
- `freshUntil` and `settledAt` are **unix seconds** (`Math.floor(getTime()/1000)`), confirmed
  in `adapter.ts:317` and `seed-testnet.js:112`.
- `resultRef` is an opaque string (`result-1789073544816`) and is **`""` on both unusable
  deliveries**. Empty must map to absent, never to a `ResultReference` with an empty id.
- `hcsSequenceNumber` is `""` on 4 of 6 decisions and `"1"`/`"2"` on the two newest, exactly
  as Kavish said. Empty maps to absent.
- **All 6 `DecisionRecorded` logs are `decisionType = 1` (reuse).** There is not a single
  `buy`, `wait` or `reject` decision on chain. The "what was rejected and why" half of the
  product story has no on-chain representation yet.
- `resource` is `http://localhost:3002/datasets/daily-transfers` on all 40 reservations —
  identical, and a localhost URL now immutable in the logs. It cannot discriminate between
  datasets, and a client must never treat it as a fetchable endpoint.
- 40 reservations over 30 distinct purchase keys: **10 keys carry more than one operation**
  (after release or expiry). `findPurchases` is inherently multi-result and ordering is
  load-bearing, not cosmetic.

### A finding for Kavish: one real transfer, two settlements

9 `PaymentSettled` events carry 9 distinct `transactionId` strings but only **8 distinct
transfers**. Hedera ids appear in two encodings and one transfer appears in both:

```
block 40354349  op 0x36ae15c9…  ws 0xb07e3f13… (demo-workspace-1789069182855)
                txid 0.0.7162784@1789069246.329605799   settledAt 1789069256
block 40355252  op 0x9f43ff32…  ws 0x846f76a0… (unlabelled)
                txid 0.0.7162784-1789069246-329605799   settledAt 1789071185
```

Same agent, different workspace, different purchase key, ~32 minutes apart. The dash form is
the mirror-node representation, so this reads like reconciliation adopting an earlier
identical payment — the failure Kavish says the drills caught and bounded by reservation
timestamp. **I am reporting the observation, not diagnosing it.** Two questions for him: is
this a pre-fix log, and is the fixed code now canonicalising the id form?

Either way it is a real constraint on my side, and it lands squarely on Phase 2's
deduplication and precision requirements:

- Naive spend across workspaces: **450000000 tinybar**. De-duplicated by canonical
  transfer id: **400000000 tinybar**. A 12.5% overstatement.
- The two operations sit in **different workspaces**, so *per-workspace* `purchaseSpend` is
  unaffected. Only a cross-workspace or protocol-wide total double-counts.
- The subgraph will therefore store both `transactionId` (raw, as emitted) and
  `transactionIdCanonical` (normalised `0.0.X@sec.nanos`), and any total above workspace
  scope will count distinct canonical transfers.

---

## 3. Proposed minimum indexed model

Event handlers only — no call handlers (see §6). Sketch, for review, not yet written:

```graphql
type Workspace @entity {
  id: Bytes!                       # workspaceId (bytes32)
  operator: Bytes!
  policyVersion: BigInt!
  budget: BigInt!                  # latest WorkspaceFunded.budget
  createdAt: BigInt!               # block timestamp
  purchases: [Purchase!]! @derivedFrom(field: "workspace")
  decisions: [Decision!]! @derivedFrom(field: "workspace")
  spendByAsset: [WorkspaceAssetSpend!]! @derivedFrom(field: "workspace")
  settledCount: Int!  deliveredUsableCount: Int!  deliveryFailedCount: Int!
  releasedCount: Int! expiredCount: Int!  reuseDecisionCount: Int!
}

# One row per (workspace, asset). Keeps token units separate; no cross-asset addition.
type WorkspaceAssetSpend @entity {
  id: ID!                          # workspaceId-asset
  workspace: Workspace!
  asset: String!
  settledAmount: BigInt!
  settledPayments: Int!
}

type Purchase @entity {
  id: Bytes!                       # operationId — dedup is structural
  workspace: Workspace!
  purchaseKey: Bytes!  agentId: Bytes!
  amount: BigInt!  asset: String!  payTo: String!  resource: String!
  expiresAt: BigInt!  policyVersion: BigInt!
  status: OperationStatus!
  transactionId: String            # raw, as emitted
  transactionIdCanonical: String   # 0.0.X@sec.nanos, for dedup
  settledAt: BigInt
  settlementUnknownAt: BigInt      # non-null = was flagged, even once resolved
  usable: Boolean  freshUntil: BigInt
  resultRef: String                # null when the event carried ""
  failureReason: String
  releaseReason: Int               # 0 explicit, 1 expired, 2 reconciled-absent
  reservedAt: BigInt!  reservedAtBlock: BigInt!
  lastUpdatedAt: BigInt!  lastUpdatedAtBlock: BigInt!
}

enum OperationStatus {
  RESERVED PAYMENT_PENDING SETTLEMENT_UNKNOWN PAID
  DELIVERED DELIVERY_FAILED RELEASED EXPIRED
}

type Decision @entity {
  id: Bytes!                       # decisionId
  workspace: Workspace!
  agentId: Bytes!
  decisionType: DecisionType!
  purchase: Purchase               # null when operationId is zero
  hcsSequenceNumber: String        # null when the event carried ""
  recordedAt: BigInt!  recordedAtBlock: BigInt!  logIndex: Int!
  reEmissionCount: Int!            # see the duplicate rule below
}

enum DecisionType { BUY REUSE WAIT REJECT }
```

Notes that are decisions, not details:

- **`Purchase.id = operationId`** makes duplicate handling structural: a replayed log
  updates one row instead of creating a second.
- **`recordDecision` has no state guard** — it is a bare `emit` with no storage write, so the
  same `decisionId` can be emitted repeatedly with *different* payloads. I propose
  **first write wins**, incrementing `reEmissionCount`, because a decision record is an
  audit claim and a later contradictory emission should be visible rather than silently
  overwrite history. Needs Rudra's agreement.
- **Ordering within a transaction matters.** Lazy expiry inside `reserve` emits
  `ReservationReleased` for the *lapsed* operation and `PurchaseReserved` for the new one in
  the same transaction. Handlers must be `logIndex`-ordered, which graph-node guarantees.
- `settlementUnknownAt` is kept after reconciliation resolves the operation, so "was this
  ever uncertain?" stays answerable. Kavish's demo narrative depends on that.
- Sync metadata for `Page.index` comes from graph-node's `_meta { block { number } }`,
  compared against the relay head.

---

## 4. Can the index serve `MemoryReader`? Field by field

`MemoryReader` has three methods. Two are fully servable; all three have caveats.

| Interface field | Source | Status |
| --- | --- | --- |
| `Purchase.operationId/workspaceId/purchaseKey` | `PurchaseReserved` | **yes**, as `bytes32` hex — see §5 P7 |
| `Purchase.status` | full lifecycle fold | **yes** — all 8 states reachable, all observed except a live `payment_pending` tail |
| `Purchase.amount.amount` / `.tokenId` | `PurchaseReserved.amount` / `.asset` | **yes** |
| `Purchase.amount.decimals` | — | **not on chain**; injected registry (§5 P5) |
| `Purchase.receipt.transactionId` | `PaymentSettled` | **yes**, plus canonical form |
| `Purchase.result` | `DeliveryRecorded.resultRef` + operation's workspace | **yes**, null when `""` |
| `Outcome.usable` / `.freshUntil` / `.failureReason` | `DeliveryRecorded` | **yes** |
| **`Outcome.capabilities`** | — | **NO — blocking, see §5 P1** |
| `DecisionRecord.decisionId/workspaceId/agentId/type/operationId` | `DecisionRecorded` | **yes** |
| `DecisionRecord.createdAt` | block timestamp | **yes** (consensus time, not author time) |
| **`DecisionRecord.chosen` / `.rejected` / `.reason`** | — | **NO — see §5 P2** |
| `WorkspaceStats.purchaseSpend` | `PaymentSettled` sums | **yes**, but single-asset shape is wrong (§5 P4) |
| `WorkspaceStats.successfulAcquisitions` | delivered + usable | **yes** |
| `WorkspaceStats.failedRequests` | `DeliveryRecorded.usable = false` | **yes**, once the definition is agreed |
| **`WorkspaceStats.deniedRequests`** | — | **NO — structurally unindexable (§5 P3)** |
| **`WorkspaceStats.successfulReuses`** | `DecisionRecorded(reuse)` | **intention only, not completion (§5 P6)** |

### The capability gap, demonstrated

I built a `Purchase` using **only** fields the ABI actually emits — from the real delivered
operation in `demo-workspace-1789073544816` — and passed it through the real
`findReusablePurchase` from `packages/agent-tools`:

```
purchase assembled from real chain logs:
  freshUntil          2026-09-11T20:53:44.000Z
  capabilities        []

findReusablePurchase(capabilities: ["historical-data"]) -> null  <-- rejected
findReusablePurchase(capabilities: [])                  -> CANDIDATE FOUND
```

The purchase is genuinely reusable — paid, delivered, usable, fresh — and the consumer
rejects it, because line 20 of `packages/agent-tools/src/index.ts` requires every requested
capability to appear in `outcome.capabilities`. `apps/orchestrator/src/demo.ts` asks for
`['historical-data']`. So **the mock demo passes and a live Graph-backed demo would return
nothing**, for a reason that has nothing to do with my query being wrong.

The good news is that capabilities already exist off-chain, at delivery time:
`apps/paid-service/src/providers/datasets.ts` defines
`capabilities: ['historical-data', 'daily-granularity']` and `server.ts:159` returns them in
the paid response body, next to `freshUntil`. They arrive with the purchased bytes. They do
not need to be on-chain — they need to be stored with the result.

---

## 5. Shared interface proposals

**All PROPOSED. Nothing in `packages/interfaces/` has been touched.** `docs/DECISIONS.md`
still lists "Phase 0 interface approval" as pending, and Rudra coordinates acceptance.

I am following Kavish's pattern: he extended `SpendingAdapter` inside his own module
(`HederaSpendingAdapter extends SpendingAdapter`) rather than editing the shared file, and
those three additions (`reconcile`, `recordDelivery`, `retryDecisionNotes`) are **still not
in `packages/interfaces/src/index.ts`**. Worth promoting deliberately rather than leaving the
shared contract quietly behind two modules.

### P1 — `Outcome.capabilities` cannot be indexed · **blocking, decision needed**

Two ways out.

**Option A — no contract change (recommended).** Capabilities stay off-chain, where they
already are.
- `Outcome.capabilities` becomes optional: `capabilities?: readonly string[]`.
- The capability gate moves out of `MemoryReader`'s reach: either `findReusablePurchase`
  takes `resolveCapabilities?: (p: Purchase) => Promise<readonly string[]>`, or the
  orchestrator fetches from `ResultStore` and gates after discovery.
- `ResultStore` needs somewhere to keep them — a `capabilities` field on `StoredResult`.
- **Affected:** `packages/interfaces`, `packages/agent-tools`, `packages/mocks`,
  `apps/orchestrator`, `tests/interfaces/reuse.test.ts`, `packages/result-store`,
  `packages/graph-client`.
- **Cost:** Rudra's result store becomes load-bearing for reuse. Discovery stays
  Graph-served; suitability becomes a two-source check.

**Option B — contract change.** Add `string capabilities` (CSV) to `DeliveryRecorded`.
- **Affected:** `contracts/`, `packages/hedera-adapter`, `subgraph/`, plus a redeploy and a
  **new address and start block**, invalidating the 159 logs already indexed.
- Kavish has said the ABI is stable and he is not changing it, which effectively selects A.

**My recommendation: A.** It matches where the data already lives, costs no gas and no
redeploy. The honest consequence, which should be written down rather than glossed: the
Graph answers *"was this bought, did it deliver, is it fresh"*; it does not answer *"can it
do what I need"*. That is still memory affecting a decision — it just isn't only the Graph.

### P2 — `DecisionRecord` is not fully indexable

`chosen`, `rejected` and `reason` are not in `DecisionRecorded`; they live in the HCS note.
`getDecisionHistory(): Page<DecisionRecord>` therefore cannot be satisfied, and I will not
return empty strings dressed as data.

Proposal: split write-side from read-side. Keep `DecisionRecord` as what the orchestrator
submits. Add the Graph-served type and change the reader:

```ts
export interface IndexedDecision {
  decisionId: string; workspaceId: string; agentId: string;
  type: DecisionType; operationId?: string;
  recordedAt: ISODateTime;          // block consensus timestamp
  hcsSequenceNumber?: string;       // absent when the event carried ""
  rationaleAvailable: boolean;      // true only when an HCS sequence number is linked
}
// MemoryReader.getDecisionHistory(...): Promise<Page<IndexedDecision>>
```

Rationale text is hydrated from the mirror node **in the client, never in the mappings** —
subgraph mappings cannot read HCS. **Affected:** `packages/interfaces`,
`packages/graph-client`, `packages/mocks`, `apps/orchestrator`, `apps/web`.

### P3 — `WorkspaceStats.deniedRequests` is structurally unindexable

A competing agent is denied by `revert PurchaseAlreadyReserved`. A reverted EVM transaction
emits no logs, and `trace_filter`/`trace_block` return **"Not yet implemented"** on the
relay (§6), so there is no trace fallback either. `contracts/README.md` already records the
seeded denial as "reverted — no event, by design", and the drills confirm it.

Proposal: remove `deniedRequests` from `WorkspaceStats`, or keep it and document it as
orchestrator-sourced, never Graph-sourced. I will not emit a zero and let it read as
"nothing was denied" — competitive denial is a headline demo behaviour and deserves an
honest source. **Affected:** `packages/interfaces`, `packages/mocks`,
`packages/graph-client`, `apps/web`.

### P4 — `WorkspaceStats.purchaseSpend` cannot hold more than one asset

Single `Money` cannot represent multi-asset spend, and Phase 2 requires token units stay
separate. Today everything is `'0.0.0'`, so this is latent, not broken.

Proposal: `purchaseSpendByAsset: readonly Money[]`, one entry per asset, integer strings
throughout, never summed across assets. **Affected:** `packages/interfaces`,
`packages/mocks`, `packages/graph-client`, `apps/web`.

### P5 — `Money.decimals` has no on-chain source

`asset` is `'0.0.0'`; decimals are nowhere in the ABI. `packages/hedera-adapter` already
hardcodes `asset === '0.0.0' ? 8 : 0`.

Proposal: no interface change. Promote that rule to one shared constant instead of
duplicating the ternary in two modules, and let `createGraphMemoryReader` take an
`assetRegistry` override. **Affected:** `packages/interfaces` (a constant),
`packages/hedera-adapter`, `packages/graph-client`.

### P6 — `successfulReuses` must not count intention

`DecisionRecorded(type = reuse)` records that an agent *decided* to reuse. Nothing on chain
says the agent then finished its task. Phase 2 explicitly requires completion evidence.

Proposal, in order of preference:
1. Define the indexed counter as **`reuseDecisionCount`** — reuse decisions whose referenced
   operation is `DELIVERED` with `usable = true` — and name it so it cannot be mistaken for
   completion. This is indexable today.
2. If the team wants true completion, it needs either a new event from Kavish or an
   orchestrator-sourced counter from Rudra. Not my call, and not something I can fabricate
   from these ten events.

**Affected:** `packages/interfaces`, `packages/graph-client`, `packages/mocks`, `apps/web`.

### P7 — identifiers are hashes, and the consumer compares plaintext

`workspaceId`, `purchaseKey`, `agentId` and `operationId` are `keccak256(utf8(label))` on
chain (`toId` in `budget-client.ts:59`). The interface types them as `string`, and
`findReusablePurchase` compares `purchase.workspaceId === query.workspaceId` against the
caller's plaintext. Returning hex from the index would fail that comparison silently.

Proposal: **no contract change.** `graph-client` accepts plaintext in `PurchaseQuery`, hashes
it to query, and echoes the caller's plaintext back onto returned entities. Where no
preimage is known — `agentId` in decision history — it returns the `0x…` hex and labels it as
an unresolved identifier rather than pretending it is a name. I verified the scheme end to
end: `keccak256` of all four workspace labels Kavish named resolves to workspace ids present
on chain. **Affected:** `packages/graph-client` (mine); documented for `agent-tools`.

### One observation for Rudra, not a proposal

`findReusablePurchase` checks `purchase.result?.workspaceId === query.workspaceId`. Since I
derive `result.workspaceId` from the operation's on-chain workspace and already filter by
workspace, that check is **tautological against a Graph-backed reader** — it cannot fail. It
is not an authorization boundary. `ResultStore` must enforce access on read; the guard in
`agent-tools` should not be relied on for isolation.

---

## 6. Feasibility assessment — sourced

### The Graph does not support Hedera

Hedera appears **nowhere** in [The Graph's supported-networks table](https://thegraph.com/docs/en/supported-networks/).
Hedera's own documentation states it directly:

> "Although Hedera supports subgraphs, its hosted service is currently unavailable, so we'll
> need to set up and run a local graph node to deploy our subgraph."
> — [Hedera docs](https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-subgraph-using-the-graph-and-json-rpc)

So: **Studio and the decentralized network are out for chain 296.** Not an effort question —
the network is not offered. Self-hosted `graph-node` against the relay is the only validated
path, and that is a materially different amount of work and a different judging story.

### The relay supports what event-handler indexing needs — verified, not assumed

Tested directly against `https://testnet.hashio.io/api` (relay `0.78.5`, chain id `0x128` = 296):

| Method | Result | Consequence |
| --- | --- | --- |
| `net_version` | `296` | fine |
| `eth_getLogs` | works to **39,834-block spans**, no range error | full-history backfill is one query |
| `eth_getBlockByNumber` (full tx) | works, incl. blocks `0x0`–`0x2` | the old `GRAPH_ETHEREUM_GENESIS_BLOCK_NUMBER=1` workaround looks obsolete |
| `eth_getBlockByHash` | works | fine |
| `eth_getTransactionReceipt` | works | fine |
| `eth_call` | executes (reverted correctly on junk input) | fine |
| **`trace_filter`** | **`-32601 Not yet implemented`** | **no `callHandlers`** |
| **`trace_block`** | **`-32601 Not yet implemented`** | **no call-level indexing** |

Two things follow. **Event handlers only** — which is fine, the ten events cover everything I
need. And **reverts are unreachable by any route**, confirming P3 independently.

One relay behaviour to guard against: `eth_getLogs` with `toBlock` **past the head returns an
empty array, not an error**. A naive client would read that as "no data". graph-node won't,
but my client must not either.

No rate limiting observed on 25 sequential calls. Hashio publishes tiered limits, so a real
backfill should be treated as rate-limit-prone; start block `40352293` keeps the sync to
~40k blocks instead of ~40M.

### Tooling: the official Hedera example is stale

[`hashgraph/hedera-subgraph-example`](https://github.com/hashgraph/hedera-subgraph-example)
is the reference, and it is old: `graph-cli 0.33.0`, `graph-ts 0.27.0`,
`graph-node v0.27.0`, last substantive commit **2023**, one dependency audit in Jan 2025.
Current: **graph-cli 0.98.1, graph-ts 0.38.2, matchstick-as 0.6.0, graph-node v0.45.0**
(Aug 2026). I will pin current versions and verify empirically rather than copy a
three-year-old compose file, keeping its one genuinely Hedera-specific detail: the
`ethereum: 'testnet:https://testnet.hashio.io/api'` provider string.

### Deployment options

| Option | Viable | Notes |
| --- | --- | --- |
| Subgraph Studio | **No** | chain 296 unsupported |
| Decentralized network | **No** | same |
| Self-hosted `graph-node` + Hashio | **Yes** | validated; Docker Compose, needs Postgres + IPFS |
| Third-party Hedera indexer (e.g. Hgraph) | Unassessed | hosted alternative; not a custom subgraph, so likely weaker on sponsor criteria |

**Plan: self-hosted `graph-node`, prepared locally in `subgraph/` with committed compose and
deploy scripts.** I will not claim a live deployment until one actually runs, and I am not
deploying anything externally without your say.

### Sponsor criteria — cannot assess yet

Your message referenced the track instructions as `" "` — empty. I have no track text, so I
am not going to guess what The Graph's ETHOnline 2026 criteria reward. This matters more than
usual here, because "custom subgraph on a self-hosted graph-node for an unsupported chain"
and "subgraph published to the decentralized network" are very different submissions and only
one of them is available to us. **Please paste the track instructions.** Per the brief I will
not claim eligibility merely because a custom subgraph exists.

---

## 7. Handoff status

### Have, verified

| Item | Value | Verified how |
| --- | --- | --- |
| ABI | `contracts/abi/CommonBudget.json` | 10 events decoded; all 159 logs parsed |
| Address | `0x7a6a1edE510692F5f6208733fD849833Fd86A893` | `eth_getCode` returns bytecode |
| Chain | `296` | `eth_chainId` = `0x128` |
| Start block | `40352293` | zero orphans when folding all logs |
| Release reason codes | 0 explicit, 1 expired, 2 reconciled-absent | contract source + all three observed |
| Timestamp units | unix **seconds** | adapter + seed script |
| ID scheme | `keccak256(utf8(label))` | all 4 named workspace labels resolve |
| Asset / decimals | `'0.0.0'` = HBAR, 8 | adapter convention + all 40 reservations |

### Need from Kavish

1. **The duplicated canonical transfer** (§2) — pre-fix artifact, or deliberate drill? Is the
   fixed code canonicalising id form?
2. **Which workspaces are canonical for the demo.** `contracts/README.md` names
   `demo-workspace-1789069182855` / `…1789068849025`; your message names
   `demo-workspace-1789073544816` / `drill-workspace-1789073972630`. All four are on chain —
   which pair should the demo and my tests target?
3. **Confirm the ABI is final** — that decides P1 in favour of Option A.
4. **Data shapes I'll want in Phase 1:** a workspace with two assets (to exercise P4 rather
   than leave it latent), a `DecisionRecorded` with `decisionType` 0/2/3 (all 6 today are
   reuse), and a `DecisionRecorded` re-emitted with the same `decisionId` and a different
   payload (to pin the duplicate rule in P3/§3). One command each, you said.
5. Please refresh `contracts/README.md` on `ReservationReleased` — it has 24 logs now.

### Need from Rudra

1. **A decision on P1** — the reuse demo does not work end-to-end on live data until
   capability data has an agreed home.
2. Acceptance or rejection of **P2, P3, P4, P6** — all four change types the orchestrator and
   web UI consume.
3. Confirmation that `ResultStore` will carry `capabilities` if P1-A is accepted.

### Answers to Kavish's two questions

**1. `bytes32` or raw strings? Keep `bytes32`.** I do not need a contract change.
`keccak256(utf8(label))` is deterministic, so I hash plaintext client-side to query, and I
verified all four of your workspace labels resolve to on-chain ids. The one real cost is
one-way: I cannot recover a label I was not given, so `agentId` in decision history will
surface as hex unless the orchestrator supplies a preimage map. That is a client-side
ergonomics problem, not worth gas or fixed-width loss. If you ever add a string, make it
`agentLabel` on `PurchaseReserved` — but do not redeploy for it.

**2. Who may emit `DecisionRecorded` for a reuse?** Two indexing-side observations, then my
preference. First, `recordDecision` writes no state and has no guard, so the same
`decisionId` can be re-emitted with a different payload — whoever holds the authority, the
subgraph needs the duplicate rule in §3 regardless. Second, all 6 decisions on chain are
reuse and none carry rationale, so the audit value currently rests entirely on the HCS note.
My preference is **keep operator-only**. Widening it lets any authorized agent write
unfalsifiable claims into the workspace's public audit trail for free, and reuse decisions
are exactly the counter the demo will point at. It is an authority question, as you say —
but the counter it feeds is the one most worth not being able to inflate. Rudra should
decide; I have no blocking dependency either way.

---

## 8. Open questions

1. **The Graph track instructions** — still missing. Blocks the Phase 5 criteria alignment
   and influences the deploy target.
2. **P1 (capabilities)** — blocks a genuine live reuse demo. Highest priority.
3. **`failedRequests` definition** — I read it as deliveries with `usable = false` (2 on
   chain). Confirm it does not also mean failed payments or denied reservations.
4. **Decision duplicate rule** — first-wins with a visible re-emission count, or last-wins?
5. **`resource` as a URL** — currently `http://localhost:3002/...` in immutable logs. Should
   the client redact or mark it, given it is not a fetchable endpoint?
6. **Node version** — local 22 vs declared 24.

## 9. Next actions (Phase 1, on your word)

1. `subgraph/` — `schema.graphql` and `subgraph.yaml` from §3, ten event handlers, current
   graph-cli/graph-ts, ABI copied to `subgraph/abis/`.
2. `matchstick` unit tests over fixtures for: reserve → settle → deliver-usable → reuse;
   delivery-unusable; settlement-unknown → reconciled; all three release reasons; duplicate
   `decisionId`; empty `resultRef`; empty `hcsSequenceNumber`.
3. `packages/graph-client` — `MemoryReader` against a `graph-node` GraphQL endpoint, with
   plaintext↔hash translation, cursor pagination, deterministic ordering, explicit index-lag
   reporting, canonical transfer-id dedup, and per-asset integer spend.
4. Local `graph-node` compose in `subgraph/`, prepared but **not deployed** without approval.
5. Fixtures under `fixtures/events/`, labelled as fixtures, derived from the real logs.

**Phase 0 gate: passed.** The indexing approach and the required handoffs are explicit; two
blocking gaps (P1, and the P3/P6 counter semantics) are named with options rather than
papered over; the shared interfaces remain untouched and proposed.

---

## 10. Addendum — after reading Kavish's payment architecture and evidence

Read `docs/PAYMENT_ARCHITECTURE.md`, `docs/workstreams/kavish.md` and
`docs/workstreams/kavish-evidence.md`. Two things in there change my design for the better,
and one confirms a problem. All three are verified live, not inferred.

### 10.1 P2 is solvable with no contract change — the HCS note carries the missing fields

`kavish-evidence.md` gave me the topic id (`0.0.10465595`), which Phase 0 did not have. The
notes contain **exactly** the fields `DecisionRecorded` omits, plus something I did not
expect — **plaintext identifiers**:

```json
{ "decisionId": "decision-b-1789073544816",
  "workspaceId": "demo-workspace-1789073544816",
  "agentId": "agent-b",
  "operationId": "op-a-1789073544816",
  "type": "reuse",
  "chosen": "result-1789073544816",
  "rejected": "Buy a second copy",
  "reason": "A fresh delivered result already exists for this purchase key.",
  "createdAt": "2026-09-10T20:53:55.155Z",
  "disclaimer": "Agent-stated reasoning. …attests when this was written, not that it is true." }
```

Kavish notes the topic **has no submit key — anyone may post to it**, deliberately, because
the notes are claims rather than authority. That would normally make hydrated rationale
untrusted. It doesn't have to be, because the identifiers are hashes of the plaintext:

**Every identifier in both notes hashes exactly to the on-chain `bytes32`.** Verified for
sequences 1 and 2, all four fields each:

```
HCS seq 2  (DecisionRecorded at block 40356400)
  MATCH  decisionId   "decision-b-1789073544816"      keccak -> 0xdd3811334e6e…  == on-chain
  MATCH  workspaceId  "demo-workspace-1789073544816"  keccak -> 0xce2d9c7f59da…  == on-chain
  MATCH  agentId      "agent-b"                       keccak -> 0xa2faf6b08bba…  == on-chain
  MATCH  operationId  "op-a-1789073544816"            keccak -> 0x640a27e8643b…  == on-chain
```

So the client can **verify** a note rather than trust it: fetch the sequence number the
event committed to, re-hash the note's identifiers, and accept the rationale only on a
four-way match. Anyone can post to the topic, but nobody can post at a sequence number the
contract already pointed at. That is a genuine integrity property, and it is stronger than
what an on-chain `string reason` would have given us — that would have been an unverified
operator claim occupying gas.

**Revised P2.** Keep `IndexedDecision` as the Graph-served type, and add an explicitly
optional, explicitly verified hydration layer in `graph-client`:

```ts
export interface DecisionRationale {
  chosen: string; rejected: string; reason: string;
  authoredAt: ISODateTime;            // the note's own createdAt — an agent claim
  consensusAt: ISODateTime;           // HCS consensus timestamp — when, not whether
  binding: 'verified' | 'mismatched'; // four-way keccak check against the indexed event
}
// IndexedDecision.rationale?: DecisionRationale
```

Rules I will hold to: hydration happens **in the client, never in the mappings** — subgraph
mappings cannot read HCS, as the brief warns. A `mismatched` note is surfaced as mismatched
and its text is never returned as the decision's reason. A decision with
`hcsSequenceNumber: ""` reports rationale as unavailable, which is the honest answer for the
four pre-HCS decisions on chain.

This softens P2 considerably: it is no longer "the Graph cannot answer this", it is "the
Graph answers it with one verified mirror-node read". **New requirement:** `graph-client`
needs the topic id and a mirror-node base URL as configuration (names only —
`HCS_DECISION_TOPIC_ID`, `HEDERA_MIRROR_NODE_URL`).

### 10.2 P7 improves too — preimages are recoverable where it matters

I said unresolved `agentId` would surface as hex. For any decision carrying an HCS sequence
number that is no longer true: the note supplies the plaintext and the keccak check proves
it. Hex remains the fallback for the four pre-HCS decisions and for purchase-side
identifiers, where no note exists. Recommendation in §7 is unchanged — keep `bytes32`, no
contract change — and it is now better supported.

### 10.3 The duplicate settlement is real, and the dedup rule reconciles exactly

I checked the mirror node, which is independent of the contract ledger.

The transfer recorded against two operations resolves to **one** transfer:

```
GET /api/v1/transactions/0.0.7162784-1789069246-329605799
  mirror-node records: 1     result SUCCESS
  0.0.10463485  -50000000 tinybar      0.0.10463575  +50000000 tinybar
```

Money moved **once**; the ledger records it as the settlement of two operations. Full
reconciliation against every payment the seller actually received:

| Source | Payments | Tinybar |
| --- | --- | --- |
| Mirror node — ground truth | **8** distinct | **400,000,000** |
| `PaymentSettled` events | 9 | 450,000,000 naive |
| …excluding the seed placeholder | 8 | 400,000,000 |
| …de-duplicated by canonical id | **7** distinct | **350,000,000** |

Two things follow, and the second is the interesting one.

1. **The canonicalisation rule is correct.** Canonical dedup collapses exactly the one pair
   the mirror node says is one transfer. Nothing else collapses.
2. **The naive total is right by accident.** 8 events × 0.5 HBAR = 400,000,000, which
   matches the mirror node — but the composition is wrong in two offsetting ways: it counts
   `@1789069246.329605799` twice, and it misses `@1789067662.127260536` entirely, because
   that payment was Kavish's standalone `pay:once` test and never had a reservation. Two
   errors cancelling is not a working counter.

So the rule for `purchaseSpend` is: exclude `SEED-PLACEHOLDER-*`, count distinct canonical
transaction ids, keep per-asset integer totals, and never present a protocol-wide total as
"money moved" without saying it is derived from the ledger rather than the mirror node.
Per-workspace figures are unaffected by the duplicate — the two operations sit in different
workspaces.

**Question for Kavish narrowed.** `kavish-evidence.md` §"Payment receipts" says of the `-`
and `@` forms: *"Same identifier, different rendering"* — which is right, and is exactly why
the ledger double-counts: the two renderings were written as two settlements. Given §8 says
the reconciliation time bound was added after the drills found this, my read is that the
block-40355252 event is a **pre-fix artifact**. Please confirm, and confirm whether the
fixed path now normalises the form before calling `recordSettlement` — if it does, I keep
canonicalisation as defence in depth rather than a live correction.

### 10.4 Things in his docs that resolve my open questions

- **`failedRequests`.** `recordDelivery(usable: false)` is explicitly "delivery as an outcome
  separate from payment", and the drill keeps the payment and the claim. So the two
  `usable: false` operations are delivery failures, not payment failures. My §8 Q3 reading
  is confirmed; I will name the counter `deliveryFailures` so it cannot be read as
  "payments that failed".
- **P5 decimals.** `kavish-evidence.md` "Known limitations" already states HBAR is 8 and that
  a real per-asset value must be supplied before any HTS token is used, and that this
  "affects display, never what is actually paid". That is the same conclusion as P5. His
  registry and mine must be one shared constant, not two.
- **P4 multi-asset is not hypothetical.** The transfer builder already supports HTS fungible
  tokens; only HBAR is tested. So `purchaseSpendByAsset` is forward-compatibility for a path
  his code already has, not speculative generality.
- **`ReserveInput` has no `payTo`/`resource`.** He raises this as "one genuine gap for the
  team" — the provider catalogue lives in `resolveResource(purchaseKey)` inside his adapter.
  From the read side, both fields **are** on `PurchaseReserved` and are indexed, so the
  subgraph can expose the bound `payTo` and `resource` per operation. That does not fix his
  write-side gap, but it means the catalogue is publicly auditable after the fact, which is
  worth saying when the interface change is discussed.
- **Graph is never spending authority.** Stated in his §9.4 and his trust assumptions, and in
  `AGENTS.md`. Restating it as my own constraint: `MemoryReader` will carry no method that
  could be mistaken for authorization, and index lag is reported explicitly rather than
  smoothed over.

### 10.5 One thing I need him to not change

`recordSettlement` requires `amount == op.amount` and `recordDelivery` requires status
`Paid`, so the lifecycle is strictly ordered per operation. My fold relies on that: it is why
`Purchase` can be a single mutable row keyed by `operationId` with no reordering buffer. If
a future change let delivery precede settlement, or let amount differ, the mapping would need
restructuring. Worth recording in `docs/DECISIONS.md` as an invariant rather than an
accident.
