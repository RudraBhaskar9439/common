# Kavish — what is built, and the changes needed

**Status:** 2026-09-12. Written by Aditya after reading `docs/PAYMENT_ARCHITECTURE.md`,
`docs/workstreams/kavish.md` and `docs/workstreams/kavish-evidence.md`, and after
verifying the deployed contract, the relay, the mirror node and the HCS topic directly.

**Context:** `docs/NEW_ARCHITECTURE.md`. **Evidence:** `docs/workstreams/aditya-evidence.md`.

The changes in §3 are small and deliberately so. The contract is not touched, the ABI is
not touched, the payment path is not touched, and nothing is redeployed.

---

## 1. What Kavish built — verified independently

Not taken on trust. Every row below was checked against the live network with no
credentials, using public RPC and mirror-node reads.

| Item | Value | How verified |
| --- | --- | --- |
| `CommonBudget` | `0x7a6a1edE510692F5f6208733fD849833Fd86A893`, chain `296` | `eth_getCode` returns bytecode; `eth_chainId` = `0x128` |
| Start block | `40352293` | folding every log from here yields **zero orphans** |
| Events | **all 10 types have real logs** — 159 total | decoded against `contracts/abi/CommonBudget.json` |
| `ReservationReleased` | 24 logs, all three reason codes (15 / 5 / 4) | `contracts/README.md` still says this event has none — it is stale |
| Real payments | **8** successful 0.5 HBAR transfers, 400,000,000 tinybar | mirror node, seller account `0.0.10463575` |
| HCS decision notes | topic `0.0.10465595`, 2 notes | read via mirror node; see §2 |
| Timestamp units | unix **seconds** | `adapter.ts:317`, `seed-testnet.js:112` |
| Identifier scheme | `keccak256(utf8(label))` | all four named workspace labels resolve to on-chain ids |

The architecture is sound, and the honesty in his documentation is the most valuable part
of it — particularly that the contract is *a ledger, not a vault*, and that enforcement is
custodial because the x402 `exact` scheme forbids contracts in the payment path.

**Two structural properties worth preserving verbatim** in any future change: an agent
cannot spend because it holds no key, and an HCS retry cannot replay a payment because
that module imports no payment code. Both are structural rather than checked, which makes
them stronger than a guard.

### Something his own code already gave us for free

The Hedera SDK appears in exactly **three** files — `payments/transfer.ts`,
`hcs/decision-notes.ts`, `scripts/create-topic.ts`. All payment and HCS.
`contracts/budget-client.ts` is **pure ethers with no Hedera reference and no hardcoded
chain id**, and `apps/paid-service` contains **zero** references to the contract.

That separation is why the change in §3 is as small as it is, and it is why moving the
ledger to another chain would also have been cheap had we chosen to.

---

## 2. Two findings for Kavish

### 2.1 The HCS notes are cryptographically bound to the indexed events

He flagged that the topic has **no submit key**, so anyone may post to it — deliberately,
because the notes are claims rather than authority. That would normally make hydrated
rationale untrusted. It does not have to be.

Every identifier in both published notes hashes **exactly** to the on-chain `bytes32`:

```
HCS seq 2  (DecisionRecorded at block 40356400)
  MATCH  decisionId   "decision-b-1789073544816"      keccak -> 0xdd3811334e6e…  == on-chain
  MATCH  workspaceId  "demo-workspace-1789073544816"  keccak -> 0xce2d9c7f59da…  == on-chain
  MATCH  agentId      "agent-b"                       keccak -> 0xa2faf6b08bba…  == on-chain
  MATCH  operationId  "op-a-1789073544816"            keccak -> 0x640a27e8643b…  == on-chain
```

8 of 8 fields matched across both notes. So the client can **verify** a note instead of
trusting it: fetch the sequence number the event committed to, re-hash the identifiers,
and accept the rationale only on a four-way match. Anyone can post to the topic; nobody
can post at a sequence number the contract already pointed at.

This means `DecisionRecorded` needs no extra string fields — the write order he chose
(**HCS first, then the event carrying the sequence number**) is what makes it work.

### 2.2 One real transfer was recorded as the settlement of two operations

```
block 40354349  op 0x36ae15c9…  ws 0xb07e3f13… (demo-workspace-1789069182855)
                txid 0.0.7162784@1789069246.329605799   settledAt 1789069256
block 40355252  op 0x9f43ff32…  ws 0x846f76a0… (unlabelled)
                txid 0.0.7162784-1789069246-329605799   settledAt 1789071185
```

The mirror node returns **one** record for that id — a single SUCCESS transfer of
50,000,000 tinybar. Same agent, different workspace, different purchase key, ~32 minutes
apart, recorded in the two different id renderings.

Reconciliation against every payment the seller actually received:

| Source | Payments | Tinybar |
| --- | --- | --- |
| Mirror node — ground truth | **8** | **400,000,000** |
| `PaymentSettled` events, naive | 9 | 450,000,000 |
| …excluding the seed placeholder | 8 | 400,000,000 |
| …de-duplicated by canonical id | **7** | **350,000,000** |

The naive 8-event total matches ground truth **by coincidence** — it double-counts
`@1789069246.329605799` and omits `@1789067662.127260536`, the standalone `pay:once` test
that never had a reservation. Two offsetting errors.

Per-workspace spend is unaffected, because the two operations sit in different workspaces.
The subgraph will canonicalise `0.0.X-sec-nanos` → `0.0.X@sec.nanos` and count distinct
transfers, so this is handled on the read side regardless.

**Questions, neither blocking:** is the block-40355252 event a pre-fix artifact from before
the reservation-timestamp bound was added? And does the fixed path normalise the id form
before calling `recordSettlement`? If it does, canonicalisation stays as defence in depth
rather than a live correction.

---

## 3. Changes needed in Kavish's code

Two edits. Both in `apps/paid-service`.

### 3.1 `apps/paid-service/src/providers/datasets.ts`

`build()` returns live, block-pinned Subgraph data instead of a seeded series, and becomes
async:

```ts
export interface Dataset {
  id: string;
  description: string;
  capabilities: readonly string[];
  freshnessSeconds: number;
  build(): Promise<unknown>;      // was: build(): unknown
}
```

The Graph querying itself lives in **`packages/graph-client`** (Aditya's module) and is
imported through its public export, so this file gains an import and a call rather than
any query logic. That keeps the diff small and the ownership boundary intact.

`seededSeries()` and its two dataset definitions are replaced by block-pinned queries.
`capabilities` and `freshnessSeconds` keep their current meaning and stay on the same
struct — they are still what the reuse gate reads.

### 3.2 `apps/paid-service/src/server.ts` — applied, slightly larger than one word

I said this was a one-word change. It is three small ones, because validating the block
correctly matters more than keeping the diff at one line.

1. **`pinnedBlock(url)`** reads `?block=` from the request. The block must come from the
   buyer, not the server: both sides have to agree on which block is being sold, and a
   server-chosen block would give two buyers of the same purchase key different bytes.
2. **`resource` now carries the query string**, so the contract's `paramsHash` binds which
   block was bought — the same mechanism that already binds amount, asset and recipient.
3. **A missing or malformed block is a 400 before a price is quoted**, next to the existing
   unknown-dataset check. Refusing early rather than after `/settle` means we never take
   payment for a request we cannot fulfil.
4. `content: await dataset.build(block, ...)` — the original one-word change.
5. **`createApp` takes an optional `{ fetchImpl }`**, the same injection its `facilitator`
   already has, so tests never reach a live provider.

His `gate.test.ts` needed updating too, and the determinism test became stronger rather
than weaker. It previously asserted `build()` was byte-identical across calls. It now
asserts that the same block and the same upstream response are byte-identical, **and** that
the payload contains no timestamp — because a timestamp would silently break byte-equality
between two buyers and would look like a reuse bug rather than a provenance bug. Three
tests were added: a missing block is refused pre-payment, a different block is a different
resource, and requirements bind the block. **16 paid-service tests pass, up from 13.**

### 3.3 Environment — no code change

| Variable | File | Change |
| --- | --- | --- |
| `RESOURCE_URL` | `packages/hedera-adapter/.env.example` | `http://localhost:3002/...` → the public URL |
| `PAID_SERVICE_URL` | already read by `infra/scripts/*` | point at the public URL |
| `GRAPH_GATEWAY_URL`, `GRAPH_API_KEY` | new, `apps/paid-service/.env.example` | add (names only, never values) |

The localhost URL is **not hardcoded** — it is `RESOURCE_URL` in the environment. Hosting
is therefore configuration, not code.

### 3.4 Host the service — the one item that is not a code change

`apps/paid-service` has never been public. It runs on `localhost:3002`, and that is
recorded immutably on-chain in all 40 `PurchaseReserved` logs:

```
resource: "http://localhost:3002/datasets/daily-transfers"
```

The Hedera track requires *"**Host** a live x402-gated service on Hedera testnet or
mainnet, settled through the Blocky402 facilitator."* A judge cannot reach localhost.
`infra/deploy/` exists, so this is anticipated — it is simply not done yet, and it is the
single highest-priority item for track eligibility.

---

## 4. What does NOT change

| | Change? |
| --- | --- |
| `contracts/src/CommonBudget.sol` | **No — not one line.** ABI unchanged |
| Contract address `0x7a6a…A893`, chain 296, start block | **No. No redeploy** |
| `contracts/budget-client.ts` | **No** |
| `payments/transfer.ts`, `payments/x402-client.ts` | **No.** Payments stay on Hedera |
| `hcs/decision-notes.ts`, topic `0.0.10465595` | **No** |
| `reconciliation/mirror-node.ts` | **No** |
| All 50 unit tests | **No** — contract tests run on a local Hardhat chain |
| Every safety property in `PAYMENT_ARCHITECTURE.md` §7 | **No** |
| Shared interfaces | **No** |

One detail so it does not bite later: `paramsHash` binds `resource`, so new operations
hash the new public URL. That is fine — `reserve` and the payment read the same config
value. The 40 existing logs keep `localhost` as history, and the mappings index whatever
string is present. No migration, no data loss.

---

## 5. What Aditya needs from Kavish

1. **Host `paid-service`** at a public URL and update `RESOURCE_URL`. Highest priority.
2. **Review and apply the two edits in §3** — patch will be prepared, so it should be a
   short review.
3. **Answer §2.2** — pre-fix artifact, and does the fixed path normalise the id form?
4. **Confirm which workspaces are canonical for the demo.** `contracts/README.md` names
   `demo-workspace-1789069182855` / `…1789068849025`; his handoff message names
   `demo-workspace-1789073544816` / `drill-workspace-1789073972630`. All four are on chain.
5. **More indexable data, one command each:** a workspace settling in two assets (so
   per-asset spend is exercised rather than latent), a `DecisionRecorded` with
   `decisionType` 0/2/3 — all six on chain today are `reuse` — and a `DecisionRecorded`
   re-emitted with the same `decisionId` and a different payload, to pin the duplicate rule.
6. **Refresh `contracts/README.md`** on `ReservationReleased`; it has 24 logs now.
7. **Please keep two invariants.** `recordSettlement` requires `amount == op.amount` and
   `recordDelivery` requires status `Paid`, so the lifecycle is strictly ordered per
   operation. That is why `Purchase` can be a single mutable row keyed by `operationId`
   with no reordering buffer. If delivery could precede settlement, or amounts could
   differ, the mappings would need restructuring. Worth recording in `docs/DECISIONS.md`
   as an invariant rather than an accident.

**No secrets required, ever.** Everything verified in this document was read from public
endpoints with no credentials. His `config.ts` says the treasury key *"must not be exposed
to an AI agent"* — that is respected. Where new on-chain data is needed, Kavish runs
`npm run run:operation` himself.

---

## 6. What Aditya is building

In `subgraph/` and `packages/graph-client/`, blocked by nothing:

1. `schema.graphql` — `Workspace`, `WorkspaceAssetSpend`, `Purchase`, `Decision`
2. Ten event handlers, **event handlers only** — `trace_filter` and `trace_block` return
   `Not yet implemented` on the relay, so call handlers are unavailable. The ten events
   cover everything the read layer needs
3. Canonical transaction-id de-duplication, empty-string→null handling, `logIndex`
   ordering, `settlementUnknownAt` retained after reconciliation
4. matchstick tests: reuse path, unusable delivery, settlement-unknown→reconciled, all
   three release reasons, duplicate `decisionId`, empty `resultRef`, empty
   `hcsSequenceNumber`, empty workspace, pagination, zero-denominator reuse rate
5. `packages/graph-client` — `MemoryReader` with plaintext↔hash translation, cursor
   pagination, honest index-lag reporting, per-asset integer spend
6. Verified HCS rationale hydration using the four-way keccak check from §2.1
7. The live gateway query module that `paid-service` imports (§3.1)
8. A Subgraph MCP layer over Common's memory

**Graph reads never authorize spending.** An empty or lagging index is not permission to
buy; the contract reservation remains mandatory. That constraint is his, and it is kept.
