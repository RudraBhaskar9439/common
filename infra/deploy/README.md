# Google Cloud deployment

Rudra authorized deployment to the supplied Google Cloud project using existing Free Trial credits on 2026-09-12. GitHub stays private; billing is not upgraded. One Ubuntu VM runs the application, x402 provider, Ollama, Chromium and persistent SQLite/artifacts. This remains a single-operator demo.

## Boundaries

Caddy exposes separate application/provider HTTPS hostnames. Node and Ollama bind loopback. The hosted application requires HTTP Basic credentials (username `operator`), exact HTTPS origin validation, and Secure/HttpOnly/SameSite cookies. The random operator password grants configured compute and testnet spending access: share it only with intended reviewers.

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

`COMMON_MODE=hedera-testnet` and explicit testnet confirmation enable payments; `COMMON_READ_ONLY=yes` disables new work, startup recovery and HCS retries. The prepared workspace's contract budget bounds purchases.

Use `systemctl status common-app common-provider ollama caddy` for health. Preserve `/var/lib/common/app` and `/var/lib/common/service` during releases. Never delete an uncertain operation to retry payment; reconcile the original identity.
