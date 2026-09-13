# Google Cloud deployment

Rudra authorized deployment to the supplied Google Cloud project using existing Free Trial credits on 2026-09-12. GitHub stays private; billing is not upgraded. One Ubuntu VM runs the application, x402 provider, Ollama, Chromium and persistent SQLite/artifacts. This remains a single-operator demo.

## Boundaries

Caddy exposes separate application/provider HTTPS hostnames. Node and Ollama bind loopback. The hosted application has a normal sign-in page (username `operator`), exact HTTPS origin validation, and signed Secure/HttpOnly/SameSite session cookies that expire after eight hours or a process restart. The random operator password grants configured compute and testnet spending access: keep it with operators; judges can use public review without it.

The provider exposes `/`, `/health`, and `/catalogue`. `POST /jobs` requires `X-Common-Service-Key`. Executing the prepared URL still requires x402 payment; reports/artifacts require the original job Bearer token. A 256-job capacity bounds stored preparations. This is controlled admission, not an anonymous marketplace or a full rate-limiting system.

Distinct Unix users run the app and provider. Root-owned mode-600 `/etc/common/app.env` contains signing credentials; `/etc/common/provider.env` contains only seller/facilitator identifiers and the admission key. Never upload the development root `.env` as shared configuration. Source is root-owned; each service can write only its own data directory and temporary files.

## Release procedure

1. Create an Ubuntu 24.04 VM without a Google service account, with an 80 GB persistent disk and a three-day maximum runtime with STOP termination. Disk charges continue after stopping. Preserve it until recovery data is no longer needed. HTTP/HTTPS firewall ingress targets only the `common-web` VM tag.
2. Run `bootstrap.sh` as root. Node 24 downloads are checksum-verified; Ollama uses its official installer. Record resolved versions/digests since installation follows current vendor releases.
3. Transfer the tested Git source archive to `/opt/common`. Exclude Git history, secrets, databases, caches, node_modules and build output. Run `npm ci`, then `PLAYWRIGHT_BROWSERS_PATH=/opt/common/browsers npx playwright install --with-deps chromium`.
4. Write the separate environment files and install supplied systemd units. Configure Caddy with real DNS hostnames.
5. Run preflight and an actual evaluation on the VM. Reports bind the new hardware/runtime fingerprint; Mac timings cannot serve as cloud evidence.
6. Verify HTTPS, rejected unauthorized access, unpaid 402, actual paid delivery, report/artifact retrieval, reuse, HCS notes and persistence across restart. Report observed results and limitations.

## Environment

App adds `COMMON_PUBLIC_ORIGIN=https://APP_HOST`, `COMMON_OPERATOR_PASSWORD` (at least 24 characters), `COMMON_SERVICE_KEY`, `PAID_SERVICE_URL=https://PROVIDER_HOST`, `COMMON_DATA_DIR=/var/lib/common/app`, and `PLAYWRIGHT_BROWSERS_PATH=/opt/common/browsers`.

Provider adds `PUBLIC_SERVICE_URL=https://PROVIDER_HOST`, `COMMON_SERVICE_KEY` (at least 24 characters), `COMMON_DATA_DIR=/var/lib/common/service`, and the same browser path, alongside seller/facilitator configuration. No signing keys belong here.

`COMMON_MODE=hedera-testnet` and explicit testnet confirmation enable payments; `COMMON_READ_ONLY=yes` disables new work, startup recovery and HCS retries. The prepared workspace's contract budget bounds purchases. Set `COMMON_PUBLIC_REVIEW=yes` in `/etc/common/app.env` and restart `common-app` to open stored evidence to judges without a password. Visitors can browse reports, artifacts, decisions and receipts; new evaluations and retries still require operator sign in at `/login`. Keep the operator password configured. Public review does not change provider admission or x402 payment enforcement.

Use `systemctl status common-app common-provider ollama caddy` for health. Preserve `/var/lib/common/app` and `/var/lib/common/service` during releases. Never delete an uncertain operation to retry payment; reconcile the original identity.

## Current deployment

- Project: `project-c0f0f832-e02b-4eac-ae2`; instance: `common-eval`; zone: `us-central1-a`.
- Machine: `n2-standard-8`, 8 vCPU / 32 GB RAM, 80 GB persistent disk.
- App: https://common.34.71.68.115.sslip.io/; provider: https://eval.34.71.68.115.sslip.io/.
- Runtime: Node 24.21.0, Ollama 0.34.0. Resolved model digests are in cloud evidence.
- VM STOP is scheduled after three days, approximately September 15 at 23:43 IST. The external IP is ephemeral and can change after stop/start: update both hostnames, the environment URLs and Caddy if it changes.
- Actual verification: one 0.5 testnet HBAR purchase, one reuse, three confirmed HCS-linked events, no pending notes, one persisted service report after service restarts. A second prepared job is the unpaid HTTP 402 probe and has never executed.
- Remaining allocation: 0.5 testnet HBAR, enough for one fresh evaluation. Trial credits pay eligible cloud infrastructure costs, not Hedera transactions.

Credentials are saved only in ignored `.common-data/cloud-deploy/access.txt` on the lead's computer and root-owned server environment files. Do not commit them or put passwords in URLs. The signed-in browser sends its authenticated session cookie on subsequent API requests. Direct API clients can still obtain a session with Basic credentials; browsers receive no HTTP Basic challenge.
