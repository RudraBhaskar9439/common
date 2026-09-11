# Documentation index

Read `../README.md` and `../CONTRIBUTING.md` first, then the document for your workstream.

## Start here

| Document | What it covers |
| --- | --- |
| [REMAINING_WORK.md](REMAINING_WORK.md) | **What is left, by owner, and the critical path.** Start here |
| [NEW_ARCHITECTURE.md](NEW_ARCHITECTURE.md) | **Read this first.** The Graph becomes the paid resource. Why, what changed, what did not |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Whole-system draft and trust boundaries. Superseded for the payment layer, and for the read layer by the file above |
| [BUILD_PLAN.md](BUILD_PLAN.md) | Phases, gates and the MVP checklist |
| [INTERFACES.md](INTERFACES.md) | Phase 0 interface review. Still a draft until acceptance is recorded |
| [DECISIONS.md](DECISIONS.md) | Decision log. Interface acceptance belongs here |

## As built, per workstream

| Document | Owner | What it covers |
| --- | --- | --- |
| [PAYMENT_ARCHITECTURE.md](PAYMENT_ARCHITECTURE.md) | Kavish | The money layer as built. Authoritative for payments |
| [KAVISH_IMPLEMENTATION.md](KAVISH_IMPLEMENTATION.md) | Aditya → Kavish | What is verified built, plus the exact changes the new architecture needs |
| [workstreams/kavish.md](workstreams/kavish.md) | Kavish | Phase-by-phase progress |
| [workstreams/kavish-evidence.md](workstreams/kavish-evidence.md) | Kavish | Identifiers, receipts, reproduction |
| [workstreams/aditya.md](workstreams/aditya.md) | Aditya | Graph read layer: indexed model, interface proposals, feasibility |
| [workstreams/aditya-evidence.md](workstreams/aditya-evidence.md) | Aditya | Reproduction for every Graph-side claim |
| [../packages/graph-mcp/SKILL.md](../packages/graph-mcp/SKILL.md) | Aditya | How an agent should use Common's memory, and what it must not conclude |

## Operations and delivery

| Document | What it covers |
| --- | --- |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Local setup and environment variables |
| [FILE_MAP.md](FILE_MAP.md) | Where each module lives and who owns it |
| [TASKS.md](TASKS.md) | Tasks and acceptance evidence |
| [DEMO.md](DEMO.md) | Demo storyboard and submission checklist |
| [prompts/README.md](prompts/README.md) | Individual AI master prompts |

## Two rules that hold everywhere

**Graph reads never authorize spending.** An empty or lagging index is not permission to
buy. Only the contract reservation is.

**Label mocks as mocks.** A fixture is not evidence of a live integration, and a passing
unit test is not evidence of blockchain enforcement.
