# Team master prompts

Each file is a self-contained instruction for an AI coding assistant working in a local clone of Common. Paste the entire file into the assistant, or ask it to read the file and follow it. A chat without repository access can review the plan but cannot implement or verify the code.

| Person | Master prompt | Initial task |
| --- | --- | --- |
| Aditya | [Graph work](ADITYA.md) | Review interfaces and validate the live indexing approach |
| Kavish | [Hedera and deployment](KAVISH.md) | Review spending authority and validate the real payment approach |
| Rudra | [Product and integration](RUDRA.md) | Coordinate the shared contracts and unblock both workstreams |

## Start command

```text
Read docs/prompts/ADITYA.md and follow it as my workstream instructions.
Execute Phase 0 only. Inspect the actual repository before proposing changes.
Implement the Phase 0 deliverables, verify them, and report the exit-gate status.
```

Substitute `KAVISH.md` or `RUDRA.md` for the other workstreams. After reviewing the result:

```text
Continue with Phase 1 from my master prompt. Read my workstream progress file
and the latest accepted interface decisions first. Execute this phase only.
Keep working on independent tasks if a teammate's live component is unavailable.
Report verified work, remaining gates and the exact handoff needed.
```

Continue with Phase 2, then 3, 4 and 5 using the same pattern. Request changes to a phase if its evidence is weak. Do not tell all three assistants to build the whole project in one pass.

## Team rhythm

1. Each person uses a separate local clone or worktree and a workstream branch. Never run three assistants against one shared checkout.
2. Run Phase 0 in parallel. Rudra consolidates the proposed event ABI, public types and error/state semantics into one accepted version.
3. Run Phases 1 and 2 independently with agreed fixtures. Validate live payment and indexing feasibility early.
4. Rudra leads Phase 3 integration; each component owner fixes their own component.
5. Run Phase 4 failure tests, then Phase 5 deployment and handoff.

The relative days in the build plan are targets. Evidence gates determine readiness. A mock keeps development moving but does not satisfy a live-integration gate.

## Collision prevention

- Aditya writes progress to `docs/workstreams/aditya.md`.
- Kavish writes progress to `docs/workstreams/kavish.md`.
- Rudra writes progress to `docs/workstreams/rudra.md` and maintains central TASKS and DECISIONS.
- Interface proposals go into the author's workstream file first; Rudra coordinates changes to shared files.
- Owners may update their workspace dependencies and resulting lockfile; serialize dependency PRs and regenerate conflicts rather than hand-editing lockfiles.
- CODEOWNERS is not a substitute for this process. Teammate handles and review enforcement still need to be configured.

These prompts authorize phased implementation work when given to an assistant. They do not authorize publishing the private repository, inviting collaborators, paid infrastructure, mainnet spending or unrequested communications.
