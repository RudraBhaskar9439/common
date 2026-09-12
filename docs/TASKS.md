# Phase tracker

Audited base: `938696f`. Baseline: 10 interface, 17 adapter, 13 paid-service and 20 local contract tests passed; typecheck/build/mock demo passed. Existing receipt evidence is historical.

| Phase | Status | Evidence / remaining work |
| --- | --- | --- |
| 0 | Passed locally | 30 interface tests (20 new), 17 adapter, 13 service, 20 contract tests; typecheck/build/mock demo and diff check passed. No live payment or inference claimed. |
| 1 | Passed locally; testnet pending | 30 interface, 32 adapter, 14 service, 21 contract and 2 browser tests passed; check/build/mock demo passed. Real local smoke: Qwen3 4B passed assignment in 3 actions; 1.7B failed within 8 actions. No new network payment. Contract expiry change needs redeployment. |
| 2 | Passed locally | All 10 real model/task runs completed: 1.7B 2/5; 4B 4/5, zero infrastructure errors. Report validated, persisted and reopened from SQLite. 38 root tests, 2 storage tests, 3 browser tests; build/mock demo passed. |
| 3 | Code passed locally; live blocked | 16 service tests including single-settlement concurrency, protected retrieval and unknown-settlement restart; 38 root tests/build/mock demo passed. Live service entrypoint added; testnet configuration still unavailable. |
| 4 | Passed locally; live HCS pending | 43 root tests and 32 adapter tests/build/mock demo passed. Two real local agent requests shared one 10-task evaluation: one acquisition, one validated reuse, zero payments. Durable decisions/outbox and scoped memory implemented. |
| 5 | Passed locally | Local dashboard shows actual model reports, decisions, artifacts and counters. Desktop/mobile Chromium: no page errors or horizontal overflow; reuse increased without a new acquisition/payment; JSON and PNG downloads returned 200. Typecheck/build, 43 root tests and mock demo passed. |
| 6 | Passed locally | 122 tests: 47 root, 16 service, 3 runner, 32 adapter, 2 storage, 1 browser journey, 21 local contract tests. Typecheck/build/mock demo passed; clean npm ci succeeded. Actual baseline: 2 evaluations/20 task executions, 59,511 ms; shared: 1 evaluation/10 executions, 29,856 ms including 0.39 ms retrieval, 50% reuse, zero payments. Timing is a single sequential local observation. |
| 7 | Local launch ready; external verification pending | Local preflight passed for both models, Chromium and SQLite. Workspace setup tests passed idempotency and foreign-operator rejection (23 contract tests; 124 total with Phase 6 suite). Deployment/topic commands refuse missing transaction authorization. Current README, architecture, setup/recovery runbook and four-minute demo script written. Testnet credentials, fresh deployment/payment/HCS evidence, public release and submission remain external. |

Every phase must record what ran, passed, and remains unverified. Payment tests with doubles do not prove Hedera settlement. A model failing a task is an evaluation outcome, not a broken harness.

## Live follow-through — passed 2026-09-12

The former testnet blockers in Phases 1, 3, 4 and 7 are resolved for one real evaluation flow: current contract deployed and bytecode checked; 0.5 HBAR payment independently verified; report delivered; second agent reused without repayment; all three HCS notes linked. Total observed testnet debit 2.81652147 HBAR, below the authorized 5. Full suite: 126 tests. Dashboard is left in read-only review. Hosted/public release and submission remain separate. See [live evidence](evidence/live-evaluation-2026-09-12.json).

## Google Cloud deployment follow-through

- [x] Deploy complete CPU inference/browser/x402/application stack with HTTPS and separate service identities.
- [x] Verify one paid cloud evaluation, shared reuse, HCS/event linkage, artifacts and restart persistence.
- [x] Run 128 tests and push tested deployment phases directly to main.
- [x] Bound VM runtime to three days and leave one additional 0.5 testnet HBAR purchase allocation.
- [ ] User shares operator access with intended judges and completes submission materials.
- [ ] User decides hosting duration beyond the three-day demo; disk cleanup or continued hosting must preserve needed evidence.
