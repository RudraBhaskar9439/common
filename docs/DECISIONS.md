# Decision log

## 2026-09-12 — Open-model evaluation MVP

Owner: Rudra. Rudra requested implementation across all modules, confirmed teammates are paused, authorized a GitHub push after each tested phase, and set a tomorrow-morning deadline. Paid hosting and paid inference are not authorized. Repository visibility remains private.

- Product: two Apache-2.0 models evaluated on five browser tasks in a controlled support-desk application. Reports describe observed outcomes, not reliability guarantees.
- Runtime: local Ollama and Playwright. Candidates `qwen3:1.7b` and `qwen3:4b`; record actual digests before execution. Available machine: Apple M5, 16 GiB RAM. Run models sequentially. Sources: https://ollama.com/library/qwen3:1.7b and https://ollama.com/library/qwen3:4b; API https://docs.ollama.com/api/chat.
- Boundary acceptance: EvaluationSpec, reports, job states and canonical identity accepted under Rudra's implementation direction. This does not claim absent teammates reviewed changes. Spending recovery extensions update callers and tests in the same phase commit.
- Storage: embedded SQLite on a persistent local volume; distinct operation/job/report/decision records. Browser artifacts use authorized retrieval.
- Memory: preserve MemoryReader and implement a database-backed reader. Graph deferred; no Graph prize claim.
- Suite: assign-ticket, change-priority, resolve-ticket, add-note, filter-tickets. Checks inspect actual browser state. Model failure is valid evaluation data; infrastructure error excludes successful reuse.
- Identity: fingerprint the full versioned spec. Model order, digest, prompt/tool versions, inference settings, runtime identity and measurement generation affect the key. Authorization is independent. Retries preserve operation ID and generation.
- Paid boundary: prepare an immutable job; x402 gates execution; authenticated status/result routes recover an already-paid job without payment. Job and payment state remain distinct. Only supported local model tags and our controlled app are accepted.
- Limits: two models, at most five tasks, three repetitions, twelve actions per task, 180 seconds per task, 1,024 output tokens/action, 8,192 context tokens. Fixed bounded-job pricing; no claim of token-metered billing.
- Git: test each phase, record limits, commit/push codex/open-model-evaluations. No automatic merge, PR or public release. Track implementation and live verification separately.
- Original owners remain reviewers. Codex implements on Rudra's behalf while teammates are paused. Evaluation/memory is proposed for Aditya's handoff; payment/infra Kavish; UI/orchestration/storage Rudra.

## External prerequisites

No local Hedera secret environment files found. Live verification needs configured testnet credentials and bounded testnet spending authorization. No fiat purchase is permitted. Hosting/submission access is unavailable; finish the local stack first.

## Historical scaffold decisions


## Accepted direction

- Build Common with three primary owners: Aditya for Graph, Kavish for Hedera and deployment, Rudra for product and integration.
- Start with a private repository and pre-created module structure.
- Use shared interfaces and mocks to reduce development blocking.

## Scaffold choices for review

- npm workspaces and TypeScript for application/shared packages.
- Node.js 24 LTS for CI; local scaffold also permits Node 25 and 26.
- One package per integration boundary; no frontend or Solidity framework chosen yet.
- Actual live adapters fail explicitly until implemented.

## Pending

- Verified teammate GitHub handles and collaborator access.
- Contract framework and canonical ABI generation.
- Graph-supported deployment path and endpoint.
- Controlled payment signer and settlement architecture.
- Backend framework, frontend framework and persistent data providers.
- Phase 0 interface approval.

## New decision template

Date / owner / decision / reason / affected modules / reviewers / follow-up task.
