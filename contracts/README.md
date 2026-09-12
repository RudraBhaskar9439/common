# contracts

**Current evaluation deployment:** `0x94FFc923123107EDB3aCAa3C9ba19cc09CF681fe`, block 40425744, bytecode verified against the expiry-fixed source. [Live evidence](../docs/evidence/live-evaluation-2026-09-12.json) records one genuine evaluation payment and delivery. The older address and dataset receipts below are historical. `prepare:testnet` configures the evaluation workspace idempotently without seed settlements. Follow [the runbook](../docs/ENVIRONMENT.md).

**Owner:** Kavish

`CommonBudget` — workspace budget authority and atomic reservation ledger, and the event source for the subgraph.

## What this contract is, and is not

It **is** the authoritative atomic ledger for budget accounting and duplicate prevention. Two agents racing for the same `purchaseKey` produce exactly one reservation.

It **does not hold funds and cannot enforce that a payment happened.** The x402 `exact` scheme on Hedera settles as a direct `TransferTransaction`; the spec forbids wrapping it or invoking a contract in the payment path, so no contract can sit between a signer and the funds. `fundWorkspace` records an accounting allocation — it moves no value.

Enforcement is off-chain: agents hold no key and cannot sign a transfer, and the operator's payment module signs only against an active reservation whose `paramsHash` matches the transfer exactly. That is trusted custody, stated plainly. See `docs/workstreams/kavish.md` §0.4–0.6.

## Toolchain

Hardhat, deliberately **outside** the root npm workspaces with its own `package.json`, so root dependencies and `package-lock.json` are untouched. Hedera exposes an EVM JSON-RPC relay, so standard Hardhat tooling applies.

`viaIR` is enabled: `reserve` takes 10 arguments and overflows the legacy pipeline's stack. This does not change the ABI.

```bash
cd contracts
npm install
npm test        # 20 tests, local in-memory chain, no credentials needed
npm run build
npm run abi     # writes abi/CommonBudget.json
```

Deployment needs `HEDERA_EVM_PRIVATE_KEY` and optionally `HEDERA_JSON_RPC_URL` in the environment. Never commit a key.

```bash
npm run deploy:testnet   # prints address, startBlock, chainId
```

## Safety properties covered by tests

| Property | Test group |
| --- | --- |
| Two agents racing produce exactly one reservation | atomic reservation |
| Budget is committed on reserve, so a concurrent request sees it as unavailable | atomic reservation |
| Unauthorized agents and non-operator callers are rejected | atomic reservation |
| A retry with the same operation ID does not commit budget twice | retry safety |
| The same operation ID with conflicting parameters is rejected | retry safety |
| Unknown settlement cannot be released | unknown settlement |
| Unknown settlement cannot expire, and keeps the purchase key claimed | unknown settlement |
| Budget returns only after reconciliation proves the transfer absent | unknown settlement |
| Delivery failure does not refund, free the claim, or authorize a repurchase | payment vs delivery |

These run on a local in-memory chain. **They prove the reservation logic, not Hedera enforcement or payment behavior.**

## Handoff to Aditya — deployed and seeded

| Field | Value |
| --- | --- |
| Network | Hedera testnet |
| Chain ID | `296` |
| Contract address | `0x7a6a1edE510692F5f6208733fD849833Fd86A893` |
| Start block | `40352293` |
| ABI | `contracts/abi/CommonBudget.json` |
| Seed transactions | `contracts/abi/seed-transactions.json` |
| Explorer | https://hashscan.io/testnet/contract/0x7a6a1edE510692F5f6208733fD849833Fd86A893 |

The contract is seeded with one complete lifecycle, so every event type below except
`SettlementUnknownFlagged` and `ReservationReleased` already has a real log to index.

Seeded scenario — workspace `keccak256("workspace-1")`, purchase key
`keccak256("hedera-mirror:daily-transfers:2026-09-10:workspace-1")`:

| Step | Transaction | Event |
| --- | --- | --- |
| createWorkspace | `0xb1ea9506e409c21e033fa4513030d06e68abb5583e1982e446ec463737d1853f` | `WorkspaceCreated` |
| fundWorkspace | `0x28299cff00ff32c7c1d4860061c25e3d125ba997344a58d9cfc161a3e0c397cd` | `WorkspaceFunded` |
| authorize agent A | `0xef11dce9187b1582b12248a8a14333923613130d3190afbf6c0671780b125b81` | `AgentAuthorized` |
| authorize agent B | `0xfb5c011f0386a7ff9b65fa8c7f2674aff03be523632124501c1a0a8d2f4c42d3` | `AgentAuthorized` |
| agent A reserves | `0x24160d61f47e8002b3a0c64dcbebc2c33109a20c00a632f0ffc62502c109b35a` | `PurchaseReserved` |
| **agent B reserves** | **reverted** | `PurchaseAlreadyReserved` — no event, by design |
| markPaymentPending | `0x619dc800c5f279126d3f2a4702475029a5fdf66644630d04523eb620438a63bc` | `PaymentPending` |
| recordSettlement | `0xfad152fd75041238a8f4a597900d6abe2199c3b8889b11087196865ac6b6ce7d` | `PaymentSettled` |
| recordDelivery | `0x749c7a889fde8f1757f7fd3b74933dead86ec48d388b165e5f101f65b5768d9c` | `DeliveryRecorded` |
| agent B records reuse | `0x98b0114440ae3bd11c5000fae65b27e23e4d43f00749f036ac96b9d51d45c575` | `DecisionRecorded` |

> **The seeded `PaymentSettled` carries the placeholder transaction id
> `SEED-PLACEHOLDER-not-a-real-payment`. No money moved.** It exists so the indexer has
> a log to read. Do not present the seeded event as payment evidence.

Re-seed a fresh scenario with `npm run seed:testnet` (submits real transactions).

### Prefer these: real operations with genuine payments

The same contract now carries complete operations driven by the adapter, where
`PaymentSettled` holds a **real Hedera transaction id**. Index these in preference to the
seeded ones.

| Workspace | Payment transaction id | Notes |
| --- | --- | --- |
| `demo-workspace-1789069182855` | `0.0.7162784@1789069246.329605799` | Clean run: reserved, competitor rejected, paid, delivered, reuse decision |
| `demo-workspace-1789068849025` | recorded via reconciliation | Settlement was uncertain, then resolved from the mirror node |

Both were produced by `packages/hedera-adapter` → `npm run run:operation`. Each run creates
a fresh workspace and purchase key, so generating more indexable data is one command.

Worth knowing for the mappings: real settlement ids have the form `0.0.x@seconds.nanos`.

`demo-workspace-1789068849025` is the interesting one for the demo narrative — it emitted
`SettlementUnknownFlagged` and was then resolved to `PaymentSettled` by mirror-node
reconciliation rather than by paying twice. So that event has a real log to index.

**`ReservationReleased` is the only event still without a log.** It fires on explicit
release, expiry, or a reconciled-absent transfer, all of which arrive in Phase 4. Build
the mapping from the ABI; I will point you at real logs once those tests run.

### Events

| Event | Emitted when |
| --- | --- |
| `WorkspaceCreated` | workspace registered |
| `WorkspaceFunded` | budget allocation recorded; carries new `budget` and `policyVersion` |
| `AgentAuthorized` | agent authorization granted or revoked |
| `PurchaseReserved` | a purchase key is atomically claimed; carries `amount`, `asset`, `payTo`, `resource`, `expiresAt` |
| `PaymentPending` | payment execution started |
| `SettlementUnknownFlagged` | settlement outcome unknown; blocks release until reconciled |
| `PaymentSettled` | payment confirmed; carries the Hedera `transactionId` |
| `DeliveryRecorded` | delivery succeeded or failed; carries `usable`, `freshUntil`, `resultRef` |
| `ReservationReleased` | reason `0` explicit, `1` expired, `2` reconciled-absent |
| `DecisionRecorded` | buy/reuse/wait/reject decision; `decisionType` `0` buy, `1` reuse, `2` wait, `3` reject |

A purchase is reusable when `PaymentSettled` is followed by `DeliveryRecorded` with `usable = true` and `freshUntil` in the future.

### Open questions for Aditya

1. **Identifier encoding.** IDs are `bytes32` today, hashed from string identifiers. Raw strings would be friendlier to query but cost more gas and lose the fixed width. Which do the mappings want?
2. **Reuse authority.** Who may emit `DecisionRecorded` for a `reuse` decision? Currently only the workspace operator can. Reuse decisions create no payment, so this is an authority question, not a money question.

## Layout

- `src/CommonBudget.sol` — the contract
- `test/CommonBudget.test.js` — 20 tests, local chain, no credentials
- `script/deploy.js` — deploy, prints the subgraph handoff values
- `script/export-abi.js` — regenerate `abi/CommonBudget.json`
- `script/seed-testnet.js` — seed one full lifecycle as real transactions
- `abi/` — generated but committed: the subgraph depends on it

`artifacts/`, `cache/` and `.env` are git-ignored and regenerable.
