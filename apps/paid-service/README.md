# paid-service

**Current evaluation entrypoint:** `npm run service:evaluations` from the root. `POST /jobs` prepares a bounded evaluation; `GET /jobs/:id/execute` is x402-gated. Authenticated status/report/artifact routes and reconciliation recover an existing job without another charge. Job and receipt state persist in SQLite. The runner uses actual local Ollama models and controlled browser tasks. One real evaluation purchase and subsequent reuse are [verified on testnet](../../docs/evidence/live-evaluation-2026-09-12.json). See [the runbook](../../docs/ENVIRONMENT.md). Dataset instructions below are historical.

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

Datasets: `daily-transfers`, `token-holders`. Content is **synthetic sample data**,
labeled as such in every payload. The point is a genuine payment gate, not the
analytical value of the data. Output is deterministic, so two agents buying the same
key provably receive identical bytes — which is what makes reuse verifiable.

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

## Open-model evaluation service

Run `npm run start:evaluations --workspace @common/paid-service` after setting seller, facilitator and local model configuration. The service binds to loopback by default and runs a single worker per database. Do not run multiple worker processes against the same service database.

- POST /jobs: prepare a bounded immutable spec with workspaceId, operationId and a client-generated random accessToken. Repeated preparation needs the original token and terms.
- GET /jobs/:id/execute: real x402 gate; payment creates a queued job. Repeated calls to an already-paid job return the receipt without settling again.
- GET /jobs/:id and /jobs/:id/report: Bearer accessToken required; retrieve status or result without another payment. Keep this token off public contract/HCS records.
- POST /jobs/:id/reconcile: same token required; check the persisted transaction identity and resume execution only if a matching successful transfer is observed.

Payment submission is journaled before settlement. Unknown settlement never launches compute or submits a replacement payment. Paid jobs that stopped during computation are requeued on service restart, retaining their original receipt. Worker/report errors retain payment history. Local tests use labeled facilitator/runner doubles; fresh testnet verification remains pending credentials.

## Hosted access

An external `PUBLIC_SERVICE_URL` must use HTTPS and requires `COMMON_SERVICE_KEY` (24+ characters). `POST /jobs` checks `X-Common-Service-Key` before parsing/preparing; x402 and per-job report tokens remain independent. Public `/` describes the API, `/catalogue` supplies the current VM's supported evaluation spec, and `/health` reports process health. Run without treasury/signing keys under a separate Unix user. See [deployment](../../infra/deploy/README.md).
