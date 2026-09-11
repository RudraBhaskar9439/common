# Payment architecture — as built

**Scope:** the money layer — `contracts/`, `packages/hedera-adapter/`, `apps/paid-service/`, `infra/`.
**Owner:** Kavish. **Status:** implemented and verified on Hedera testnet.

This documents what changed from the Phase 0 plan, why, and how the system actually works.
`docs/ARCHITECTURE.md` remains the whole-system draft; this supersedes it for the payment
layer only. Evidence and reproduction steps are in `docs/workstreams/kavish-evidence.md`.

---

## 1. The change, in one paragraph

The plan assumed a smart contract would **hold the workspace budget and gate every
payment**, making overspending impossible by construction. That is not achievable on
Hedera's x402 payment path. Settlement is a bare `TransferTransaction`, and the scheme
specification forbids wrapping it or invoking any contract, so nothing can sit between a
signer and the funds. Enforcement therefore moved off-chain: **agents hold no keys and
cannot construct or sign a transfer**, and a single payment module signs only against an
active on-chain reservation whose bound parameters match the transfer exactly. The
contract remains the authoritative, atomic ledger for budget accounting and duplicate
prevention, and the event source for the subgraph — but it is a ledger, not a vault.

---

## 2. What the plan assumed, and what is true

| Planned | Actual |
| --- | --- |
| The contract holds the budget | The contract records an accounting allocation; it holds no funds |
| A payment cannot happen without contract approval | A payment is a signed transfer; the contract is never consulted |
| Overspending is impossible by construction | Agents cannot spend at all; one custodial module can, only against a matching reservation |
| Enforcement is trustless | Enforcement is custodial and bounded, and stated as such |

**What did not change:** competing agents produce exactly one purchase, budget accounting
and duplicate prevention are atomic and on-chain, crash and retry never double-pay, and
every decision is publicly auditable. The demo is unaffected.

---

## 3. Why — the evidence

From the x402 Hedera `exact` scheme specification:

1. The client signs a **partially signed `TransferTransaction`**. It must be a
   `TransferTransaction` *directly* — wrapping it in a `ScheduleCreateTransaction` or
   anything else is forbidden.
2. It must contain **only the transfers needed for the payment**. No other operations.
3. **Smart contract calls are not supported.** Only direct token transfers.
4. `transactionId.accountId` must equal the facilitator's `feePayer`, so the facilitator
   pays gas and adds the final signature.
5. The facilitator **cannot alter `payTo` or `amount`** — both are covered by the client's
   signature, and verification must reject any deviation.

Points 1–3 are what remove the contract from the payment path. There is no hook, no
callback, no approval step.

---

## 4. Alternatives considered

### Contract-held treasury with an approved allowance — **blocked**

The most attractive repair. Hedera supports allowances (HIP-336): an owner approves a
capped amount to a spender, who then moves funds without the owner signing each time. A
contract-held treasury issuing a capped per-operation allowance would give a genuinely
on-chain spending cap.

Two mandatory rules collide:

- **Hedera allowances:** the spender must be the transaction fee payer, or the transfer
  fails with `SPENDER_DOES_NOT_HAVE_ALLOWANCE`.
- **x402 Hedera `exact`:** `transactionId.accountId` must equal the facilitator's
  `feePayer`.

One slot, two claimants. **Approved-allowance transfers cannot be combined with a
third-party x402 facilitator on Hedera.** The scheme also never mentions the approval
flag, so even a willing facilitator would be in unspecified territory.

### Self-hosted facilitator, then allowances — **rejected on risk**

The conflict dissolves if we run the facilitator, because facilitator, fee payer and
spender become one service. Blocky402 is open source and documented for self-hosting.

Rejected because it removes the independent third party — we would be signing, verifying
and settling our own payments — weakens the sponsor integration from "paid through
Blocky402" to "ran our own copy", and adds a second deployment that must stay alive
during the demo. Documented as the upgrade path if a hard on-chain cap is ever required.

### Two-of-two threshold key — **designed, deferred**

The treasury account's key becomes a `KeyList` requiring two signatures: one from the
orchestrator, one from a policy service. Neither can spend alone, so a compromised
orchestrator still cannot move funds. Hedera supports this natively and the facilitator
validates against the account's on-chain key, so it is enforced cryptographically.

Deferred for scope. It adds key handling, an SDK dependency and a co-sign failure mode to
another owner's module, and inserts an extra round trip into the payment path. The
guarantee it buys — that no single service can spend alone — is invisible in the demo and
outside both sponsors' criteria. **The swap touches no interface, event or contract**, so
it remains available.

### Separate signer process — **rejected on operational risk**

Keeps the treasury key out of the orchestrator's deployment, which is cleaner for the
ownership split, but costs a second deploy target that must stay alive and adds
"signer unreachable mid-payment" to the money path. Not worth it on testnet with a
bounded float.

**Chosen:** single custodial signer, running in-process as a library.

---

## 5. How it works, as built

```
agent
  │  holds no key, cannot sign anything
  ▼
SpendingAdapter.reserve()
  │
  ▼
CommonBudget contract ──────────── atomic: checks authorization and budget,
  │                                claims the purchase key, or reverts
  │                                A competing agent gets PURCHASE_PENDING here.
  ▼
SpendingAdapter.executePayment()
  │  re-reads the chain; refuses unless the reservation is live AND
  │  paramsHash matches recipient, amount, asset and resource exactly
  ▼
paid-service ──── HTTP 402 + PAYMENT-REQUIRED (price, asset, payTo, feePayer)
  │
  ▼
payment module ── builds a TransferTransaction, transactionId.accountId = facilitator,
  │               signs with the treasury key, sends as PAYMENT-SIGNATURE
  ▼
Blocky402 ─────── /verify, then /settle: adds its signature, pays gas, submits
  │
  ▼
Hedera ────────── transfer settles; receipt returned as 0.0.x@seconds.nanos
  │
  ▼
contract ──────── recordSettlement (real transaction id)
  │               recordDelivery   (separate outcome)
  │               recordDecision   (after the HCS note publishes)
  ▼
HCS topic ─────── the agent's reasoning, linked by decision id
```

**On uncertainty**, the branch after `/settle` is the one that matters:

```
outcome unclear (timeout, unreadable reply, missing receipt)
  ▼
contract: flagSettlementUnknown      <- written BEFORE returning, so a crash
  │                                     here still leaves the operation blocked
  ▼
release refused · purchase key stays claimed · repayment refused
  ▼
reconcile() against the mirror node, bounded by the reservation timestamp
  ├── found     -> recordSettlement with the real transaction id
  ├── absent    -> releaseAfterReconciliation (only after the window closed)
  └── inconclusive -> stay stuck. Never release, never repay.
```

---

## 6. What was implemented

### `contracts/` — `CommonBudget`

Workspace creation and funding (an accounting allocation), agent authorization, atomic
reservation, the operation lifecycle, and decision records. Ten events for the subgraph.

Key design points:

- **`reserve` is the atomicity boundary.** One indivisible state transition claims a
  purchase key, so two competing agents cannot both succeed.
- **`paramsHash` binds an operation** to its workspace, purchase key, amount, asset,
  recipient and resource. Reusing an operation id with any conflicting term reverts.
  This is what makes retries safe across crashes and restarts.
- **`release` and `expire` are reachable only from states where no transfer was
  submitted.** `SettlementUnknown` can do neither — a stuck operation stays visibly stuck
  until reconciled. This is the single most important rule in the contract.
- **Delivery is separate from payment.** `recordDelivery(usable: false)` records the
  failure without refunding, freeing the claim, or permitting an automatic repurchase.
- **Lazy expiry.** A competing reservation expires a lapsed claim and takes it, so no
  keeper process is required.

Toolchain: Hardhat, deliberately outside the root npm workspaces so root dependencies are
untouched. `viaIR` enabled because `reserve` takes ten arguments; this does not change the
ABI.

### `apps/paid-service/` — the x402 gate

The resource being bought. Unpaid requests get a real HTTP 402 with full payment
requirements; paid requests are verified and settled through Blocky402 before any content
is returned. Holds no keys and signs nothing.

The important design point is the **certainty boundary**. A failure at or before `/verify`
means nothing was submitted, and is reported as `settlementCertainty: "none"` — safe to
retry. **Any** failure once `/settle` has been called reports `"unknown"`, because the
facilitator may already have submitted the transfer. This includes plain network errors,
which was originally a bug: only a typed `FacilitatorError` triggered uncertainty, so a
real timeout fell through to a generic 500 and would have invited a retry.

Datasets are deterministic, so two agents buying the same key provably receive identical
bytes — which is what makes reuse verifiable rather than asserted.

### `packages/hedera-adapter/` — the paying side

- `payments/transfer.ts` — builds the partially signed transfer to the scheme's rules, and
  refuses self-transfers or a fee payer that is us or the recipient.
- `payments/x402-client.ts` — the 402 loop, plus the certainty boundary described above.
  Refuses to pay a recipient, asset or amount that does not match the reservation.
- `contracts/budget-client.ts` — typed contract calls, `paramsHash` computation, and
  post-failure diagnosis (see §8).
- `reconciliation/mirror-node.ts` — the only way out of unknown settlement.
- `hcs/decision-notes.ts` — decision notes, with a retry that cannot reach payment.
- `adapter.ts` — `SpendingAdapter` plus `reconcile` and `recordDelivery`.

### `infra/` — operations

Health check (five read-only pre-demo checks), live verification (eleven checks against
the real services), failure drills (eleven, against the real contract), and the runbook.

---

## 7. Safety properties, and what enforces each

| Property | Enforced by |
| --- | --- |
| An agent cannot spend | It holds no key and has no signing path. Structural |
| Two agents produce one purchase | Contract: atomic `reserve` |
| Budget cannot be exceeded | Contract: committed + spent checked against budget |
| A payment matches its reservation | Adapter: `paramsHash` compared before signing |
| A retry never double-commits | Contract: same id + same params is a no-op |
| A crash never double-pays | Stable operation ids; uncertainty written before returning |
| Uncertainty never becomes a payment | Contract refuses release; reconciliation refuses to guess |
| Delivery failure never repurchases | Contract: `DeliveryFailed` keeps the claim and the payment |
| An HCS retry never replays payment | The publisher imports no payment code. Structural |
| Loss is bounded | Treasury holds a float; per-operation and hourly ceilings |

**Two of these are structural rather than enforced by a check** — an agent cannot spend
because it has no key, and an HCS retry cannot pay because that module cannot reach
payment code. Structural guarantees are preferable: they cannot be bypassed by a bug in
the check.

---

## 8. Design decisions worth knowing

**Reconciliation is bounded by the reservation timestamp.** Matching on
`(payer, payTo, amount)` alone adopts an earlier identical payment — and paying the same
seller the same price is the normal case, not an edge case. Without the bound, a stuck
operation could be marked paid when it never was. Found by the failure drills on their
first run, after three successful live payments and a full unit suite had missed it.

**Inconclusive is a first-class outcome.** An unreachable mirror node or a still-open
validity window returns `inconclusive`, never `absent`. Treating "not found yet" as
"never happened" is precisely how a double payment occurs.

**Notes publish before the contract event.** The two writes are not atomic. This order
means a contract failure orphans a harmless published note; the reverse would emit an
event with an empty sequence number and permanently break the link.

**Failures are diagnosed by reading the chain.** Hedera's JSON-RPC relay does not reliably
return decodable custom-error data, so a correct on-chain rejection surfaces as
`execution reverted (unknown custom error)`. After a failure, the client reads
`activeClaim`, `isAgentAuthorized`, `availableBudget` and the stored `paramsHash` to
establish the real cause. The contract remains the authority — this only explains a
failure that already happened, so no race is introduced.

**Stubs exist only in tests.** No production code path has a mock, a fallback, or a
fake-success mode. Stubs force conditions the real services will not produce on demand — a
facilitator that hangs, a mirror node that vanishes — and every behaviour they cover is
also verified against live services.

---

## 9. What is not enforced

Stated plainly, because these are stronger as declared limitations than as omissions.

1. **This is custodial.** Whoever holds the treasury key can spend the float. No trustless
   gate exists on this payment path.
2. **The contract cannot attest that a payment happened.** It records what the operator
   tells it. The receipt and the mirror node are the independent evidence.
3. **An HCS note is a claim, not proof.** A consensus timestamp attests when it was
   written, not that it is true.
4. **Graph reads never authorize spending.** An empty or lagging index is not permission to
   buy; only the contract reservation is.
5. **The facilitator is trusted for liveness, not integrity.** It cannot change `payTo` or
   `amount`, but it can stall, drop or submit late.

---

## 10. Interface changes

All additive — nothing previously compiling breaks.

| Change | Purpose |
| --- | --- |
| `reconcile(operationId)` | The only exit from unknown settlement |
| `recordDelivery(...)` | Delivery as an outcome separate from payment |
| `retryDecisionNotes()` | Republish failed HCS notes; cannot reach payment |
| `Reservation.expiresAt` | When an absent transfer becomes conclusive |
| `PaymentReceipt.transactionId` | Documented as Hedera's `0.0.x@seconds.nanos` |

**One genuine gap for the team:** `ReserveInput` carries no `payTo` or `resource`, so the
adapter takes a `resolveResource(purchaseKey)` function at construction and the provider
catalogue lives there. It works, but it belongs in the shared interface.

---

## 11. Hedera and x402 gotchas

Findings that cost real debugging time and are not obvious from the documentation.

1. **The `exact` scheme forbids contracts in the payment path.** Any design assuming an
   on-chain spending gate must be rethought.
2. **Allowances cannot be combined with a third-party facilitator.** Both require the same
   fee-payer slot.
3. **The payment payload must be the v2 shape**, with an `accepted` field carrying the full
   `PaymentRequirements`. Omitting it returns an opaque `500 Payment verification failed`,
   not a validation error. A 500 from a verifier usually means a missing field.
4. **Blocky402 returns the receipt as `transaction`, not `transactionId`.** Reading only
   the spec's name loses the receipt and sends a successful payment down the
   reconciliation path unnecessarily.
5. **The JSON-RPC relay does not return decodable custom-error data.** Read chain state
   after a failure to establish the cause.
6. **Reconciliation needs a lower time bound**, or it adopts earlier identical payments.
7. **Only one chain-writing script at a time.** They share an EVM account and collide on
   the nonce.
8. **The reference implementation beats inference.** One wrong guess — that
   `freezeWith(client)` produced an invalid multi-node transaction — cost a debugging
   cycle. The `@x402/hedera` reference signer does exactly that and sets no
   `setNodeAccountIds`.
