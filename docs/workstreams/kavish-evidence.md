# Kavish — evidence and handoff

Phase 5 deliverable. Everything a judge, teammate or reviewer needs to verify the money
layer without running it, plus what to run if they want to.

Owner: Kavish. Scope: `contracts/`, `packages/hedera-adapter/`, `apps/paid-service/`, `infra/`.

---

## Identifiers

| Item | Value |
| --- | --- |
| Network | Hedera testnet, chain id `296` |
| `CommonBudget` contract | `0x7a6a1edE510692F5f6208733fD849833Fd86A893` |
| Contract start block | `40352293` |
| HCS decision topic | `0.0.10465595` |
| Treasury (payer) | `0.0.10463485` |
| Seller (payee) | `0.0.10463575` |
| Facilitator | Blocky402, `https://api.testnet.blocky402.com`, fee payer `0.0.7162784` |
| Price | 50,000,000 tinybars (0.5 HBAR) per dataset |

Explorer links:
- Contract — https://hashscan.io/testnet/contract/0x7a6a1edE510692F5f6208733fD849833Fd86A893
- Decision notes — https://hashscan.io/testnet/topic/0.0.10465595

The facilitator's fee payer can rotate. Confirm it with
`cd apps/paid-service && npm run supported` rather than trusting this table; a mismatch
fails every payment with an opaque 500, and `live-verify` checks for exactly that.

---

## Payment receipts

Real x402 payments settled on Hedera testnet through Blocky402. Each moved 0.5 HBAR from
the treasury to the seller, with the facilitator paying gas.

| Transaction id | What it evidences |
| --- | --- |
| `0.0.7162784-1789067662-127260536` | First real payment. Proved the x402 `exact` path end to end |
| `0.0.7162784@1789069246.329605799` | First full linked operation: reservation, payment, receipt, event |
| `0.0.7162784@1789073145.346612118` | Full operation with the first published HCS decision note (sequence 1) |
| `0.0.7162784@1789073600.680467509` | Final verification run, HCS decision note sequence 2 |

The first is shown in mirror-node form (`-`), the others in the scheme's receipt form
(`@`). Same identifier, different rendering.

Verify any of them:
```
https://hashscan.io/testnet/transaction/<id>
```

Each payment moved exactly 50,000,000 tinybars from `0.0.10463485` to `0.0.10463575`,
with `0.0.7162784` paying the network fee — the fee split the `exact` scheme specifies.

---

## Final verification run

Complete sweep against the live network. Every suite passed.

| Suite | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | clean | whole workspace |
| `contracts` unit tests | **20/20** | reservation logic, local in-memory chain |
| `paid-service` unit tests | **13/13** | the x402 gate |
| `hedera-adapter` unit tests | **17/17** | reconciliation and decision notes |
| `health-check.ts` | **5/5** | treasury at 98,487,108,518 tinybars (~984 HBAR) |
| `live-verify.ts` | **11/11** | real paid service, real facilitator, real mirror node, real topic |
| `failure-drills.ts` | **9/9** | failure paths, no payment |
| `failure-drills.ts` (paid) | **11/11** | adds the two drills requiring a real payment |
| `run:operation` (paid) | pass | the demo command, end to end |

**Totals: 50 unit tests, 27 live checks and drills, 2 real payments.**

### The demo command's output, verbatim

Workspace `demo-workspace-1789073544816`:

```
agent A reserved        reserved, expires 2026-09-10T21:53:12Z
agent B REJECTED        PURCHASE_PENDING      <- exactly one purchase
payment                 paid, 0.0.7162784@1789073600.680467509
delivery recorded       usable
agent B reuse decision  event 0xcdf06dc3..., hcs confirmed, sequence 2
result                  1 payment, 2 deliverables
budget remaining        450,000,000 of 500,000,000 tinybars
```

The payment resolved directly from the facilitator's receipt — no reconciliation needed
on the happy path, which is the correct division of labour.

### Drill workspaces

| Workspace | Drills |
| --- | --- |
| `drill-workspace-1789073658901` | 9, no payment |
| `drill-workspace-1789073972630` | 11, including both paid drills |

Both generated `ReservationReleased` with all three reason codes — 0 explicit, 1 expired,
2 reconciled-absent — which is the last event type the subgraph previously lacked.

---

## What each claim is backed by

| Claim | Evidence |
| --- | --- |
| Two agents racing produce exactly one purchase | On-chain `PURCHASE_PENDING` rejection in every `run:operation` and drill run |
| An agent cannot spend | Agents hold no key; the contract's `onlyOperator` gates every state change |
| A real payment settles through the intended x402 path | The three transaction ids above |
| Uncertainty never becomes a second payment | Drills: release refused, key stays claimed, reconciliation resolves |
| Payment and delivery are separate | Drill: delivery failure keeps the payment, frees nothing, triggers no repurchase |
| Decisions are auditable | Contract `DecisionRecorded` + HCS note sharing one decision id |

---

## Reproducing it

Two terminals. Nothing here needs a key except the last two, which spend testnet HBAR.

```bash
# terminal 1 — the resource being bought
cd apps/paid-service && npm start

# terminal 2
npm run typecheck
cd contracts && npm test                 # 20 — reservation logic, local chain
cd ../apps/paid-service && npm test      # 13 — the x402 gate
cd ../../packages/hedera-adapter && npm test  # 17 — reconciliation and decision notes

cd ../..
npx tsx infra/scripts/health-check.ts    # 5  — pre-demo readiness
npx tsx infra/scripts/live-verify.ts     # 11 — against the real services
npx tsx infra/scripts/failure-drills.ts  # 9  — failure paths, no payment
```

With payments (0.5 HBAR each, testnet):

```powershell
cd packages/hedera-adapter
$env:CONFIRM_REAL_PAYMENT="yes"; npm run run:operation; Remove-Item Env:\CONFIRM_REAL_PAYMENT

cd ../..
$env:CONFIRM_REAL_PAYMENT="yes"; npx tsx infra/scripts/failure-drills.ts; Remove-Item Env:\CONFIRM_REAL_PAYMENT
```

**Always clear the flag in the same line.** An exported shell variable persists across
commands and has already turned an intended dry run into a live one.

**Run one chain-writing script at a time.** `failure-drills`, `run:operation`, `pay:once`
and `create:topic` all send transactions from the same EVM account, so running two
concurrently fails with `nonce has already been used`. Observed once during the final
sweep, when a drill run overlapped an operation run; the retry succeeded immediately. This
is a relay artefact, not a contract rejection — no state was written by the failed attempt.

`health-check` and `live-verify` read only and are safe to run at any time, including
during a demo.

**Totals:** 50 unit tests, 11 live checks, 5 health checks, 11 failure drills.

---

## Test doubles policy

Stubs exist only in `tests/`, never in `src/`, and only to force conditions the real
services will not produce on demand — a facilitator that hangs mid-settlement, a mirror
node that vanishes. Every behaviour they cover is also verified against live services in
`infra/scripts/live-verify.ts`.

**No production code path has a mock, a fallback, or a fake-success mode.** Unit tests
prove logic; they prove nothing about Hedera. The transaction ids above are the evidence
for that.

---

## Trust assumptions

State these plainly. They are stronger as stated limitations than as omissions.

1. **This is custodial.** Whoever holds `HEDERA_PRIVATE_KEY` can spend the treasury float.
   Hedera's x402 `exact` scheme forbids contracts in the payment path, so no trustless
   on-chain gate is available. Agents cannot spend; one controlled module can, and only
   against a matching reservation.
2. **The contract is a ledger, not a vault.** It holds no funds and cannot enforce that a
   payment happened. `fundWorkspace` records an accounting allocation and moves no value.
   Its real guarantee is atomicity: exactly one reservation per purchase key.
3. **Blast radius is bounded by the float.** The treasury holds a working balance, not the
   budget, and per-operation and per-workspace ceilings are enforced before signing.
   Host compromise costs the float, and the loss is immediately visible on-chain.
4. **The facilitator is trusted for liveness, not integrity.** It cannot alter `payTo` or
   `amount` — both are covered by our signature and the spec requires rejection of any
   deviation — but it can stall, drop or submit late. That is what produces unknown
   settlement.
5. **Contract and HCS writes are not atomic.** Notes publish first so a contract failure
   orphans a harmless note rather than breaking the link.
6. **An HCS timestamp attests when, not whether.** A note is an agent's claim. The receipt
   and the observed delivery are the evidence.
7. **Graph reads never authorize spending.** An empty or lagging index is not permission
   to buy. Only the contract reservation is.

---

## Known limitations

- **HBAR only.** The transfer builder supports HTS fungible tokens but only HBAR is
  tested, and HTS additionally requires token association on both accounts. Mirror-node
  reconciliation reads HBAR transfers only. Relatedly, reported token decimals are
  correct for HBAR (8) and would need the real value supplied per asset before any HTS
  token is used — amounts are carried as integers in the smallest unit, so this affects
  display, never what is actually paid.
- **Bound parameters are in-memory.** The contract stores one-way hashes, so a local
  registry remembers the originals. After a restart, `executePayment` for an in-flight
  operation throws `NOT_FOUND` and the operation must be re-driven with its original
  input. Contract state is unaffected — nothing is lost or double-paid. A persisted
  `OperationRegistry` fixes this; durable state ownership is Rudra's call.
- **No global pause.** Spending stops by revoking agent authorization, which applies to
  the next reservation, or by stopping the process holding the key.
- **The provider catalogue lives in the adapter.** `ReserveInput` carries no `payTo` or
  `resource`, so `resolveResource(purchaseKey)` is passed at construction. It works, but
  it belongs in the shared interface. Raised with the team.
- **Two-key custody deferred.** Splitting the treasury key across two signatures was
  designed and deliberately deferred; the swap touches no interface, event or contract.

---

## Hedera-specific gotchas worth knowing

Findings that cost real debugging time and are not obvious from the documentation.

1. **The x402 `exact` scheme forbids contracts in the payment path.** Settlement is a bare
   `TransferTransaction`; the spec forbids wrapping it and permits no contract calls. Any
   design assuming an on-chain spending gate has to be rethought.
2. **Allowances cannot be combined with a third-party facilitator.** Spending an allowance
   requires the spender to pay the network fee; x402 requires the facilitator to pay it.
   One slot, two claimants.
3. **The payment payload must be the v2 shape.** It needs an `accepted` field carrying the
   full `PaymentRequirements`. Omitting it returns an opaque `500 Payment verification
   failed`, not a validation error. A 500 from a verifier usually means a missing field.
4. **Blocky402 returns the receipt as `transaction`, not `transactionId`.** Reading only
   the spec's field name loses the receipt and sends a successful payment down the
   reconciliation path for no reason.
5. **The JSON-RPC relay does not return decodable custom-error data.** A correct on-chain
   rejection surfaces as `execution reverted (unknown custom error)` even with the error
   declared in the ABI. Read chain state after a failure to establish the real cause.
6. **Reconciliation needs a lower time bound.** Matching on `(payer, payTo, amount)` alone
   adopts an earlier identical payment. Paying the same seller the same price is the
   normal case, so this bound is required for correctness, not an edge case.

---

## Handoffs

**Aditya** — `contracts/README.md` has the full event table, transaction hashes and open
questions. All 10 event types now have real logs. `DecisionRecorded.hcsSequenceNumber` is
populated when a note publishes; earlier logs carry `""`, which is not a data error.

**Rudra** — `packages/hedera-adapter/README.md` has config, worked examples for a normal
operation and a reconciliation, every typed error with what to do about it, and restart
behaviour. `SpendingAdapter` is unchanged from the Phase 0 draft; `reconcile`,
`recordDelivery` and `retryDecisionNotes` are additive.

**Operations** — `infra/README.md`: bring-up, redeploy, pause and revoke, recovering a
stuck operation.
