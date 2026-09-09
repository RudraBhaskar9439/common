# Repository instructions

Read README.md, CONTRIBUTING.md, docs/FILE_MAP.md and the target module README before editing.

- Preserve the ownership split: Aditya owns Graph; Kavish owns Hedera and infrastructure; Rudra owns product and integration.
- Treat packages/interfaces as a proposed Phase 0 contract until the team records acceptance in docs/DECISIONS.md.
- Shared interface changes require explicit coordination and changes to affected fixtures and clients in the same PR.
- Implement inside the owning module. Import other workspaces through their public package exports, not relative paths into their internals.
- Do not introduce real payment behavior, production defaults or fake-success live adapters without the relevant task scope.
- Never release a reservation while payment settlement is unknown; reconcile first. Retries must use stable operation IDs.
- Graph reads cannot authorize spending. Result reuse must check access, freshness, capability and observed outcome.
- Keep mocks explicitly labeled. Do not describe mock tests as evidence of blockchain enforcement.
- Do not commit credentials, generated build output or local document-rendering intermediates.
- Use npm workspaces and commit package-lock.json. Coordinate root dependency and workflow changes with Rudra.
- For TypeScript changes run npm run check and npm run demo:mock. Add meaningful tests for newly implemented spending and recovery behavior.
- No proactive subagents unless the user explicitly requests them.
