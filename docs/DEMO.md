# Demo and submission

## Four-minute local demonstration

1. **0:00–0:30 — Problem.** Two agents need evidence about which open model can operate a support desk. Running the same evaluation twice wastes inference. Common makes measured reports reusable and remembers the spending decision.
2. **0:30–1:20 — Actual acquisition.** Open the dashboard, show the two pinned Qwen models and five tasks, then run a fresh measurement as Agent A. Explain that local mode performs real inference with zero blockchain payments. For a testnet demo, use that mode only after the new live flow is verified.
3. **1:20–2:10 — Evidence.** Inspect the report, a failed task and its screenshot/action sequence. Show the model digest, measured tokens/latency and the small-suite limitation. Failed model tasks remain visible.
4. **2:10–2:50 — Shared memory.** Click Ask Agent B to reuse. Show the unchanged acquisition/payment count and increased reuse count. The second agent retrieves the compatible report instead of running another evaluation.
5. **2:50–3:30 — Decisions and recovery.** Show what was chosen/rejected and why. Local records are labeled. Only show a Hedera receipt/HCS sequence if it belongs to a newly verified evaluation purchase. Explain that uncertain settlement blocks replacement payments and is reconciled by exact transaction identity.
6. **3:30–4:00 — Result.** The observed local baseline needed two evaluations; shared memory needed one. State the scope: controlled application, two model versions, one repetition, one machine. No claim of a universal model winner or guaranteed payment savings.

Use a fresh ignored data directory for a clean local recording rather than deleting existing evidence: `COMMON_DATA_DIR=.common-data/recording npm run dev`. It must use a different port if the other instance is still running. Keep the same directory when resuming a paid operation.

## Submission assets and remaining work

- Working dashboard: http://127.0.0.1:3000 while this machine is running.
- Source: tested commits on main, repository still private.
- Evidence and exact commands: `docs/VERIFICATION.md` and `docs/ENVIRONMENT.md`.
- Live payment/HCS evidence: `docs/evidence/live-evaluation-2026-09-12.json`; the dashboard now displays this flow in read-only mode. No new payment is needed to inspect it.
- Remaining: public-source/license decision, recording/narration for submission, submission form and any hosted access requirement.

Review the [official Hedera prize requirements](https://ethglobal.com/events/ethonline2026/prizes/hedera) before submission. Do not claim Graph integration, a second sponsor, hosted availability or live x402 evaluation evidence that has not been demonstrated. Historical dataset receipts are separate evidence.

## Google Cloud deployment — verified 2026-09-12 UTC

[Dashboard](https://common.34.71.68.115.sslip.io/) (operator login) and [paid service](https://eval.34.71.68.115.sslip.io/) run on the Google Cloud VM. One actual cloud evaluation purchased for 0.5 testnet HBAR served Agent A and Agent B: one acquisition, one reuse, one payment, three confirmed HCS notes (sequences 6–8), and no pending notes. Contract status is Delivered. The paid run measured 101.342 seconds across ten model/task executions: Qwen3 1.7B passed 2/5, Qwen3 4B passed 5/5, with zero infrastructure errors. This is one observation on this VM.

All 128 tests passed. HTTPS, unauthorized-access refusal, unpaid x402 402, screenshot/trace delivery, and report/counter persistence after restarting both services were checked. The total observed account debit for cloud workspace setup, payment, lifecycle events and HCS was 1.30266943 testnet HBAR. Another 0.5 HBAR remains in the purchase allocation. Reuse does not submit another purchase; fresh runs consume that remaining allocation.

Open the dashboard and sign in with the locally stored operator credentials. Inspect the existing report, then use “Ask Agent B to reuse” to demonstrate memory. “Run fresh measurement” spends the remaining evaluation allowance. Reports have a 24-hour freshness window.

The VM stops automatically approximately September 15 at 23:43 IST; persistent disk storage remains. The external IP is ephemeral and may change after a stop/start, requiring hostname and environment updates. This is a bounded, single-worker hackathon deployment, not a production availability commitment. See [cloud evidence](evidence/cloud-deployment-2026-09-12.json) and the [deployment runbook](../infra/deploy/README.md).
