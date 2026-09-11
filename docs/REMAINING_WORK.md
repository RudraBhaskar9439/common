# What is left

**As of 2026-09-12**, branch `workstream/aditya-graph`, 11 commits ahead of `main`.
Written by Aditya. Context: `NEW_ARCHITECTURE.md`. Evidence: `workstreams/aditya-evidence.md`.

Status values: **DONE** means verified with evidence linked. **TODO** means not started or
not finished. Nothing here is marked done on the strength of a mock.

---

## 0. The one-line summary

The Graph read layer is finished and proven against live data. The money layer is finished
and proven on testnet. **The two have never been run together.** Everything remaining is
integration plus two logistics items that teams routinely lose prizes to.

---

## 1. Critical path — the end-to-end run has never happened

This is the single biggest risk and it is not a coding problem. Every component is verified
in isolation; the demo storyboard has never executed once.

Concretely, today:

- `apps/orchestrator/src/demo.ts` still imports `@common/mocks`
- `packages/result-store` still throws `NOT_IMPLEMENTED`
- **no on-chain operation has ever used a block-scoped `purchaseKey`** — all 40 on chain
  are from the old date-scoped era

So *"agent A buys live Graph data → agent B discovers it in the index → reuses it → both
finish"* is unproven. Until it runs once, we do not know what breaks.

**Do this before polish, before the video, before anything optional.**

| Step | Owner | Status |
| --- | --- | --- |
| Host `paid-service` publicly, update `RESOURCE_URL` | Kavish | TODO |
| Implement `result-store` (put/get with workspace isolation) | Rudra | TODO |
| ~~Decide where `capabilities` live~~ | — | **RESOLVED** — derived from the payload, §2.1 |
| Point the orchestrator at live adapters instead of mocks | Rudra | TODO |
| Agent produces a deliverable from the purchased data | Rudra | TODO |
| Run one full operation with a block-scoped `purchaseKey` | Kavish + Rudra | TODO |
| Verify the indexed purchase appears and is reusable | Aditya | waiting |

---

## 2. DONE — the Graph read layer

| Item | Evidence |
| --- | --- |
| Subgraph schema + 10 event handlers | `graph codegen` + `graph build` pass, WASM compiles |
| 19 matchstick tests | reuse path, unusable delivery, unknown settlement→reconciled, all three release reasons, both duplicate shapes, placeholder settlement, orphaned events, unfunded workspace, two assets |
| **`graph-node` v0.45.0 syncs Hedera testnet** | `synced: true, health: healthy`, 40394976/40394976 |
| **Indexed counters reconcile with the raw event log** | 14 / 40 / 6 / 8 — exact match to an independent fold computed before the subgraph existed |
| Duplicate settlement caught automatically | rediscovered `0.0.7162784@1789069246.329605799 ×2` from live data; spend 400M vs raw 450M |
| `MemoryReader` client, 23 tests | keyset pagination, honest index lag, per-asset integer money, typed transport errors |
| **HCS rationale verified live** | 8/8 identifiers re-hash to the indexed `bytes32`, against the real topic |
| **Live Graph gateway** | 11/11 checks, real Uniswap V3 mainnet data, byte-identical at a pinned block |
| **MCP server, 13 unit + 11 live** | real stdio handshake, 5 read-only tools, rationale verified through the full chain |
| **Capabilities derived from the payload** | `assessDelivery` inspects the purchased bytes. Caught two false claims in our own datasets — see §2.1 |

```
npm run check:all   ->  10 + 18 + 36 + 13 + 17 = 94 tests, 0 failures
subgraph            ->  19 matchstick tests
gateway:check       ->  11/11 live, both datasets
graph-mcp live      ->  11/11 over stdio
```

### 2.1 Two false capability claims, found by deriving instead of asserting

"Avoid a dataset whose recorded outcome says it lacks a capability" is theatre if
capabilities are a list the seller writes. Deriving them from the delivered bytes caught
two of our own:

- **`daily-transfers` advertised `historical-data` and contained none.** `poolDayDatas`
  ordered by `date` returns the most recent day across *thirty different pools* — 30 rows,
  one date. Verified directly: `distinct dates: 1 | distinct pools: 30`. Filtered to a
  single pool, the 30-day series is real.
- **`pool-liquidity` was named `token-holders` and advertised `holder-distribution`**,
  which Uniswap pool data has never contained. Both inherited from the synthetic version.

Both now overclaim nothing. The paid response reports observed capabilities with evidence,
alongside the seller's advertised list, so the two can be compared.

**The distinction this turns on:** delivery usability is objective and buyer-independent —
did well-formed, non-empty data arrive — and that is what `recordDelivery` carries.
Suitability is per-buyer, checked against the observed list. Marking a delivery unusable
because one buyer wanted a missing field would hide a good result from every later agent
that wanted something else.

## 3. DONE — the money layer (Kavish)

Contract, x402 payments, HCS notes, failure drills. See `PAYMENT_ARCHITECTURE.md` and
`workstreams/kavish-evidence.md`. Independently re-verified by Aditya: contract deployed,
all 10 event types have real logs, 8 real payments totalling 400,000,000 tinybar confirmed
against the mirror node.

---

## 4. TODO — Kavish

| # | Task | Why it matters |
| --- | --- | --- |
| 4.1 | **Host `paid-service` at a public URL**, then update `RESOURCE_URL` | **Blocking.** The Hedera track requires *"Host a live x402-gated service"*. All 40 on-chain reservations currently advertise `http://localhost:3002/...`, which a judge cannot reach. `infra/deploy/` exists |
| 4.2 | Review the two edits to `apps/paid-service` | Written and passing; see `KAVISH_IMPLEMENTATION.md` §3. Small review |
| 4.3 | Answer: is the duplicated settlement a pre-fix artifact, and does the fixed path normalise the id form? | Decides whether canonicalisation is defence in depth or a live correction |
| 4.4 | Run one operation with a block-scoped `purchaseKey` | The new key shape has never existed on chain |
| 4.5 | Refresh `contracts/README.md` — `ReservationReleased` now has 24 logs | It still says none |
| 4.6 | Keep two invariants: `recordSettlement` requires `amount == op.amount`, `recordDelivery` requires `Paid` | The mappings rely on strict per-operation ordering |

Optional, if time: a workspace settling in two assets, and a `DecisionRecorded` with
`decisionType` 0/2/3 — all six on chain today are `reuse`.

## 5. TODO — Rudra

| # | Task | Why it matters |
| --- | --- | --- |
| 5.1 | ~~Decide where `capabilities` live~~ | **RESOLVED.** No interface decision left: capabilities are derived from the payload by `assessDelivery` in `@common/graph-client` and belong with the stored result. Call it in the agent and pass the outcome to `recordDelivery` |
| 5.2 | **Implement `packages/result-store`** | Currently throws. Nothing can store or retrieve a purchased result |
| 5.3 | **Wire the orchestrator to live adapters** | `demo.ts` still imports `@common/mocks` |
| 5.4 | **Make an agent produce a deliverable from the data** | The Graph track requires *"meaningful work… not just printing a raw query result."* Payload inspection (§2.1) is now real work on the data, but an agent should still produce an answer a person would want — e.g. a capital-efficiency ranking computed from the purchased bytes |
| 5.5 | Review the shared-interface proposals in `workstreams/aditya.md` §5 (P1–P7) and record acceptance in `DECISIONS.md` | Interfaces are still a Phase 0 draft |
| 5.6 | Note two root changes made by Aditya | `README.md` link list, and `package.json` gained `test:modules` / `check:all` — module tests existed but no single command ran them, so a passing `check` said nothing about 69 of them |
| 5.7 | Coordinate the lockfile | `graph-client` added `ethers`; `graph-mcp` added `@modelcontextprotocol/sdk` + `zod`, ~1000 lines |

**Also for Rudra, not a proposal:** `findReusablePurchase` checks
`purchase.result?.workspaceId === query.workspaceId`. Against a Graph-backed reader that is
**tautological** — the field is derived from the operation's own indexed workspace, and the
query already filters by it. It is not an authorization boundary. `ResultStore` must enforce
access on read.

## 6. TODO — Aditya (me)

| # | Task | Status |
| --- | --- | --- |
| 6.1 | ~~Capability derivation and payload validation~~ | **DONE.** §2.1 |
| 6.2 | Verify the indexed purchase after the first live end-to-end run | Waiting on §1 |
| 6.3 | Multi-query aggregation, so the price reflects real seller cost | Optional but recommended — it is what makes *"why would anyone pay for public data?"* answer itself. See §10 |
| 6.4 | Publish the memory subgraph to a public endpoint | Optional. Goldsky hosts Hedera; same artifact, one CLI command. Removes `localhost` from the demo |
| 6.5 | Phase 5 handoff docs | Largely done in the module READMEs and `SKILL.md` |

## 7. TODO — team / submission

| # | Task | Why |
| --- | --- | --- |
| 7.1 | **Make the repository public** | Both tracks require a public repo. `README.md` already flags this and says do not publish automatically |
| 7.2 | **Two demo videos** | The Graph wants 2–4 minutes, Hedera wants 5 or under. One 4-minute cut satisfies both limits |
| 7.3 | **Rotate the Graph API keys** | Three passed through a chat transcript during setup |
| 7.4 | Pick the pinned block **at demo time**, not in advance | `gateway:check` defaults to `head − 1000` so the block is final and cannot age out of a pruning window. Do not hardcode `GRAPH_PINNED_BLOCK` |

---

## 8. Track eligibility

### The Graph — Best AI Use Case (From Scratch)

| Requirement | Status |
| --- | --- |
| The Graph as a load-bearing source of blockchain data | **Met** — live Subgraph data is the resource agents buy, and the memory they consult |
| *"Consume live data from a Graph provider… mocked, local-only, or static do not qualify"* | **Met** — live queries via Studio API key against the decentralized network, 11/11 verified |
| *"Do meaningful work… not just printing a raw query result"* | **Partial** — reuse reasoning and the MCP layer are done; §5.4 is the gap |
| Public repo + 2–4 min video | **TODO** — §7.1, §7.2 |
| Start Fresh pool | **Met** — net-new |

Our own Hedera subgraph is self-hosted, and that is fine: the **qualifying** live Graph
integration is the Studio-backed paid query path, not the memory index. Worth stating
plainly in the README so a judge does not mistake the local `graph-node` for our Graph
integration.

### Hedera — AI & Agentic Payments

| Requirement | Status |
| --- | --- |
| *"**Host** a live x402-gated service… settled through Blocky402"* | **Blocked on §4.1** — built and working, but on `localhost` |
| One real paid request end to end | **Met** — 8 real testnet payments confirmed on the mirror node |
| Public repo + README covering the payment flow | **TODO** — §7.1 |
| Demo video ≤5 min | **TODO** — §7.2 |
| Extra: verifiable audit trail on HCS | **Met** — topic `0.0.10465595` |

---

## 9. What we will not claim

- **No mainnet money is used anywhere.** Payments are testnet HBAR; Ethereum mainnet is
  read-only through The Graph, with no wallet, transaction or gas. Say this plainly rather
  than let a viewer assume either way.
- **The contract is a ledger, not a vault**, and enforcement is custodial. Kavish's
  `PAYMENT_ARCHITECTURE.md` §9 states the limits; repeat them in the submission.
- **Graph reads never authorize spending.** An empty or lagging index is not permission to
  buy.
- **A subgraph existing is not prize eligibility.** §8 is the checklist.
- **`successfulReuses` counts intention, not completion.** Nothing on chain says an agent
  finished its task after choosing to reuse.
- **`deniedRequests` is unindexable** — a denial reverts and emits no logs, and trace
  methods are unimplemented on the Hedera relay.

---

## 10. Why would anyone pay for public data?

Worth having an answer ready, because a judge will ask.

**They are not paying for the bytes, they are paying for metered access without a
subscription.** Graph queries cost money beyond 100,000/month. An agent holds no credit
card, no Graph account and no API key; the service holds one. Both sponsors describe
exactly this — Hedera: *"paying for it without an API key or a subscription in sight"*;
The Graph: *"let your agent pay per query autonomously with x402"*.

And Common's value does not depend on the resource being expensive. It depends on it being
*paid* and *repeatable*: two agents duplicating a cheap query still waste budget and quota,
and the contract's exactly-one-purchase guarantee matters identically.

**Where it is thin, and the fix.** Using a public subgraph invites *"why not query it
yourself?"*, and one query has near-zero marginal cost. §6.3 fixes that: sell a derived
answer that costs the seller real quota — a ranking across fifty pools burns fifty pinned
queries. Then the price reflects incurred cost, reuse saves something measurable, and the
Phase 4 "avoided purchase cost" metric has real numbers instead of an invented figure.
