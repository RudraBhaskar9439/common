# hedera-adapter

2026-09-12 recovery update: exact reserved amounts, network and resource are checked before signing. PaymentPending is entered immediately before sending signed bytes. HTTP failures after submission remain uncertain. Reconciliation requires the persisted signed transaction ID; missing mirror data never automatically releases funds. createLiveAdapter accepts an OperationRegistry. PaymentResult now carries optional delivered content. Pending restarts can reconcile. The modified contract expiry check requires a new deployment before claiming it is enforced on testnet. Historical examples below predate these repairs.

**Owner:** Kavish

The paying side of Common. Implements `SpendingAdapter` over the deployed `CommonBudget`
contract and the x402 payment path, and owns settlement reconciliation.

## What protects the money

1. **Agents hold no keys.** They call the five `SpendingAdapter` methods. This module signs.
2. **A payment is only signed against a live reservation** whose bound parameters —
   recipient, amount, asset, resource — match the transfer exactly (`paramsHash`).
   A mismatch is refused, so the signer cannot be redirected by a caller bug.
3. **Uncertainty is recorded on-chain before it is returned.** A crash mid-payment leaves
   the operation blocked, not releasable.
4. **The treasury holds a working float, not the budget.** The contract's budget is an
   accounting number and cannot be spent; only the treasury balance can leave.
5. **A per-operation ceiling** (`MAX_PAYMENT_AMOUNT`) is enforced before signing.

**Trust assumption, stated plainly:** whoever holds `HEDERA_PRIVATE_KEY` can spend the
treasury float. This is custodial. The x402 `exact` scheme on Hedera forbids contracts in
the payment path, so no trustless on-chain gate is available. See `docs/workstreams/kavish.md`
§0.4–0.6.

## Setup

```bash
cp packages/hedera-adapter/.env.example packages/hedera-adapter/.env
```

| Variable | Secret | Meaning |
| --- | --- | --- |
| `HEDERA_NETWORK` | no | `testnet` (default), `mainnet`, `previewnet` |
| `HEDERA_ACCOUNT_ID` | no | Treasury account `0.0.x` that pays |
| `HEDERA_PRIVATE_KEY` | **YES** | Treasury key. Never commit, log or screenshot |
| `COMMON_CONTRACT_ADDRESS` | no | Deployed `CommonBudget` |
| `HEDERA_JSON_RPC_URL` | no | Defaults to Hashio for the network |
| `HEDERA_MIRROR_NODE_URL` | no | Defaults per network; used for reconciliation |
| `MAX_PAYMENT_AMOUNT` | no | Per-operation ceiling in tinybars. Default 1 HBAR |
| `PAY_TO_ACCOUNT_ID` | no | Seller account, used by the scripts |
| `RESOURCE_URL` | no | Resource the scripts buy from |

Current testnet deployment: `0x7a6a1edE510692F5f6208733fD849833Fd86A893`, chain id `296`.

## Using it

```ts
import { createLiveAdapter, singleProviderResolver } from '@common/hedera-adapter';

const adapter = createLiveAdapter(
  singleProviderResolver({
    resource: 'http://localhost:3002/datasets/daily-transfers',
    payTo: '0.0.10463575',
    asset: '0.0.0', // HBAR, tinybars
  }),
);
```

`resolveResource` maps a purchase key to the provider that sells it. Without a binding,
`reserve` refuses — an operation must always know what it is buying, from whom, and for
how much. **This is a known interface gap:** `ReserveInput` carries no `payTo` or
`resource`, so the provider catalogue currently lives here. Worth raising with the team.

### A normal operation

```ts
const money = { amount: '50000000', tokenId: '0.0.0', decimals: 8 };

// 1. Claim the purchase atomically. A competing agent gets PURCHASE_PENDING.
await adapter.reserve({
  operationId: 'op-a-1',      // stable across retries and restarts
  workspaceId: 'workspace-1',
  agentId: 'agent-a',
  purchaseKey: 'provider:daily-transfers:2026-09-10',
  amount: money,
});

// 2. Pay. Re-reads the chain and refuses if the reservation is not live.
const result = await adapter.executePayment({ operationId: 'op-a-1' });

if (result.status === 'paid') {
  // 3. Delivery is a SEPARATE outcome from payment.
  await adapter.recordDelivery({
    operationId: 'op-a-1',
    usable: true,
    freshUntil: new Date(Date.now() + 86_400_000),
    resultRef: 'result-1',
  });
}
```

### Handling each payment outcome

```ts
switch (result.status) {
  case 'paid':
    // result.receipt.transactionId is a real Hedera id: 0.0.x@seconds.nanos
    break;

  case 'failed':
    // Nothing was submitted. Safe to retry with the SAME operationId,
    // or release the reservation.
    await adapter.release('op-a-1');
    break;

  case 'settlement_unknown':
    // The transfer may or may not exist. DO NOT retry and DO NOT release —
    // the contract refuses release in this state anyway.
    // Show the user a waiting state and reconcile.
    const operation = await adapter.reconcile('op-a-1');
    // 'paid'    -> the transfer was found; carry on
    // 'released'-> proven absent after the window closed; budget returned
    // still 'settlement_unknown' -> inconclusive. Wait and call again.
    break;
}
```

`reconcile` is idempotent and safe to call repeatedly. It is the **only** way out of
`settlement_unknown`. It never guesses: an unreachable mirror node or a still-open
validity window returns inconclusive, because treating "not found yet" as "absent" is
exactly how a double payment happens.

### Typed errors

All are `CommonError` with a `code`.

| Code | Cause | What to do |
| --- | --- | --- |
| `PURCHASE_PENDING` | Another operation already claims this purchase key | Wait and reuse its result. Do not buy |
| `INSUFFICIENT_BUDGET` | Uncommitted budget cannot cover the amount, or the amount exceeds `MAX_PAYMENT_AMOUNT` | Surface to the user; do not retry |
| `UNAUTHORIZED` | Agent not authorized, caller is not the operator, operation not reserved, or bound parameters do not match | A real problem. Do not retry blindly |
| `SETTLEMENT_UNKNOWN` | Release attempted while settlement is unknown | Call `reconcile` |
| `NOT_FOUND` | Unknown operation, workspace, or no provider bound to the purchase key | Check the purchase key binding |

### Restart behaviour

Bound parameters live in an in-memory registry, because the contract stores one-way
hashes. **After a restart, `executePayment` for an in-flight operation throws `NOT_FOUND`**
and the operation must be re-driven with its original input. The contract is unaffected —
it still holds the reservation and its status — so nothing is lost or double-paid.

Pass a persisted `OperationRegistry` to survive restarts. Durable state ownership is
Rudra's call; this module does not create a competing database.

## Scripts

```bash
npm run pay:once        # one x402 payment; dry run unless CONFIRM_REAL_PAYMENT=yes
npm run run:operation   # full lifecycle: reserve, reject, pay, deliver, reuse
npm test                # reconciliation tests, no network
```

Both scripts refuse to spend without `CONFIRM_REAL_PAYMENT=yes`. **Clear it in the same
line** — an exported shell variable persists across commands and has already turned an
intended dry run into a live one:

```powershell
$env:CONFIRM_REAL_PAYMENT="yes"; npm run run:operation; Remove-Item Env:\CONFIRM_REAL_PAYMENT
```

## Verified on testnet

| What | Evidence |
| --- | --- |
| Real x402 payment | `0.0.7162784-1789067662-127260536` |
| Full linked operation | `0.0.7162784@1789069246.329605799` |
| Competing reservation rejected | `PURCHASE_PENDING`, on-chain |
| Unknown settlement recovered | Resolved by reconciliation; exactly one transfer, no double payment |

## Not implemented

- **HCS decision notes.** `recordDecision` writes the contract event and returns
  `hcsStatus: 'pending'`. It does not publish to HCS. The status is honest, not a bug.
- **HTS token payments.** The transfer builder supports them, but only HBAR is tested, and
  HTS additionally requires token association on both accounts.
- **HTS reconciliation.** The mirror-node matcher reads HBAR transfers only.

## Layout

- `src/adapter.ts` — `SpendingAdapter` implementation
- `src/contracts/budget-client.ts` — contract calls, revert diagnosis, `paramsHash`
- `src/payments/x402-client.ts` — the x402 loop and settlement certainty
- `src/payments/transfer.ts` — the partially signed Hedera transfer
- `src/reconciliation/mirror-node.ts` — the only way out of unknown settlement
- `src/scripts/` — `pay-once`, `run-operation`
- `tests/`, `evidence/`
