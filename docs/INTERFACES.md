# Phase 0 interface review

`packages/interfaces/src/index.ts` is the executable draft. All three people must review it before treating it as frozen.

| Boundary | Provider owner | Consumer |
| --- | --- | --- |
| SpendingAdapter | Kavish | Orchestrator and agent tools |
| MemoryReader | Aditya | Orchestrator and agent tools |
| ResultStore | Rudra | Orchestrator and agent tools |
| DecisionRecord | Shared | HCS writer, event writer, UI |

## Review checklist

- [ ] Agree operation and decision identifier formats and collision prevention.
- [ ] Define canonical purchase-key normalization, freshness buckets and workspace scope.
- [ ] Confirm token identity, decimals and integer unit handling.
- [ ] Agree contract ABI and who may submit successful reuse evidence.
- [ ] Define allowed state transitions and how policy changes affect reservations.
- [ ] Define unknown-settlement reconciliation and safe release rules.
- [ ] Agree HCS/event retry, deduplication and linking fields.
- [ ] Define result authorization and privacy-safe indexed metadata.
- [ ] Define Graph pagination and synchronization expectations.
- [ ] Review fixtures and error codes with all consumers.

The starter reuse helper evaluates a single returned page. It does not handle retries, authorization, completed-deliverable verification or exhaustive pagination. Those are explicit implementation tasks, not hidden guarantees.

## Dependency direction

Interfaces import no project implementation. Graph and Hedera adapters depend on interfaces, not each other. Agent tools depend on interfaces and receive adapters as arguments. The orchestrator chooses and wires real implementations or mocks. Private source-file imports across modules are prohibited by team convention.
