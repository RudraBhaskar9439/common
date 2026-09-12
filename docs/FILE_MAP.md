# File map and ownership

Current implementation: Codex acts across modules under Rudra's direction while teammates are paused. Planned additions: packages/evaluation-runner for model/browser execution; packages/memory-client for a database-backed MemoryReader. Graph deferred. Evaluation types: packages/interfaces/src/evaluation.ts. Fingerprinting: packages/agent-tools/src/evaluation-key.ts.

```text
common/
├── apps/
│   ├── web/                   Rudra — components and product features
│   ├── orchestrator/          Rudra — API, agents, workflows, services, jobs
│   └── paid-service/          Kavish — routes, payment middleware, providers
├── packages/
│   ├── interfaces/            Shared types; Rudra coordinates approval
│   ├── mocks/                 Local fixtures behind the interfaces
│   ├── agent-tools/           Rudra — agent-facing functions
│   ├── result-store/          Rudra — storage providers and retrieval
│   ├── graph-client/          Aditya — queries and response mapping
│   └── hedera-adapter/        Kavish — contracts, payments, HCS, reconciliation
├── contracts/                 Kavish — Solidity src, test, script, ABI exports
├── subgraph/                  Aditya — schema, src mappings, ABI inputs, tests
├── infra/                     Kavish — local setup, deployment, scripts
├── fixtures/                  Scenario descriptions, event and result examples
├── tests/
│   ├── interfaces/            Consumer behavior using controlled fixtures
│   ├── integration/           Cross-component tests, not implemented yet
│   └── e2e/                   Product journeys, not implemented yet
├── docs/                      Plan, architecture, interfaces and task tracking
├── scripts/                   Repository-level maintenance helpers
├── deliverables/              Formatted build plan
└── .github/                   CI, CODEOWNERS and PR template
```

## Where new code belongs

| Change | Location |
| --- | --- |
| GraphQL query or Graph response conversion | packages/graph-client/src/queries or mappers |
| Event handler or indexed entity | subgraph/src and subgraph/schema.graphql once defined |
| Budget checks and reservation authority | contracts/src |
| Call to Blocky402 or payment signer | packages/hedera-adapter/src/payments |
| HCS decision publication | packages/hedera-adapter/src/hcs |
| Reconciliation of uncertain settlement | packages/hedera-adapter/src/reconciliation |
| Gated API endpoint | apps/paid-service/src/routes |
| Agent behavior | apps/orchestrator/src/agents |
| Persistent operation state and wait/resume | apps/orchestrator/src/workflows |
| Agent-callable reusable tools | packages/agent-tools/src/tools |
| UI decision card | apps/web/src/features/decisions |
| Object storage integration | packages/result-store/src/providers |
| Hosting or deploy script | infra/deploy or infra/scripts |

Empty directories contain `.gitkeep` so teammates receive them when cloning. Remove the marker after adding real files. Framework-generated files belong inside their owning module, not at the repository root.
