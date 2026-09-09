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
