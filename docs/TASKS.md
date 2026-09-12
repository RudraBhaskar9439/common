# Phase tracker

Audited base: `938696f`. Baseline: 10 interface, 17 adapter, 13 paid-service and 20 local contract tests passed; typecheck/build/mock demo passed. Existing receipt evidence is historical.

| Phase | Status | Evidence / remaining work |
| --- | --- | --- |
| 0 | Passed locally | 30 interface tests (20 new), 17 adapter, 13 service, 20 contract tests; typecheck/build/mock demo and diff check passed. No live payment or inference claimed. |
| 1 | Passed locally; testnet pending | 30 interface, 32 adapter, 14 service, 21 contract and 2 browser tests passed; check/build/mock demo passed. Real local smoke: Qwen3 4B passed assignment in 3 actions; 1.7B failed within 8 actions. No new network payment. Contract expiry change needs redeployment. |
| 2 | Passed locally | All 10 real model/task runs completed: 1.7B 2/5; 4B 4/5, zero infrastructure errors. Report validated, persisted and reopened from SQLite. 38 root tests, 2 storage tests, 3 browser tests; build/mock demo passed. |
| 3 | Code passed locally; live blocked | 16 service tests including single-settlement concurrency, protected retrieval and unknown-settlement restart; 38 root tests/build/mock demo passed. Live service entrypoint added; testnet configuration still unavailable. |
| 4 | Passed locally; live HCS pending | 43 root tests and 32 adapter tests/build/mock demo passed. Two real local agent requests shared one 10-task evaluation: one acquisition, one validated reuse, zero payments. Durable decisions/outbox and scoped memory implemented. |
| 5 | Pending | UI and browser verification |
| 6 | Pending | Full regressions and economic measurement |
| 7 | Pending | Launch/runbook/demo; hosted deployment and submission access unavailable |

Every phase must record what ran, passed, and remains unverified. Payment tests with doubles do not prove Hedera settlement. A model failing a task is an evaluation outcome, not a broken harness.
