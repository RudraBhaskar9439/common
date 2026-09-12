# Architecture

Common provides two explicit execution modes. Local mode performs actual open-model inference without payment. Hedera-testnet mode reserves a bounded purchase, pays an x402 job endpoint and retrieves its report. Both feed the same scoped report memory and dashboard. Graph is deferred.

## Product path

The loopback web server establishes a local browser session and binds one configured workspace. A stable request ID identifies an agent's need. The exact versioned evaluation spec produces a purchase key: models and digests, quantization, tasks, repetitions, inference bounds, suite/app/prompt/tool/runtime versions and measurement generation are included.

SQLite atomically claims that key for one operation. Other requests wait for it. The runner lets the model choose commands derived from the controlled browser DOM, executes those commands in Playwright and checks final application state. Each task gets an isolated context; arbitrary URLs, uploaded code and external page requests are excluded. Failed model actions remain failed outcomes. Infrastructure errors are recorded separately.

The report and artifacts persist. A second request becomes a successful reuse only after workspace access, report identity/completeness, freshness and observed delivery checks pass. The UI displays the report, action history, screenshots, traces, acquisition count and validated reuse rate. Two agent identities exercise this workflow; this MVP does not claim a general autonomous agent framework.

## Testnet path

The service prepares an immutable job and scoped retrieval token before quoting execution. The spending adapter binds the operation to amount, recipient, asset and exact job URL. Immediately before sending signed bytes, the contract enters payment-pending and the registry persists the signed transfer's identity. Once submitted, any ambiguous response remains unknown. Reconciliation looks up that exact transaction and verifies success and transfer details; missing data never proves absence.

The service durably claims settlement before calling the facilitator. A settled job can be polled/retrieved using its original token without another charge. Payment evidence survives report delivery failure. The workflow records delivery separately and keeps failed/unknown operations attached to their existing claim.

Each decision records chosen, rejected and reason. A durable outbox publishes the HCS note and corresponding contract event. Publication is at least once; readers must deduplicate logical decision IDs. HCS is an ordered audit record, not proof that an explanation is true. The outbox cannot invoke payment execution.

## Trust and deployment limits

The contract authorizes accounting reservations and prevents duplicate claims. It does not custody funds or independently verify the facilitator's payment: the operator's treasury signer is trusted. Graph/memory reads cannot authorize real spending. Agent clients never receive signing keys or remote report tokens.

The implemented session model serves one local operator, with one app worker and one service worker per database. It is not public multi-tenant authentication. Persist databases and artifacts together. Hardware/runtime changes invalidate the identity for new evaluation execution; old reports remain inspectable. Current fixed-price jobs measure a small suite, not certified model reliability or token-metered inference billing.

See [verification](VERIFICATION.md) for actual local evidence and live-network gaps, and [environment](ENVIRONMENT.md) for launch/recovery.
