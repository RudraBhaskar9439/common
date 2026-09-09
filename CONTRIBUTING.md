# Team workflow

## Ownership

Aditya owns Graph reads. Kavish owns spending enforcement, Hedera integrations and infrastructure. Rudra owns application behavior and integration, and merges shared configuration changes. A component owner repairs their component during integration.

GitHub handles for Aditya and Kavish have not been supplied, so CODEOWNERS does not assign invented accounts. The ownership map is documented now; add their verified handles and repository access separately.

## Branch and PR flow

1. Pull `main` and select a task from docs/TASKS.md.
2. Create a short branch such as `codex/graph-discovery`, `codex/hedera-reservations` or `codex/agent-tools`.
3. Work primarily within your owned folders. Keep PRs small and merge daily.
4. Run `npm run check` and `npm run demo:mock`. Run your component's additional tests once implemented.
5. Open a PR with the trigger, resulting behavior, validation and any interface impact.
6. Ask the relevant owner to review shared-boundary changes before merge.

This is a documented workflow, not a claim that branch protection is configured. GitHub plan capabilities and team access should be checked before enabling required review rules.

## Avoid waiting on teammates

- Use shared fixtures and dependency injection when a live endpoint is unavailable.
- Give each module a README, example configuration and runnable verification command.
- If a boundary fails, open a blocker with owner, evidence, next action and fixture fallback.
- Do not quietly redefine response shapes or edit another module to work around an undocumented interface mismatch.
- The lead decides scope that day when a foundational integration is blocked.

## Dependencies and configuration

Install module-specific runtime dependencies in that workspace, for example `npm install <package> --workspace @common/graph-client`. Root dev tooling and the lockfile are shared: coordinate changes to reduce merge conflicts. Use module-local `.env.example` files; copy them to `.env` locally. No environment loader is configured yet, and there is no production credential fallback.

## Definition of done

A task needs working code, relevant verification, setup instructions and linked evidence. A stub, TODO or fixture is not a completed live integration. Update docs/TASKS.md only with observed progress.
