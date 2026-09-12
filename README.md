# Common

Shared spending memory for agents evaluating open models. Run a bounded browser evaluation, inspect measured results, and reuse a compatible report before purchasing another run.

**Status: Phase 1 passed locally.** Hedera contracts, Blocky402 payments and HCS publication exist with historical testnet evidence. Recovery repairs, the model runner, durable storage and product UI are tracked in [the phase plan](docs/BUILD_PLAN.md). Graph is deferred. The contract accounts for reservations; it does not custody funds.

## Start in five minutes

Use Node.js 24 LTS (the version in `.nvmrc`) and npm.

```sh
nvm use
npm ci
npm run demo:mock
npm run check
```

The demo finds an existing fixture purchase, retrieves its result, and prints a reuse decision. It needs no credentials. It does not execute a payment or prove concurrency safety.

## Who codes where

| Person | Primary folders | Owns |
| --- | --- | --- |
| Aditya | `subgraph/`, `packages/graph-client/` | Graph schema, mappings, live reads, discovery, analytics |
| Kavish | `contracts/`, `packages/hedera-adapter/`, `apps/paid-service/`, `infra/` | Budget enforcement, payments, HCS, gated service, deployment |
| Rudra | `apps/web/`, `apps/orchestrator/`, `packages/agent-tools/`, `packages/result-store/` | Product, agents, workflows, storage, integration |
| Rudra coordinates team review | `packages/interfaces/`, `packages/mocks/`, root configuration, `fixtures/` | Shared boundaries, examples, development support |

Read [the full file map](docs/FILE_MAP.md), [team workflow](CONTRIBUTING.md), and [phase plan](docs/BUILD_PLAN.md) before starting. Every owned module has its own README.

## Architecture

```text
Web / agents → orchestrator → spending adapter → controlled payment → paid service
                    ↓                 ↓
              result store       contract events + HCS notes
                    ↑                 ↓
                    └──── durable memory discovery (Graph deferred)
```

Graph is a read layer, not spending authority. Every acquisition must pass an authoritative reservation check. HCS is an audit record, not proof that the recorded explanation is true. Neither empty indexed results nor a missing note may trigger an automatic repeat payment.

## Working independently

Develop against `@common/interfaces` and use `@common/mocks` until live adapters are ready. The orchestrator owns connecting implementations; components must not import each other's private source files. Do not silently change shared fields or commit service credentials.

## Project documents

- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Interface draft and review checklist](docs/INTERFACES.md)
- [Tasks and acceptance evidence](docs/TASKS.md)
- [Environment setup](docs/ENVIRONMENT.md)
- [Decision log](docs/DECISIONS.md)
- [Demo and submission](docs/DEMO.md)
- [Individual AI master prompts](docs/prompts/README.md)
- [Formatted build plan](deliverables/Common_ETHOnline_2026_Build_Plan.docx)

This repository starts private as requested. Revisit visibility and licensing before submission; the sponsor criteria previously reviewed require public source. Do not publish automatically.
