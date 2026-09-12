# Verification evidence — 2026-09-12

## Live evaluation verified

Rudra authorized at most 5 testnet HBAR. The current compiled contract was deployed at `0x94FFc923123107EDB3aCAa3C9ba19cc09CF681fe`, block 40425744, and its runtime bytecode matched the tested build. Workspace `common-evaluation-demo` authorized both agents and allocated exactly 0.5 HBAR for one evaluation.

Payment `0.0.7162784-1789221528-773144482` is SUCCESS on the mirror node: the treasury was debited 50,000,000 tinybars and the seller credited the same amount. Operation `577ecf0b-28b6-4f3f-b7ac-ed0e4fa30d45` is Delivered on-chain. The workspace records 0.5 HBAR spent and zero committed. Agent B retrieved the same validated report: one acquisition, one reuse, one payment, 50% reuse rate. Actual Qwen outcomes were 2/5 and 4/5, with zero infrastructure errors.

HCS topic `0.0.10465595` contains buy/reuse/wait notes at sequences 3/4/5. All three were read back and linked to confirmed DecisionRecorded events. Two initial receipt queries returned before confirmation; the notes were already published. Recovery verified their full original content and linked the existing sequences without another HCS submission or evaluation payment. Submission attempts are now bounded separately from free receipt polling; consensus timestamps use the free mirror endpoint instead of a paid record query.

Total observed debit from the common operator/treasury account was **2.81652147 testnet HBAR**, including deployment, setup, payment, lifecycle/decision transactions, HCS and record-query fees. No fiat or paid hosting was used. A temporary RPC guard capped contract gas, and native publication attempts had separate fee limits. The guard was stopped after verification; the local dashboard now opens the live evidence in read-only mode with transaction authorization disabled.

See [machine-readable evidence](evidence/live-evaluation-2026-09-12.json). The full suite now passes **126 tests**, including HCS fee/message bounds and read-only API refusal. This is one verified testnet flow, not production certification.

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

Hosted deployment, public release, submission acceptance, and recovery under every possible real-network failure remain unverified. The live flow above establishes this evaluation purchase and its HCS evidence; historical dataset receipts and fixture tests remain separate.

## Google Cloud deployment — verified 2026-09-12 UTC

[Dashboard](https://common.34.71.68.115.sslip.io/) (operator login) and [paid service](https://eval.34.71.68.115.sslip.io/) run on the Google Cloud VM. One actual cloud evaluation purchased for 0.5 testnet HBAR served Agent A and Agent B: one acquisition, one reuse, one payment, three confirmed HCS notes (sequences 6–8), and no pending notes. Contract status is Delivered. The paid run measured 101.342 seconds across ten model/task executions: Qwen3 1.7B passed 2/5, Qwen3 4B passed 5/5, with zero infrastructure errors. This is one observation on this VM.

All 128 tests passed. HTTPS, unauthorized-access refusal, unpaid x402 402, screenshot/trace delivery, and report/counter persistence after restarting both services were checked. The total observed account debit for cloud workspace setup, payment, lifecycle events and HCS was 1.30266943 testnet HBAR. Another 0.5 HBAR remains in the purchase allocation. Reuse does not submit another purchase; fresh runs consume that remaining allocation.

Open the dashboard and sign in with the locally stored operator credentials. Inspect the existing report, then use “Ask Agent B to reuse” to demonstrate memory. “Run fresh measurement” spends the remaining evaluation allowance. Reports have a 24-hour freshness window.

The VM stops automatically approximately September 15 at 23:43 IST; persistent disk storage remains. The external IP is ephemeral and may change after a stop/start, requiring hostname and environment updates. This is a bounded, single-worker hackathon deployment, not a production availability commitment. See [cloud evidence](evidence/cloud-deployment-2026-09-12.json) and the [deployment runbook](../infra/deploy/README.md).

## 2026-09-13 — Browser sign-in regression

The in-app browser rejected the HTTP Basic challenge with ERR_INVALID_AUTH_CREDENTIALS before rendering the frontend. Replaced browser challenges with a normal same-origin sign-in form and eight-hour signed HttpOnly session cookies, retaining protected routes, HTTPS/Origin checks and existing credentials. API tests cover wrong credentials, tampered sessions, cross-site login and login attempt limits. The Chromium test now signs in through the form before testing acquisition, reuse, download and mobile layout with labeled fixtures. No new live purchase is needed to verify this authentication repair.
