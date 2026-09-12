# Verification evidence — 2026-09-12

## Local regressions

Phase 6 `npm run test:all` passed 122 tests: 47 interface/integration, 16 service, 32 payment adapter, 3 controlled-browser harness, 2 storage, 1 dashboard browser journey and 21 local contract tests. Phase 7 added two passing workspace setup tests, bringing the total to 124. TypeScript checks/build and the explicitly labeled mock demo passed. A clean `npm ci --ignore-scripts` succeeded with the committed lockfile. Local runtime: Node 26.3.1; Phase 6 GitHub Actions also passed on Node 24. These are separate from network settlement evidence.

The browser journey covers acquisition, verified reuse, report download and mobile overflow. API tests cover missing sessions, foreign Host/Origin headers and rejected unbounded requests. Recovery tests cover lost settlement responses, exact transaction identity, restart, delivery failure, duplicate requests, stale reports, decision outbox retry and safe shutdown. Error storage redacts configured treasury keys.

## Actual local inference

`npm run measure:reuse` performed thirty model/task executions using Qwen3 1.7B and 4B, Q4_K_M. Baseline: two separate evaluations, twenty task executions, 59,511 ms. Shared-memory path: one evaluation and one validated reuse, ten executions, 29,856 ms total. The second request retrieved the report in 0.39 ms inside the process. No blockchain payments or fiat spending occurred.

The shared report measured 1.7B at 2/5 tasks passed and 4B at 4/5, with zero infrastructure errors. These outcomes stayed visible; no failures were converted into passes. One sequence on one Apple M5/16 GiB machine is not a statistically reliable latency or model ranking benchmark. Warm-up and execution order influence timing. No HBAR savings are inferred from local timing.

Full reports, screenshots, traces and database remain in ignored `.common-data/benchmark-1789218103241/`. The runnable measurement script regenerates evidence on another configured machine. Report identities now include a hash of hardware, OS, Node, Ollama and Playwright versions.

## Dependency limits

The Hedera SDK pins older protobuf and gRPC dependencies. Root overrides select protobuf 7.6.6/8.8.0 and gRPC 1.14.4; the complete suite passed with them, and clean installation succeeded. This removed the critical protobuf advisory and the gRPC high-severity advisories. A clean dependency resolution was necessary for npm to apply these overrides through workspaces.

The audit is **not clean**. Remaining SDK transitives include React Native/Metro image parsing and legacy elliptic advisories; the controlled server does not run Metro or process arbitrary uploaded images. The separate Hardhat 2 development toolchain also has inherited advisories, some requiring a major tooling migration. Do not expose the development stack as a public production service. Recheck `npm audit` and `npm audit --prefix contracts` before public deployment; do not use `audit fix --force` blindly.

## Not yet verified

A read-only facilitator `/supported` request on 2026-09-12 confirmed x402 v2 exact for `hedera:testnet`, advertising fee payer `0.0.7162784`. This confirms advertised capability, not a settled evaluation payment. Recheck it before use.

Fresh deployment of the expiry-fixed contract, an actual x402 purchase of the evaluation service, HCS notes for this new flow, hosted deployment and submission acceptance. Historical synthetic-dataset receipts and fixture tests do not establish those outcomes.
