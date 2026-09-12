# Infrastructure

Owner: Kavish; current implementation coordinated by Rudra.

Use the root [launch and recovery runbook](../docs/ENVIRONMENT.md). `npm run preflight` checks local Ollama models, Chromium and SQLite without signing. `npm run dev` runs the local dashboard. `npm run service:evaluations` starts the x402 evaluation service after testnet configuration.

The current contract source needs a new deployment. `npm run prepare:testnet --prefix contracts` configures the evaluation workspace idempotently and never writes seed settlement evidence. No hosted deployment or paid infrastructure was created.

The older `scripts/health-check.ts`, `live-verify.ts` and `failure-drills.ts` target the historical synthetic-dataset demonstration. They are retained as historical tools, not current evaluation-flow verification. Do not use their old address, fee-payer assumptions or receipt files to claim the new service was paid successfully. Current recovery binds the original signed transfer identity and does not automatically release on missing mirror data.

Preserve the app/service SQLite databases and artifact directories across restart, run one worker per database, and keep secrets in ignored local environment files. Public hosting and release need separate access and authorization.
