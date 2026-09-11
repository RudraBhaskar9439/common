# infra

**Owner:** Kavish

Local development deployment, health checks and the operational runbook.

Credentials never live here. Every component reads its own `.env`, all of which are
git-ignored. See each module's `.env.example` for the variable names.

## Health check

Read-only. Spends nothing, signs nothing, submits nothing.

```bash
npx tsx infra/scripts/health-check.ts
```

Checks the paid service is up, that it still returns a 402 with payment requirements,
that the facilitator is live for Hedera and which fee payer it currently advertises,
that the treasury holds enough for a payment, and that the contract is deployed and
callable.

**Run this before any demo.** It catches the failures that are embarrassing live: a
stopped service, an unfunded treasury, a rotated facilitator fee payer, or a
rate-limiting RPC relay.

Reads `PAID_SERVICE_URL`, `BLOCKY402_FACILITATOR_URL`, `HEDERA_MIRROR_NODE_URL`,
`HEDERA_JSON_RPC_URL`, `COMMON_CONTRACT_ADDRESS`, `HEDERA_ACCOUNT_ID`. Everything has a
testnet default except the last two, which are skipped when unset.

## Bringing the stack up

Two terminals. The contract is already deployed, so nothing needs building first.

**1. Paid service** — the resource being bought:

```bash
cd apps/paid-service
npm start                 # http://localhost:3002
```

**2. Verify:**

```bash
npx tsx infra/scripts/health-check.ts
```

**3. Run a full operation** — reserve, reject a competitor, pay, deliver, reuse:

```bash
cd packages/hedera-adapter
npm run run:operation     # dry run
```

For a real payment (0.5 testnet HBAR), and always clearing the flag in the same line:

```powershell
$env:CONFIRM_REAL_PAYMENT="yes"; npm run run:operation; Remove-Item Env:\CONFIRM_REAL_PAYMENT
```

## Current testnet deployment

| Item | Value |
| --- | --- |
| Network | Hedera testnet, chain id `296` |
| `CommonBudget` | `0x7a6a1edE510692F5f6208733fD849833Fd86A893` |
| Start block | `40352293` |
| Facilitator | `https://api.testnet.blocky402.com`, fee payer `0.0.7162784` |
| Explorer | https://hashscan.io/testnet/contract/0x7a6a1edE510692F5f6208733fD849833Fd86A893 |

The facilitator's fee payer can rotate. Re-check it with
`cd apps/paid-service && npm run supported` rather than trusting this table.

## Redeploying the contract

Only needed if `CommonBudget.sol` changes. It creates a **new address**, which breaks
Aditya's subgraph until he is given the new address and start block.

```bash
cd contracts
npm run build && npm run abi
npm run deploy:testnet     # prints address, startBlock, chainId
npm run seed:testnet       # optional: seed a lifecycle for indexing
```

Then update `COMMON_CONTRACT_ADDRESS` in `packages/hedera-adapter/.env` and tell Aditya.

## Pausing and revoking

There is no global pause. Spending is stopped by removing authorization, which takes
effect on the next reservation:

```ts
await budget.setAgentAuthorization(workspaceId, agentId, false);
```

In-flight reservations keep the policy snapshot they were created under, so a revoked
agent cannot start new spending while a legitimate in-flight payment is not destroyed.

**To stop everything immediately:** stop the process holding `HEDERA_PRIVATE_KEY`. It is
the only thing that can sign a payment, so nothing can spend without it.

**If the treasury key is exposed:** move the float to a new account, update
`HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`, and restart. Loss is bounded by the float,
which is why the treasury holds a working balance and not the budget.

## Recovering a stuck operation

An operation in `settlement_unknown` blocks release and re-payment by design, and the
contract enforces this. Resolve it, never retry:

```ts
const operation = await adapter.reconcile(operationId);
```

Inconclusive means the mirror node is unreachable or the validity window is still open.
Wait and call again. Do not force it.

To inspect by hand:

```bash
curl "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=<seller>&limit=5"
```

A matching payment shows the treasury debited and the seller credited by the same amount
in one `SUCCESS` transaction.

## Known limitations

- **Custodial.** Whoever holds `HEDERA_PRIVATE_KEY` can spend the treasury float. Hedera's
  x402 `exact` scheme forbids contracts in the payment path, so no trustless gate exists.
- **HCS decision notes are not implemented.** `recordDecision` writes the contract event
  and reports `hcsStatus: 'pending'`.
- **HBAR only.** HTS payments are built but untested and need token association.
- **Bound parameters are in-memory.** A restart requires re-driving an in-flight
  operation; the contract state is unaffected.
