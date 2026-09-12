# interfaces

Evaluation types and bounded validation are accepted for the current implementation in docs/DECISIONS.md. Unknown fields and unpinned model revisions are rejected before a purchase identity is generated. The legacy spending contract below is extended with affected consumers and tests in each payment phase.

**Owner:** Rudra with team review

Shared domain types and public adapter contracts. This is a Phase 0 draft; review before freezing.

## Boundaries

Use `@common/interfaces` for shared contracts. Do not import another workspace's internal source files. Coordinate public interface changes with the lead and affected owner.

## Current state

Small scaffold implementation exists; see the root README for its limits. Run `npm run check` from the repository root. The orchestrator demo uses fixtures only.

## Handoff

Provide setup instructions, example configuration, relevant tests and evidence before marking the component complete.
