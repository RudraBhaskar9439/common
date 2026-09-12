# Launch and recovery runbook

## Local launch

Use Node 24 LTS and npm. Install/start Ollama, then follow the root README. `npm run preflight` checks installed model revisions, Chromium launch and a SQLite write/reopen. It lists missing testnet variable names without printing their values. It does not sign or submit transactions.

No `.env` is needed for local mode. Optionally copy root `.env.example` to root `.env`. The application and evaluation service load that root file; existing shell variables take precedence. Prefer one root configuration for this demo. Do not mix older module-local configurations. Keep Ollama, orchestrator and evaluation service on this same machine for this MVP so the report's hardware/runtime identity agrees.

`npm run dev` starts the dashboard at http://127.0.0.1:3000. `COMMON_DATA_DIR` defaults to `.common-data` at the repository root. App/service databases and artifacts must remain on persistent local disk. Run one app worker per app database and one service worker per service database. Restart with the same workspace and directory to recover in-flight work. Do not delete a live database to bypass an uncertain payment.

`npm run test:all` requires `npm ci --prefix contracts` and Chromium. It needs no wallets, Ollama models or blockchain connection. `npm run measure:reuse` separately needs both installed models and performs actual inference. Graph credentials and paid model APIs are not used.

## Testnet setup and verified evidence

The first live evaluation is now verified; see `docs/evidence/live-evaluation-2026-09-12.json`. Current contract: `0x94FFc923123107EDB3aCAa3C9ba19cc09CF681fe`. The local configuration opens `.common-data/live-verification` in read-only mode. `COMMON_READ_ONLY=yes` prevents execution, startup recovery and transaction retries while allowing authenticated report/artifact inspection. To return to free local evaluation, use COMMON_MODE=local, COMMON_READ_ONLY=no and the original COMMON_DATA_DIR=.common-data.

Live execution requires explicit authorization and testnet HBAR. No paid hosting is required; the two servers can run locally. Put secrets only in root `.env`, never in chat, source, screenshots or a video.

| Variable | Purpose |
| --- | --- |
| COMMON_MODE | `hedera-testnet` only when ready to submit transactions |
| CONFIRM_TESTNET_PAYMENT | `yes` explicitly enables testnet transaction commands |
| HEDERA_NETWORK | `testnet` |
| COMMON_WORKSPACE_ID | Unique evaluation workspace, identical for setup and app |
| HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY | Treasury account and Hedera signing key |
| HEDERA_EVM_PRIVATE_KEY | EVM operator key for contract administration |
| COMMON_CONTRACT_ADDRESS | Fresh deployment of the current expiry-fixed contract |
| HCS_TOPIC_ID | Decision topic; set after topic creation |
| PAY_TO_ACCOUNT_ID | Seller receiving the evaluation payment |
| FACILITATOR_FEE_PAYER_ACCOUNT_ID | Current fee payer from facilitator `/supported` |
| PRICE_AMOUNT | Evaluation price in tinybars; example `50000000` = 0.5 HBAR |
| MAX_PAYMENT_AMOUNT | Per-operation cap; example `100000000` = 1 HBAR |
| WORKSPACE_BUDGET_TINYBAR | Total accounting target; defaults to 1 HBAR, setup caps at 5 |
| PAID_SERVICE_URL / PUBLIC_SERVICE_URL | Both `http://127.0.0.1:3002` for this local demo |

Accounting budgets and per-payment caps exclude contract/network fees and are **not** a global fee cap. Agree a testnet spending allowance before running the commands below. The treasury must hold testnet funds; `fundWorkspace` only records an accounting allocation.

1. Install contract dependencies and run local tests. Set the testnet configuration and explicit transaction flag.
2. Reuse the current verified deployment if its bytecode matches the source. If a fresh deployment is needed, use `npm run deploy:testnet --prefix contracts` and save the printed address into root `.env`. The historical address in older dataset evidence lacks the new expiry check.
3. Run `npm run prepare:testnet --prefix contracts`. It creates the chosen workspace, sets its accounting budget to the target and authorizes `agent-a`/`agent-b`. Repeating it does not fund twice. It never seeds a fake settlement.
4. If no topic exists, run `npm run create:topic --workspace @common/hedera-adapter`, then save the printed topic ID. Existing topics are preserved.
5. Read current facilitator capabilities with `npm run supported --workspace @common/paid-service` and verify the Hedera testnet exact scheme and fee payer. Never assume a historical fee payer is still current.
6. Start `npm run service:evaluations` in one terminal and `npm run dev` in another. The service prepares immutable, authenticated jobs and charges only the execute route. Its status/report/artifact routes use the original job token and do not charge again.
7. Acquire once as Agent A, then reuse as Agent B. Verify the actual transaction on the mirror node, the seller credit, contract delivery and HCS sequence. Record that new evidence before calling the evaluation payment path live-verified.

Do not use the historical `seed:testnet`, dataset `run:operation`, or old infra failure drills as evidence for the new evaluation service. They describe a different resource and may contain placeholder indexing events.

## Recovery

| State | Action |
| --- | --- |
| Queued/running local evaluation | Wait; restart with the same database if interrupted |
| Failure before submission | Resume the same operation; do not change its bound parameters |
| `settlement_unknown` | Resume invokes reconciliation for the original transaction. Never release or create a replacement purchase |
| Paid, report not ready | Resume polling the existing authenticated job; payment is retained |
| Delivered report with model task failures | Valid evaluation evidence; model failure does not imply delivery failure |
| Infrastructure error or stale report | Inspect evidence. A new measurement requires an explicit new generation and may incur a new payment |
| HCS publication pending | Durable outbox retries; this never retries payment. Consumers deduplicate decision IDs |

Missing mirror-node data is inconclusive, even after expiry. The current adapter does not infer absence and release automatically. This conservative rule can leave operations waiting for manual investigation. The contract trusts its operator; do not invoke its administrative absence/release function without conclusive evidence.

## Hosting and release limits

No public deployment or paid infrastructure was created. The loopback session model is suitable for this single-operator demonstration. Public hosting needs authenticated users, workspace provisioning, quotas, process coordination, durable volume backups and dependency review. See `docs/VERIFICATION.md` for remaining dependency advisories and live checks. Keep the repository private until Rudra explicitly authorizes public release.
