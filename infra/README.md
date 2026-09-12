# Infrastructure

Owner: Kavish; current implementation coordinated by Rudra.

Use the root [launch and recovery runbook](../docs/ENVIRONMENT.md). `npm run preflight` checks local Ollama models, Chromium and SQLite without signing. `npm run dev` runs the local dashboard. `npm run service:evaluations` starts the x402 evaluation service after testnet configuration.

The current contract is deployed and the evaluation payment/HCS flow is [verified](../docs/evidence/live-evaluation-2026-09-12.json). `npm run prepare:testnet --prefix contracts` configures a workspace idempotently and never writes seed settlement evidence. The later Google Cloud deployment uses existing trial credits; see the cloud deployment evidence.

The older `scripts/health-check.ts`, `live-verify.ts` and `failure-drills.ts` target the historical synthetic-dataset demonstration. They are retained as historical tools, not current evaluation-flow verification. Do not use their old address, fee-payer assumptions or receipt files to claim the new service was paid successfully. Current recovery binds the original signed transfer identity and does not automatically release on missing mirror data.

Preserve the app/service SQLite databases and artifact directories across restart, run one worker per database, and keep secrets in ignored local environment files. Hosted access is now authorized; public source release remains separate.

Google Cloud deployment files and operational boundaries now live in [deploy/README.md](deploy/README.md). Rudra has authorized hosted deployment using existing credits; see the latest deployment evidence for actual readiness.
