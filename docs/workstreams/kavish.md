# Kavish workstream — Hedera, payment enforcement, deployment

Owner: Kavish. Scope: `contracts/`, `packages/hedera-adapter/`, `apps/paid-service/`, `infra/`.

Status legend: **VERIFIED** (checked against official docs or a run command), **PROPOSED** (needs team acceptance), **PENDING** (needs credentials or another component).

---

## Phase 0 — Validate the payment architecture

### 0.1 Baseline checks

| Command | Result |
| --- | --- |
| `npm install` | 15 packages, 0 vulnerabilities |
| `npm run check` (typecheck + build + test) | pass, 10/10 interface tests |

`tsc` is unavailable until `npm install` runs; a fresh clone must install first.

Inspected: `packages/interfaces/src/index.ts`, `packages/mocks/src/index.ts`, `apps/orchestrator/src/demo.ts`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/INTERFACES.md`, `docs/DECISIONS.md`, module READMEs. All four of my paths are `.gitkeep` stubs; `createHederaSpendingAdapter()` throws `NOT_IMPLEMENTED` and submits nothing.

### 0.2 Current `SpendingAdapter` and operation states

Draft states: `reserved → payment_pending → settlement_unknown | paid → delivered | delivery_failed`, plus `released` and `expired`. The draft is sound in shape. Gaps found, all addressed below: no binding of an operation to its resource/amount/token/recipient, no expiry field on `Operation`, no reconciliation entry point, and `release()` has no precondition preventing release during `settlement_unknown`.

### 0.3 VERIFIED: how x402 actually settles on Hedera

Sources: the x402 v2 core spec, the Hedera `exact` scheme spec, and Blocky402's facilitator.

1. The resource server answers an unpaid request with **HTTP 402** and a `PAYMENT-REQUIRED` header: Base64 `PaymentRequirements` carrying `scheme`, `network`, `amount`, `asset`, `payTo`, `maxTimeoutSeconds`, and `extra.feePayer`.
2. The client builds a **direct Hedera `TransferTransaction`**, freezes it, signs it with the payer account's key, and returns it Base64-encoded in `PAYMENT-SIGNATURE`.
3. The transaction is **partially signed**: `transactionId.accountId` must be the *facilitator's* account (`extra.feePayer`), so the facilitator pays gas and adds the final signature.
4. The resource server calls the facilitator's `POST /verify`, then `POST /settle`, and returns the outcome in `PAYMENT-RESPONSE` with a Hedera `transactionId` of the form `0.0.account@seconds.nanos`.

Constraints the spec states explicitly:

- The transaction **MUST NOT** be wrapped in a `ScheduleCreateTransaction` or anything else, and **MUST** contain only the transfers needed for the payment.
- Net HBAR sum and net asset sum across transfers must each be zero.
- Assets are **HBAR** (`0.0.0`, tinybars) or any **HTS fungible token** in its smallest unit.
- The facilitator **cannot alter `payTo` or `amount`** — verification must reject any deviation, and the facilitator must fetch the payer's onchain key to validate the signature.
- **Smart contract calls are not supported.** Only direct token transfers.

Blocky402 is an open x402 facilitator supporting Hedera testnet and mainnet, ECDSA keys, the `ExactHederaScheme`, with testnet open access and no API key.

### 0.3b VERIFIED LIVE: Blocky402 testnet facilitator supports Hedera

`GET https://api.testnet.blocky402.com/supported`, run 2026-09-11 via
`apps/paid-service` → `npm run supported`. No API key required.

```json
{ "x402Version": 2, "scheme": "exact", "network": "hedera:testnet",
  "extra": { "feePayer": "0.0.7162784" } }
```

`signers` additionally reports `"hedera:*": ["0.0.7162784"]`. Polygon Amoy
(`eip155:80002`) and Solana devnet are also served; Hedera is the one we use.

This closes the Phase 0 compatibility question: the hosted facilitator is live for
Hedera testnet, the scheme identifier is `exact`, the network identifier is exactly
`hedera:testnet`, and the fee payer is `0.0.7162784`. That fee payer must equal
`transactionId.accountId` on every payment transaction we build — re-check it with
`npm run supported` rather than hardcoding, since the facilitator may rotate it.

### 0.3c PHASE 1 GATE CLEARED: a real x402 payment settled on Hedera testnet

Executed 2026-09-10 via `packages/hedera-adapter` → `npm run pay:once` with
`CONFIRM_REAL_PAYMENT=yes`, against `apps/paid-service` running locally.

| Field | Value |
| --- | --- |
| Transaction ID | `0.0.7162784-1789067662-127260536` |
| Result | `SUCCESS` |
| Consensus timestamp | `1789067671.746448104` |
| Payer (treasury) | `0.0.10463485` − 50,000,000 tinybars |
| Recipient (seller) | `0.0.10463575` + 50,000,000 tinybars |
| Facilitator gas | `0.0.7162784` − 265,634 tinybars |
| Explorer | https://hashscan.io/testnet/transaction/0.0.7162784-1789067662-127260536 |

The facilitator paid the network fee and submitted, exactly as the `exact` scheme
specifies, and could not alter `payTo` or `amount` because both are covered by our
signature.

**Two bugs found on the way, both worth recording:**

1. The payment payload was built in the **x402 v1** shape. v2 requires an `accepted`
   field carrying the full `PaymentRequirements`; without it the facilitator returns an
   opaque `500 Payment verification failed` rather than a validation error. A 500 from a
   verifier means a missing field, not a bad value.
2. A guess that `freezeWith(client)` produced an invalid multi-node transaction was
   **wrong** — the `@x402/hedera` reference signer uses exactly that and sets no
   `setNodeAccountIds`. Reverted. Read the reference implementation before theorising.

**The recovery path was exercised for real, unplanned.** Three attempts ran: two
classified `failed` (verification rejected, nothing submitted) and one
`settlement_unknown` (the facilitator settled but our receipt-field mapping missed the
transaction id, so the client refused to claim a payment it could not evidence). The
mirror node shows **exactly one** transfer. No double payment occurred, and
reconciliation against the mirror node resolved the unknown case to paid.

This is the strongest evidence in the workstream: the safety rules are not aspirational,
they held against a real failure with real value moving.

### 0.4 The architecture this invalidates

> **A reservation contract cannot enforce spending on this path.** Because settlement is a bare `TransferTransaction` signed by the payer's key and submitted by the facilitator, no contract sits between the signer and the funds. Any holder of the payer key can pay any `payTo` for any amount and skip our contract entirely. A reservation contract on this path is **advisory accounting, not onchain enforcement**, and we must not describe it as enforcement in the README, demo or submission.

### 0.5 PROPOSED: where enforcement actually goes

Enforcement moves to the layer that *is* on the critical path — the **signature** — using a Hedera account key that requires two signatures.

**Control model.** The workspace treasury is a Hedera account whose key is a `KeyList` with `threshold = 2`:

- **Agent-side key** — held by the orchestrator's payment client, per workspace.
- **Policy key** — held only by the Common policy signer, a service inside `packages/hedera-adapter` that no agent can call directly except through `SpendingAdapter`.

A partially signed `TransferTransaction` is only valid once **both** keys have signed, and the facilitator validates the payer's signature against that onchain key. The policy signer refuses to co-sign unless, in one atomic step, it can show:

- the operation ID has an **active reservation** in the contract,
- the transaction's `payTo`, `amount`, `asset` and `resource` **match the reservation's bound parameters byte-for-byte**,
- the reservation has not expired, and the agent is currently authorized under the live policy.

This gives a real, checkable property: **a compromised or misbehaving agent key cannot move funds alone.** That is cryptographic, not advisory.

**What the contract is still for.** It remains the authoritative, atomic ledger for budget and duplicate prevention — the thing that makes two competing agents produce exactly one purchase — and the event source Aditya indexes. Its guarantee is atomicity of reservation, not custody of funds.

### 0.5b VERIFIED: alternatives considered, and why

I did not stop at the first workable design. Three routes exist; two are blocked by a hard protocol conflict.

**Option B — contract-held treasury spending via an approved allowance.** The most attractive option on paper. Hedera supports allowances (HIP-336): an owner approves a capped amount to a spender, and the spender then moves funds using an *approved* transfer without the owner signing each time. If the treasury were a contract account granting a capped per-operation allowance, the cap would be **genuinely enforced onchain** — exactly the property the original plan wanted.

**It is blocked.** Two mandatory rules collide head-on:

- Hedera allowances: *"the transaction fee payer for the `TransferTransaction` is required to set the spender account ID as the transaction fee payer. If the spender account ID is not set as the transaction fee payer, the system will error with `SPENDER_DOES_NOT_HAVE_ALLOWANCE`."*
- x402 Hedera `exact`: *"Have `transactionId.accountId == extra.feePayer` from the `PaymentRequirements`. This ensures the facilitator's account is the fee payer at the network level."*

The spender must be the fee payer; the scheme requires the facilitator to be the fee payer. They cannot both hold that slot. **Approved-allowance transfers are therefore incompatible with a third-party x402 facilitator on Hedera.** The scheme also never mentions `isApproval` at all, so even a facilitator willing to try it is in unspecified territory.

**Option C — self-host the facilitator, then use allowances.** The conflict dissolves if *we* are the facilitator, because facilitator, fee payer and spender collapse into one service we run. Blocky402 is open source and documented for self-hosting via Docker or Node. This is the only route to a real onchain spending cap.

Its cost is the reason I am not defaulting to it: the facilitator stops being an independent third party. We would be signing, verifying and settling our own payments, so the "independent verification" property disappears, and the sponsor-facing story becomes "we ran our own copy of Blocky402" rather than "we paid through Blocky402." It also puts gas, uptime and a second deployment target on my plate during a 10-day build.

**Recommendation: Option A now, Option C documented as the upgrade path.** Option A (§0.5) works against the hosted Blocky402 testnet facilitator with no API key, keeps the sponsor integration genuine, and still gives a real cryptographic property — one signature alone cannot spend. If we later want a hard onchain cap and can afford to self-host, Option C is the way, and nothing in §0.7's state machine or §0.9's events has to change to get there.

Unverified: HIP-336's page returned 403, so contract-account-as-allowance-owner specifics are unconfirmed. That only matters if we take Option C, and I would verify it before committing.

### 0.5c DECIDED: custody model and where the signer runs

**Option A′ — single custodial signer, running in-process as a library.**

The treasury key is held by the payment module in `packages/hedera-adapter`, imported by the orchestrator. Rejected alternatives and why:

- **Full Option A (2-of-2 key)** — rejected for scope. Adds key handling, an SDK dependency and a co-sign failure mode to Rudra's orchestrator, and inserts an extra round trip into the payment path. The guarantee it buys ("no single service can spend alone") is invisible in the demo and outside both sponsors' judging criteria. Documented as the upgrade path; the swap touches no interface, event or contract.
- **Separate signer process** — rejected for operational risk. It keeps the treasury key out of the orchestrator's deployment, which is cleaner for the ownership split, but it costs a second deploy target that must stay alive during the demo and adds "signer unreachable mid-payment" to the money path. Not worth it on testnet with a bounded float.

**Consequence to state honestly:** the treasury key is an environment secret in whichever deployment runs the orchestrator. The README must say *"the orchestrator's payment module holds the treasury key"*, not *"a separate service does"*.

**Rudra's total exposure:** one secret environment variable. No signing code, no Hedera SDK, no interface change. `SpendingAdapter` is unchanged.

### 0.5d Security model for the paying module

The blast radius is bounded by design, not by trust in the host.

1. **The treasury holds a working float, not the budget.** The contract's budget is an accounting number and not spendable; only the treasury account's balance can actually leave. Compromise costs the float, which we size to the demo plus margin and top up.
2. **No arbitrary payment path exists.** The module exposes no "pay this recipient" call. Recipient, amount and asset come from the on-chain reservation, and the module refuses to sign unless the transfer matches the reservation's `paramsHash` exactly.
3. **Caps enforced before signing**, independent of the contract: `TREASURY_FLOAT_LIMIT` per operation and `WORKSPACE_HOURLY_LIMIT` per workspace-hour.
4. **The key never enters code, logs, fixtures, error messages or an AI agent's context.** Config carries `POLICY_SIGNER_KEY_REF`, a reference, never the value.
5. **Theft is visible immediately.** Every payment has a reservation, receipt and transaction ID; contract accounting disagreeing with the mirror node is exactly what reconciliation already detects.
6. **Revocation without redeploy.** De-authorising agents and halting new reservations are operator calls on the contract.

**Not defended:** host compromise takes the float. No fix exists on this path — the contract cannot custody funds (x402 forbids it), and the two-key split is deliberately deferred. Acceptable because the float is bounded and the loss is visible.

### 0.6 Trust assumptions (state these in the submission verbatim)

1. **The policy signer is trusted custody.** It holds the policy key. Compromising that service plus an agent key moves funds. We reduce, not eliminate, custody risk.
2. **Enforcement is threshold-key + service policy, not contract-mediated custody.** The Hedera `exact` scheme forbids contract calls, so no trustless onchain gate is available on this path.
3. **The facilitator is trusted for liveness and gas, not for integrity.** It cannot change `payTo` or `amount` (spec-enforced, signature-covered), but it can stall, drop, or submit late — which is exactly what produces `settlement_unknown`.
4. **Contract writes and HCS writes are not atomic.** An HCS note is ordering evidence and a claim; it is not proof the explanation is true, and never proof of payment.
5. **Graph reads never authorize spending.** An empty or lagging index is not permission to buy.
6. **Replay protection is ours to own.** The scheme mandates no nonce; it only bounds validity with `maxTimeoutSeconds`. We bind idempotency to the operation ID and to the transaction's validity window.
7. **`transactionId.accountId` is the facilitator, not us** — so receipt lookup must match on our transfer, not on payer identity alone.

### 0.7 PROPOSED: state machine, expiry, policy change, reconciliation

States and the only permitted transitions:

```
reserved ──────────► payment_pending ──► paid ──► delivered
   │                       │              │  └───► delivery_failed
   │                       ├──► settlement_unknown ──► paid | released
   │                       └──► released  (verified never-submitted only)
   ├──► released  (explicit, pre-submission)
   └──► expired   (deadline passed, pre-submission)
```

Rules:

- `released` and `expired` are reachable **only** from a state where we have positive evidence that no transaction was submitted. `settlement_unknown` therefore cannot expire — a stuck operation stays stuck and visible until reconciled. This is the single most important safety rule in my scope.
- `paid` and `delivered` are **separate outcomes**. `delivery_failed` records the failure against a real receipt and **never** triggers automatic repurchase; recovery is a new, explicitly authorized decision.
- **Expiry** is set at reserve time (`expiresAt`), and must be strictly greater than the x402 `maxTimeoutSeconds` window plus a settlement-observation margin, so a reservation cannot lapse while a signed transaction is still submittable. Expiry near settlement resolves toward `settlement_unknown`, never toward release.
- **Policy change**: an in-flight reservation keeps the policy snapshot it was reserved under (recorded as a `policyVersion`), but the policy signer re-checks authorization at co-sign time. So a revoked agent cannot spend an old reservation, while a legitimate in-flight payment is not destroyed by an unrelated budget edit. The next *new* reservation obeys current policy.
- **Reconciliation**: on `settlement_unknown`, query the Hedera mirror node for a transfer matching `(payTo, amount, asset)` inside the reservation's validity window. Found → `paid` with the real receipt. Provably absent *after the validity window has closed* → `released`. Otherwise stay `settlement_unknown`. Reconciliation is idempotent and safe to run repeatedly; it is the only path out.

**Operation binding.** `reserve()` must bind `operationId` to `{ purchaseKey, amount, tokenId, payTo, resource }`. Re-presenting an operation ID with any conflicting parameter is rejected with a typed error — this is what makes retries safe across restarts.

### 0.8 PROPOSED: interface changes to review

Additive, so nothing currently compiling breaks:

- `Operation`: add `expiresAt`, `policyVersion`, and a bound `payTo`/`resource` descriptor.
- `SpendingAdapter`: add `reconcile(operationId): Promise<Operation>`, and document that `release()` throws on `settlement_unknown`.
- `PaymentReceipt`: `transactionId` needs the Hedera `0.0.x@sec.nanos` format documented, plus optional `network` (CAIP-2, e.g. `hedera:testnet`) and `settledAt`.
- `ErrorCode`: add `CONFLICTING_PARAMETERS`, `RESERVATION_EXPIRED`, `POLICY_CHANGED`, `DELIVERY_FAILED`, `FACILITATOR_UNAVAILABLE`.

### 0.9 PROPOSED: contract events (for Aditya)

Draft signatures; I will freeze and export the ABI in Phase 1 before he writes mappings.

```solidity
event WorkspaceFunded(bytes32 indexed workspaceId, address token, uint256 amount, uint64 policyVersion);
event AgentAuthorized(bytes32 indexed workspaceId, bytes32 indexed agentId, bool authorized, uint64 policyVersion);
event PurchaseReserved(bytes32 indexed workspaceId, bytes32 indexed operationId, bytes32 indexed purchaseKey,
                       bytes32 agentId, uint256 amount, address token, uint64 expiresAt, uint64 policyVersion);
event PaymentSettled(bytes32 indexed operationId, string transactionId, uint256 amount, uint64 settledAt);
event DeliveryRecorded(bytes32 indexed operationId, bool usable, uint64 freshUntil, string resultRef, string failureReason);
event ReservationReleased(bytes32 indexed operationId, uint8 reason); // 0 explicit, 1 expired, 2 reconciled-absent
event DecisionRecorded(bytes32 indexed workspaceId, bytes32 indexed decisionId, bytes32 agentId,
                       uint8 decisionType, bytes32 operationId, string hcsSequenceNumber);
```

Two questions for Aditya before freeze: **(a)** `bytes32` IDs with a documented hashing rule, or raw strings for query ergonomics? **(b)** Who may emit `DecisionRecorded` for a `reuse` decision — the orchestrator directly, or only the policy signer? Reuse decisions create no payment, so this is an authority question, not a money question.

### 0.10 Who can move funds — the honest answer

| Actor | Can move workspace funds? |
| --- | --- |
| An agent | **No.** Holds no key; calls tools only. |
| Orchestrator (agent-side key) | **No, alone.** One of two required signatures. |
| Policy signer (policy key) | **No, alone.** One of two required signatures. |
| Orchestrator **+** policy signer | Yes — this is the intended path, and it requires a matching active reservation. |
| Blocky402 facilitator | **No.** Cannot change `payTo` or `amount`; can only submit, stall or drop. |
| Whoever holds both keys | Yes. This is assumption 1 and the residual custody risk. |

### 0.11 Smallest real testnet experiment

Deliberately minimal, so a failure has one cause. Ordered, each step gated on the last:

1. Create two Hedera **testnet** accounts and a treasury account with a 2-of-2 `KeyList`. Confirm the threshold key is what the mirror node reports.
2. Stand up `apps/paid-service` with one dataset route returning HTTP 402 and a correct `PAYMENT-REQUIRED` header. Assert the header round-trips before any money moves.
3. Query Blocky402 testnet `/supported` to confirm the live scheme and network identifiers rather than assuming them.
4. **Smallest possible HBAR transfer** (tinybars) — not USDC — as the first paid request, so the first live attempt does not also depend on HTS association.
5. Only then repeat with the HTS test token, which additionally requires token association on both accounts.
6. Capture: the 402 response, the signed payload, verify/settle responses, the mirror-node record for the transaction ID, and the final `PAYMENT-RESPONSE`.

Requires your explicit authorization before any transaction is submitted. Until then I build against a local fake facilitator, clearly labeled.

### 0.12 Configuration names (names only, never values)

`packages/hedera-adapter`: `HEDERA_NETWORK`, `HEDERA_OPERATOR_ACCOUNT_ID`, `HEDERA_MIRROR_NODE_URL`, `COMMON_CONTRACT_ADDRESS`, `COMMON_CONTRACT_START_BLOCK`, `HCS_TOPIC_ID`, `BLOCKY402_FACILITATOR_URL`, `POLICY_SIGNER_KEY_REF`, `WORKSPACE_TREASURY_ACCOUNT_ID`, `PAYMENT_ASSET_ID`, `PAYMENT_ASSET_DECIMALS`, `RESERVATION_TTL_SECONDS`, `SETTLEMENT_OBSERVATION_MARGIN_SECONDS`.

`apps/paid-service`: `PORT`, `BLOCKY402_FACILITATOR_URL`, `HEDERA_NETWORK`, `PAY_TO_ACCOUNT_ID`, `PRICE_AMOUNT`, `PRICE_ASSET_ID`, `MAX_TIMEOUT_SECONDS`, `FACILITATOR_FEE_PAYER_ACCOUNT_ID`.

`POLICY_SIGNER_KEY_REF` is a **reference** to a key in the local keystore or environment-injected secret — never the key itself. No private key enters this repository, its logs, its fixtures, or an AI agent's context.

### 0.13 Phase 0 exit gate

| Gate item | Status |
| --- | --- |
| Controlled payment path technically explicit | **Met** — §0.3, §0.5 |
| Unresolved compatibility documented | **Met** — §0.4: contract-mediated custody is impossible on this path; enforcement relocated to a threshold key |
| Trust assumptions explicit | **Met** — §0.6 |
| Event/interface requirements drafted | **Met** — §0.8, §0.9, pending Aditya and Rudra review |
| Testnet experiment defined | **Met** — §0.11, execution **PENDING** your authorization |

Open items for the team: interface additions in §0.8 (Rudra), event shape and the two questions in §0.9 (Aditya), and acceptance of §0.5 as the enforcement model (all three, to be recorded in `docs/DECISIONS.md` by the lead).
