# Kavish master prompt

You are my AI engineering partner. I am Kavish, responsible for Hedera, payment enforcement and deployment for Common, our ETHOnline 2026 project. Implement my work in phases in the existing repository: https://github.com/RudraBhaskar9439/common. Do not rebuild it elsewhere.

## Product and your responsibility

Common lets independent agents share a budget and reuse paid results. Competing requests must not create duplicate purchases. A real x402-gated data service is consumed through a controlled payment path. Decision notes on HCS record what was chosen, what was rejected and why, linked to receipts and outcomes. The Graph indexes agreed events for discovery and history.

I own the spending authority, smart contracts, Hedera adapter, paid API, Blocky402 integration, HCS writes and infrastructure. Aditya owns Graph queries and mappings. Rudra owns the agents, orchestration, result storage and frontend. Make my component easy to integrate without implementing theirs.

## Read first and respect ownership

Read AGENTS.md, README.md, CONTRIBUTING.md, docs/FILE_MAP.md, docs/ARCHITECTURE.md, docs/INTERFACES.md, docs/DECISIONS.md, packages/interfaces/src/index.ts and the READMEs in contracts, packages/hedera-adapter, apps/paid-service and infra. Inspect current Git state and progress. The current live factories may still be explicit stubs.

Own `contracts/**`, `packages/hedera-adapter/**`, `apps/paid-service/**`, `infra/**`, and `docs/workstreams/kavish.md`. Create the progress file if absent. Propose shared-type or ABI changes there and coordinate with Rudra and Aditya before consumers are required to adopt them. Do not edit another owner's module or central task trackers. Module dependency changes include their generated lockfile updates and must be flagged to Rudra.

Use your own clone/worktree and a short branch such as `codex/kavish-phase-1`. Preserve other work. Keep keys out of code, fixtures, logs and Git. Never supply private keys to the model-driven agent. Import public package exports only.

## Phase execution and authorization

Start with Phase 0 only unless I select another phase. Implement and verify the chosen phase, then report its gate. Make routine technical choices autonomously. Record missing access or external decisions and continue independent work with explicit fixtures. Never invent a transaction, service URL or deployment result.

Use local development and Hedera testnet for this workstream. Free testnet deployments using provided development credentials are within the selected implementation phase. Mainnet transactions, real-money spending, paid cloud plans, repository publication and permission changes need separate explicit authorization. Observe tool-specific approval requirements. Verify current Hedera SDK, Blocky402/x402 behavior and sponsor requirements from official documentation.

## Non-negotiable properties

- Reservations enforce budget and duplicate checks atomically.
- A signer cannot bypass the reservation authority through another application path.
- Operation IDs persist across retries; unknown settlement blocks budget release and another payment until reconciled.
- Payment and delivery are separate. Delivery failure preserves payment evidence and does not trigger blind repurchase.
- HCS failure retries the note, not the payment. Events and HCS writes are not assumed atomic.
- Public evidence must omit private result content and credentials. A recorded reason is an explanation, not proof of truth.

## Phase 0 prove the proposed architecture is coherent

1. Run baseline checks and inspect SpendingAdapter and all payment states.
2. Trace the exact path from funding to reservation, signing, facilitator settlement and delivered result. Identify every entity that can move funds.
3. Verify whether the intended facilitator/signing path supports the desired contract-controlled funding model. If not, document the mismatch and a bounded alternative with explicit trust assumptions. Never claim non-bypassable onchain enforcement from a database reservation or advisory contract alone.
4. Propose operation transitions, unknown-settlement behavior, reservation expiry and current-policy handling.
5. Coordinate a minimal event ABI with Aditya, including purchase, delivery/outcome and successful reuse evidence. Define authorized submitters and logical IDs.
6. List required testnet access and configuration without requesting secrets in chat. Identify the smallest real paid-request experiment.

Deliverable: your workstream architecture proposal and feasibility checklist. Exit gate: the funding/control model and experiment are explicit; unresolved compatibility is clearly identified for team review. Do not freeze interfaces unilaterally.

## Phase 1 payment feasibility and isolated components

1. Stand up the smallest useful x402-gated dataset API and consume it through the intended Blocky402 flow.
2. Demonstrate one actual testnet payment with verifiable receipt, request/result linkage and setup instructions.
3. Exercise the controlled signing path. Document precisely which enforcement is onchain and which trusts an operator.
4. Build an initial contract test harness for authorization, available-budget checks and competing reservations, following the reviewed framework choice.
5. Implement a small HCS write/read-verification experiment with an ordinary public-safe decision record.
6. Give Aditya the reviewed ABI and sample events early; give Rudra typed adapter examples and actual errors.

Exit gate: real testnet request works through the proposed controlled path, and the contract approach has relevant local evidence. If access blocks the experiment, continue contract and API work but leave the live payment gate incomplete.

## Phase 2 implement spending and audit behavior

Implement workspace funding/accounting, agent permissions, atomic reservations, policy checks, expiry and release rules. Bind the payment request to its operation, resource, amount, token and intended recipient; an operation identifier alone must not let a caller change the purchase.

Complete SpendingAdapter behind the public interface. Persist or expose the durable reconciliation information required by Rudra's orchestrator. Do not introduce a conflicting second operation database without agreement on state ownership. Export canonical ABI artifacts from contracts for Aditya rather than maintaining divergent hand-written copies.

Record settlement and delivery independently, and record decision notes with stable IDs. Design event/note retries and logical deduplication explicitly. Explain how a receipt is verified and what the provider can or cannot guarantee about repeat requests. Do not promise exactly-once payment unless the implemented protocol and reconciliation behavior justify it.

Exit gate: component tests prove authorization, budget enforcement and safe retry behavior; contract events, HCS records and receipts link correctly for a real operation.

## Phase 3 integrate and deploy the development stack

Supply Rudra a configured adapter, public contract addresses, ABI version, operation examples and typed error behavior. Supply Aditya chain ID, address, start block and actual sample logs. Resolve mismatches inside your modules.

Under infra, add reproducible local/development deployment commands and health checks. Each application owner supplies their build/start command; do not take over their implementation. Clearly document required external configuration, process persistence and recovery. Do not sign up for paid infrastructure or publish the private repository.

Exit gate: the integrated workflow executes a real testnet purchase and exposes the matching event and HCS evidence. Missing Graph/UI work is an integration dependency, not a reason to implement those modules yourself.

## Phase 4 prove failure behavior

Test concurrent reservation attempts, insufficient funds, unauthorized agents, stale permissions, repeated execution IDs, crash before payment, crash after submission, unknown settlement, expiry near settlement, paid delivery failure and failed HCS publication. A repeated operation ID with conflicting parameters must be rejected. Token values must remain exact integer amounts.

Run contract tests and adapter/service tests through explicit commands, plus root `npm run check` and `npm run demo:mock`. Add runnable component tests; root scaffold tests alone prove no Hedera properties.

Exit gate: critical money/recovery tests pass, observed transactions reconcile, and logs can be shared safely as evidence.

## Phase 5 deployment and handoff

Provide testnet addresses, HCS topic identifiers, deployment version, service URL, setup and restart runbook, health checks and secret-variable names without values. Document pause/revoke/recovery behavior and limitations. Prepare receipt evidence and a short explanation of the Hedera contribution.

Check current sponsor criteria: HCS notes supplement the required working x402 service and paid consumption; they do not replace that flow. Send Rudra a reviewable PR or commits when Git access is available. Do not merge into main or change repository visibility yourself.

Exit gate: another teammate can reproduce the paid request, inspect linked evidence and operate the development deployment without undocumented manual steps.

## Report after each phase

Update your own progress file and module READMEs. Report phase/gate status, files changed, commands and actual results, live versus mocked evidence, interface proposals, trust assumptions, blockers with fallback and the exact handoffs for Aditya and Rudra. Execute the selected phase now, defaulting to Phase 0.
