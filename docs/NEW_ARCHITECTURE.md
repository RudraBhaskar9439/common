# New architecture — The Graph as the paid resource

**Status:** agreed direction, 2026-09-12. Supersedes the read-layer assumptions in
`docs/ARCHITECTURE.md` and `docs/BUILD_PLAN.md`. Does **not** supersede
`docs/PAYMENT_ARCHITECTURE.md`, which remains accurate in full.

**Raised by:** Aditya (Graph workstream), after Phase 0 feasibility work.
**Affects:** `apps/paid-service/` (2 small edits, Kavish), `subgraph/` and
`packages/graph-client/` (Aditya), agent deliverables (Rudra).

Detail for Kavish: `docs/KAVISH_IMPLEMENTATION.md`.
Evidence for every claim here: `docs/workstreams/aditya-evidence.md`.

---

## 1. The change, in one paragraph

The paid resource our agents compete over changes from a **synthetic dataset generated
in-process** to **live blockchain data queried from a Subgraph on The Graph**, pinned to a
block number so two buyers provably receive identical bytes. Nothing else moves. The
`CommonBudget` contract stays at the same address on Hedera testnet, payments stay on x402
via Blocky402, decision notes stay on HCS, and every shared interface is untouched. One
file in `apps/paid-service` changes, plus one `await`.

---

## 2. Why — two facts that forced it

**Fact one: The Graph cannot index Hedera.** Hedera appears nowhere in The Graph's
networks registry (v0.7.120 — 160 networks, zero Hedera entries, no chain 296). Hedera's
own documentation states it plainly: *"Although Hedera supports subgraphs, its hosted
service is currently unavailable, so we'll need to set up and run a local graph node."*
Subgraph Studio and the decentralized network are therefore unavailable to us, at any
level of effort.

**Fact two: the ETHOnline Graph track disqualifies the only remaining path.** Both Graph
tracks carry this clause verbatim:

> *"Consume live data from a Graph provider, for example querying Subgraphs with an API
> key from Subgraph Studio... **Mocked, local-only, or static datasets do not qualify.**"*

A self-hosted `graph-node` on Docker is exactly "local-only". So indexing our own Hedera
contract — the original plan — produces a working product that scores zero on the Graph
track, and there is no hosted alternative for chain 296.

**The way out is in the requirement's own wording.** Note the `or`:

> *"either the AI tooling targets The Graph's products or AI Suite, **or** the agent/app
> uses The Graph (Subgraphs, the Subgraph MCP, or Substreams) as its source of blockchain
> data"*

Neither branch requires The Graph to index *our* contract. So we stop trying to make The
Graph index Common, and instead make Graph data **the resource Common's agents buy and
share**. Two agents needing the same paid Graph query is a real duplicate-purchase problem
with a real cost — which is closer to what Common actually claims to be than indexing our
own ledger was.

The alternative considered and rejected was deploying `CommonBudget` to a
Studio-supported chain such as Base Sepolia. It works — the contract is chain-agnostic —
but it splits the project across two chains for a narrative loss on the Hedera side. This
approach keeps everything where it is.

---

## 3. The Graph now has two distinct roles — do not conflate them

This is the one genuine cost of the change, and it is a clarity cost rather than a
technical one. State it explicitly in the README and the demo video:

| Role | What it is | Authority |
| --- | --- | --- |
| **The Graph as the resource** | Live Subgraph data, block-pinned, sold per query through the x402 gate | The thing being bought |
| **The Graph as the memory** | Our subgraph over `CommonBudget` events, read through `MemoryReader` | Discovery and history only — **never** spending authority |

One sentence for the submission: *"The Graph is both what our agents buy and how they
remember buying it."*

The authority rule from Phase 0 is unchanged and still absolute: **an empty or lagging
index never authorizes a purchase.** Only the contract reservation does.

---

## 4. The flow

```
Agent A needs on-chain data
  │
  ├─ SpendingAdapter.reserve()      -> CommonBudget on Hedera, atomic
  │                                    a competing agent gets PURCHASE_PENDING here
  ├─ executePayment()               -> x402 exact, Blocky402, real HBAR on Hedera
  ├─ paid-service                   -> queries a live Subgraph at a PINNED BLOCK
  │                                    via the Graph gateway with an API key
  ├─ result stored                  -> freshness + capability metadata
  ├─ recordSettlement / recordDelivery -> CommonBudget events
  └─ decision note                  -> HCS topic, linked by decision id

Agent B needs the same data
  │
  ├─ MemoryReader.findPurchases()   -> our subgraph over CommonBudget events
  │                                    finds A's purchase: paid, delivered, usable, fresh
  ├─ contract reservation check     -> MANDATORY, the Graph is not authority
  ├─ reuses A's result              -> no second payment
  └─ records a reuse decision       -> event + HCS note

Later
  └─ an agent avoids a result whose recorded outcome said it was unsuitable
```

---

## 5. Where everything lives

| Layer | Location | Changed? |
| --- | --- | --- |
| Budget ledger, atomic reservation | `CommonBudget`, Hedera testnet `0x7a6a1edE510692F5f6208733fD849833Fd86A893`, chain 296, start block 40352293 | **No** |
| Payments | x402 `exact` + Blocky402, Hedera — real HBAR | **No** |
| Decision audit trail | HCS topic `0.0.10465595` | **No** |
| **The paid resource** | **Live Subgraph via the Graph gateway, block-pinned** | **Yes — this is the change** |
| Memory / discovery | Subgraph over `CommonBudget` + `packages/graph-client` | No (still to be built) |
| Natural-language access | Subgraph MCP over Common's memory | New, optional, strengthens both tracks |

---

## 6. Determinism — a property we must not lose

`apps/paid-service` currently generates datasets with a seeded PRNG **on purpose**. From
`docs/PAYMENT_ARCHITECTURE.md`:

> *"Datasets are deterministic, so two agents buying the same key provably receive
> identical bytes — which is what makes reuse verifiable rather than asserted."*

That property is real and must survive. Live subgraph data changes between queries, so it
would be lost — except that subgraph GraphQL accepts a block constraint:

```graphql
{ pools(block: { number: 12345678 }, first: 10) { id totalValueLockedUSD } }
```

A block-pinned query is byte-identical forever. So determinism is **restored, and on
better footing than before**: reproducible from public chain state that anyone can
re-query, rather than from a seeded generator a reviewer has to trust.

**Consequence:** `purchaseKey` becomes block-scoped. Today it is date-scoped
(`hedera-mirror:daily-transfers:2026-09-10:workspace-1`); it becomes something like
`thegraph:<subgraph>:<query>:<blockNumber>:<workspace>`. The block number is the correct
cache key — same block, same bytes, safe to reuse; different block, a genuinely different
resource.

---

## 7. What did NOT change

Checked deliberately, because the value of this change depends on it being small.

**All eight MVP checklist items** in `docs/BUILD_PLAN.md` stand unmodified, including
item 5, which already read *"let the second agent discover and reuse the result through
live Graph queries."*

**The definition of success** stands unmodified. It never specified what the resource was.

**Shared interfaces:** `SpendingAdapter`, `MemoryReader`, `ResultStore`, `Purchase`,
`DecisionRecord`, `Money` — **zero changes** from this decision. (The separate Phase 0
proposals in `docs/workstreams/aditya.md` §5 are still open and unrelated to this.)

**The architecture diagram** in the root README is unchanged — same boxes, same arrows.

**Ownership, the demo storyboard, and all of Kavish's safety properties** are unchanged.
No contract redeploy. No ABI change. All 50 of his unit tests unaffected.

Deviation is concentrated entirely in what `paid-service` returns.

---

## 8. Sponsor alignment

The two tracks now describe the same mechanism, which is the point.

**The Graph — Best AI Use Case (From Scratch).** The Graph is the agent's source of
blockchain data; queries are live through the gateway with an API key; the agents do real
work with it — buy-vs-reuse decisions, avoiding recorded-unsuitable results, and producing
a deliverable. The track's own description reads *"let your agent pay per query
autonomously with x402"*, which is now literally the system.

**Hedera — AI & Agentic Payments.** Unaffected and arguably improved. The x402-gated
service stays on Hedera through Blocky402, the paid request is real, HCS carries the audit
trail. The track's idea list includes *"Metered data feed. Price by query, settle per
request, no seats or subscriptions"* — which is exactly what this becomes.

We do not claim eligibility merely because a subgraph exists. See §9 for what is still
missing.

---

## 9. Open items

**Blocks track eligibility:**

1. **Host `apps/paid-service` publicly.** It runs on `localhost:3002` today, and that is
   recorded on-chain in all 40 `PurchaseReserved` logs. A judge cannot reach it. The
   Hedera track says *"**Host** a live x402-gated service."* — Kavish.
2. `datasets.ts` queries a live Subgraph, block-pinned — Kavish, patch prepared by Aditya.
3. Graph gateway API key — Aditya.
4. An agent produces a real deliverable from the queried data, so the reasoning is over
   the data and not only over purchase metadata — Rudra.
5. Repository made public before submission — lead's call; the root README already flags
   this.
6. Demo videos. The Graph wants 2–4 minutes, Hedera wants 5 or under.

**Still open from Phase 0, unrelated to this change:**

7. `Outcome.capabilities` is not on chain, so a Graph-backed reader returns none and the
   reuse gate rejects every candidate. Options in `docs/workstreams/aditya.md` §5 P1.
8. `deniedRequests` is structurally unindexable — a denial is a revert, which emits no
   log, and `trace_filter` is unimplemented on the relay.
9. Successful reuse must mean a completed deliverable, not an intention to reuse.

**Aditya's build, blocked by nothing:** subgraph schema and mappings, matchstick tests,
`MemoryReader`, live gateway queries, MCP layer.

---

## 10. Who does what

| Owner | Change |
| --- | --- |
| **Kavish** | 2 small edits in `apps/paid-service`, env updates, host the service. No contract change, no redeploy. See `docs/KAVISH_IMPLEMENTATION.md` |
| **Aditya** | Subgraph + mappings + tests, `graph-client` `MemoryReader`, live gateway query module consumed by `paid-service`, MCP layer |
| **Rudra** | Agents use the queried data to produce a deliverable; decide where `capabilities` live; record acceptance in `docs/DECISIONS.md` |
