# Common

Shared spending memory for agents choosing open models. Buy one bounded browser evaluation, inspect the evidence, and let another agent reuse the same compatible report before running it again.

**Verified on Hedera testnet:** one 0.5 HBAR x402 evaluation, ten real model/task executions, one subsequent report reuse without another payment, and three confirmed HCS notes linked to contract events. Deployment and verification used an observed 2.81652147 testnet HBAR against a 5 HBAR allowance. The local dashboard also supports evaluation without payment. Graph is deferred. [Live evidence](docs/evidence/live-evaluation-2026-09-12.json) · [Verification](docs/VERIFICATION.md) · [Runbook](docs/ENVIRONMENT.md).

## Run locally — no paid services

Use Node 24 LTS, npm and [Ollama](https://ollama.com/). The tested development machine is an Apple M5 with 16 GiB RAM. Model downloads need several GB; inference runs on your computer.

```sh
npm ci
npx playwright install chromium
ollama pull qwen3:1.7b
ollama pull qwen3:4b
npm run preflight
npm run dev
```

Ollama must be running (`ollama serve` if needed). Open **http://127.0.0.1:3000**. Select Agent A and click **Find or run evaluation**, inspect the ten task outcomes, then **Ask Agent B to reuse**. Both requests share one report. **Run fresh measurement** explicitly creates another evaluation. Local mode sends no payments or HCS messages.

The model chooses browser actions against our controlled support-desk app. Deterministic checks inspect final browser state, including fields that must remain unchanged. This evaluates inference and tool use; it does not resell publicly available data. Reports include model digests, quantization, runtime identity, task outcomes, latency, tokens, screenshots and traces. A small model failing a task is useful measured evidence.

## What was measured

One actual local comparison ran two separate evaluations in 59.5 seconds; the shared path ran one evaluation and one report retrieval in 29.9 seconds. It avoided ten model/task executions and had a 50% reuse rate. These are single-machine observations, not production speed or HBAR savings claims. The shared report recorded Qwen3 1.7B at 2/5 tasks passed and Qwen3 4B at 4/5. See [verification limits](docs/VERIFICATION.md).

```sh
npm ci --prefix contracts
npm run test:all
npm run measure:reuse
```

Tests use clearly labeled fixtures where applicable. `measure:reuse` runs actual local inference and writes evidence under ignored `.common-data/`. Reports and recovery state persist there; preserve that directory between restarts.

## Architecture and trust

```text
Dashboard / two agent clients → orchestrator → shared report discovery
                                   ↓ miss             ↑ reuse
                              durable operation → result store
                                   ↓ testnet mode
                              budget reservation → x402 evaluation service
                                   ↓                       ↓
                              Hedera transfer         Ollama + browser
                                   ↓
                           HCS decision + contract event
```

A report can be reused only within the workspace, for the exact versioned configuration, while fresh, intact and successfully delivered. Reuse counters increment after retrieval and validation. SQLite supports discovery and local coordination; the contract authorizes real spending. The contract is an accounting ledger, **not a vault**: the operator holds the treasury key. Unknown settlement keeps the reservation claimed; recovery checks the original transaction without submitting a replacement payment. Delivery and payment are distinct outcomes.

The application is a local, single-operator demo bound to loopback, with one worker per database. It is not a hosted multi-tenant service. Set `COMMON_READ_ONLY=yes` to inspect existing evidence without enabling execution or transaction retries. The verified evaluation has its own receipt; historical dataset receipts are separate. See [testnet setup and recovery](docs/ENVIRONMENT.md).

## Find the code

- [File map](docs/FILE_MAP.md), [team workflow](CONTRIBUTING.md), [decisions](docs/DECISIONS.md)
- [Evaluation runner](packages/evaluation-runner/README.md), [orchestrator](apps/orchestrator/README.md), [web](apps/web/README.md)
- [Hedera adapter](packages/hedera-adapter/README.md), [paid service](apps/paid-service/README.md), [contracts](contracts/README.md)
- [Demo script and submission work](docs/DEMO.md), [phase plan](docs/BUILD_PLAN.md)

Rudra authorized tested phase commits directly on `main`. The repository remains private. Public source, licensing, hosted access and final submission require a separate release decision.
