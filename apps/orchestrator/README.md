# orchestrator

**Owner:** Rudra

Workflow state machine, authenticated requests, dependency wiring, agent runtimes, reconciliation scheduling and deliverables.

## Boundaries

Use `@common/interfaces` for shared contracts. Do not import another workspace's internal source files. Coordinate public interface changes with the lead and affected owner.

## Code locations

- `src/api/`
- `src/agents/`
- `src/workflows/`
- `src/services/`
- `src/jobs/`

## Current state

Small scaffold implementation exists; see the root README for its limits. Run `npm run check` from the repository root. The orchestrator demo uses fixtures only.

## Handoff

Provide setup instructions, example configuration, relevant tests and evidence before marking the component complete.

## Evaluation workflow

createEvaluationWorkflow binds a server-authenticated workspace and one executor mode. Local mode runs actual Ollama inference and records zero payments. Hedera mode requires HEDERA_NETWORK=testnet and CONFIRM_TESTNET_PAYMENT=yes plus the configured adapter keys and prepared workspace. It talks to the paid evaluation service and persists job recovery tokens only on the server.

SQLite claims deduplicate local computation; the contract separately authorizes actual payments. Stable request IDs cannot change parameters. A waiter becomes a successful reuse only after report retrieval and validation. Changed specs get a new key; stale/corrupt reports require an explicit new measurement generation. Unknown payment keeps the claim and can be resumed without a replacement operation. One worker process per app database.

The decision outbox survives restarts. Publishing is at least once: consumers must deduplicate decision IDs. HCS retries never call payment execution. A note consensus timestamp is left unknown when its record cannot be read, rather than substituting transaction valid-start time.
