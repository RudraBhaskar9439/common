# paid-service

**Owner:** Kavish

The x402-gated dataset API — the resource Common actually buys. An unpaid request is
refused with HTTP 402 and a full statement of price, asset, recipient and validity
window. A request carrying a signed payment is verified and settled through the
Blocky402 facilitator before any content is returned.

**This service holds no keys and signs nothing.** It states a price and checks payment.
The paying side lives in `packages/hedera-adapter`.

## How the x402 exchange works here

Verified against the x402 v2 specification and the Hedera `exact` scheme spec.

1. `GET /datasets/daily-transfers` with no payment → **402** plus a `PAYMENT-REQUIRED`
   header: base64 JSON carrying `scheme`, `network`, `amount`, `asset`, `payTo`,
   `maxTimeoutSeconds` and `extra.feePayer`.
2. The client builds a Hedera `TransferTransaction`, freezes it, signs it, and retries
   with that transaction base64-encoded in a `PAYMENT-SIGNATURE` header. The transaction
   is *partially* signed: `transactionId.accountId` must equal the facilitator's
   `feePayer`, so the facilitator pays gas and adds the final signature.
3. We call the facilitator's `/verify`, then `/settle`.
4. On success the dataset is returned with a `PAYMENT-RESPONSE` header carrying the
   settlement, including a Hedera transaction id of the form `0.0.x@seconds.nanos`.

The facilitator cannot alter `payTo` or `amount` — the spec requires it to reject any
deviation — but it can stall, drop or submit late. That is why a facilitator error
returns `settlementCertainty: "unknown"` rather than a failure: the transfer may
already have been submitted, so the caller must reconcile rather than retry.

## Setup

```bash
cp apps/paid-service/.env.example apps/paid-service/.env
```

Discover the facilitator's real scheme, network identifier and fee payer — do not guess,
a wrong `feePayer` fails every payment with an opaque error:

```bash
cd apps/paid-service
npm run supported
```

Copy the values into `.env`, set `PAY_TO_ACCOUNT_ID` to the Hedera account that should
receive payment, then:

```bash
npm start          # http://localhost:3002
npm test           # gate logic against a labeled fake facilitator
```

## Endpoints

| Route | Behaviour |
| --- | --- |
| `GET /health` | Service status, network, payTo, available datasets |
| `GET /facilitator/supported` | Proxies the facilitator's `/supported`, for diagnosis |
| `GET /datasets/:id` | 402 without payment; dataset with a verified, settled payment |

Datasets: `daily-transfers` (30 days of USDC/WETH 0.05% volume) and `pool-liquidity`
(busiest pools by lifetime volume). Content is **live Uniswap V3 data from The Graph**,
queried at a **pinned block** — so two agents buying the same key provably receive
identical bytes, which is what makes reuse verifiable rather than asserted.

The response reports **observed** capabilities, derived from the delivered bytes by
`assessDelivery` in `@common/graph-client`, alongside the seller's `advertisedCapabilities`.
A seller's own capability list can be wrong — two of ours were, and deriving from the
payload is what found them.

## Tests

`tests/gate.test.ts` covers: unpaid requests are refused and leak no content, a verified
and settled payment delivers the dataset, a rejected payload delivers nothing, a failed
settlement delivers nothing, a facilitator outage reports unknown settlement, malformed
headers are rejected before the facilitator is contacted, and dataset output is
deterministic.

**These run against a labeled fake facilitator.** They prove the gate's logic and header
handling. They prove nothing about Hedera, Blocky402 or real settlement — that requires
a live paid request, which is the Phase 1 exit gate.

## Configuration

See `.env.example`. `FACILITATOR_FEE_PAYER_ACCOUNT_ID` is the value most likely to be
wrong; take it from `npm run supported`.

## Layout

- `src/server.ts` — the gate and routes
- `src/config.ts` — environment configuration
- `src/payment/x402.ts` — wire types, header codec, facilitator client
- `src/providers/datasets.ts` — the paid resources
- `src/scripts/check-facilitator.ts` — capability discovery
- `tests/gate.test.ts`
