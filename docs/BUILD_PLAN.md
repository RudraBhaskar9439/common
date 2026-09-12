# Open-model evaluation build plan

Accepted direction and constraints: [DECISIONS.md](DECISIONS.md). Implement each phase, run its checks, record observed evidence in [TASKS.md](TASKS.md), commit and push the phase branch. Do not call a phase live-verified when only local tests ran. Historical documents and receipts describe the earlier synthetic-dataset service.

| Phase | Deliverables | Exit checks |
| --- | --- | --- |
| 0 | Bounded evaluation contracts, versioned identity, fixture, ownership and service boundaries | Invalid requests rejected; changed configuration cannot reuse; legacy checks and mock demo pass |
| 1 | Exact payment binding, safe pending recovery/reconciliation; first controlled browser/model experiment | Settlement uncertainty and expiry regressions; one real local model task |
| 2 | Five tasks, two model runs, deterministic scoring, traces, durable reports and operation storage | Full live local evaluation; restart and report retrieval tests |
| 3 | x402 job execution and authenticated unbilled recovery | Local paid-path tests; separate real testnet payment evidence when credentials exist |
| 4 | Durable discovery, acquire/reuse/wait workflow, decision outbox and counters | Concurrent requests produce one acquisition; authorized reuse; changed version rejected |
| 5 | Setup, execution and comparison UI | Browser journey through evaluation and reuse; real displayed evidence |
| 6 | Failure/restart/authorization tests, complete CI and measured baseline | Full local journey and regressions pass; network claims separately verified |
| 7 | Deployment instructions, health checks, demo preparation, accurate README | Reproducible local launch; hosted verification only with access |

## Work split

Rudra authorized one implementer across all modules while teammates are paused. Keep review boundaries: Kavish's payment/contract/infra code; Rudra's orchestration/storage/web code; Aditya's memory/evaluation handoff. New modules use public workspace exports. Root lockfile changes are serialized.

## Useful evaluation

One application with resettable synthetic support tickets. The model sees browser-observed text and allowed controls; it chooses actions. Code operates the browser and checks final state. No model receives the grading answer. Reports include model digests, quantization, prompt/tool/app/suite versions, task outcomes, latency, usage and artifacts. Fixture actions are labeled and never presented as inference.

## Recovery

Persist payment terms and transaction identity before submission. Never release or repay an ambiguous operation. Track execution separately from payment. Lost responses must not buy another run. HCS retries must not invoke payment. Reuse requires authorization, exact configuration, freshness, successful delivery and an intact report.

## Deferred

Graph indexing, marketplaces, arbitrary websites or user code, training, mainnet, token streaming and paid hosting. No automatic publication, PR creation or merge is included in push authorization.
