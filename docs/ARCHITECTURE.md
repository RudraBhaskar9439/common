# Architecture draft

Common connects independently running agents to one budget authority and a reusable result history. Agents receive tools, never private keys.

## Boundaries

1. The frontend calls the orchestrator with authenticated workspace context.
2. Agents query MemoryReader for candidate purchases and prior outcomes.
3. The orchestrator verifies result access, requirements and freshness before reuse.
4. New acquisitions go through SpendingAdapter and atomic contract checks.
5. A controlled signer executes the paid request; persisted operation IDs drive reconciliation.
6. ResultStore holds authorized offchain content. Public records contain safe references and selected metadata only.
7. Contract events feed the chosen Graph indexing path. HCS receives a linked decision note independently.

## Safety properties to implement and verify

- An empty or lagging Graph read never authorizes spending.
- Available budget includes pending commitments; agents cannot independently bypass the controlled funding path.
- Unknown payment status blocks release and repeat purchase until reconciliation resolves it.
- Payment and delivery are separate outcomes. Failed delivery does not erase payment or automatically authorize another charge.
- HCS retry cannot replay the payment. Event and note writes need stable IDs and deduplication.
- Workspace IDs in requests are not authentication. Bind verified identity before exposing adapters or results.
- An agent explanation is a claim; receipts and observed delivery are separate evidence.

## Unresolved Phase 0 decisions

Kavish must validate how reservations govern the actual Blocky402 signing and settlement path. Aditya must validate supported live indexing on the target deployment. The team must agree event ABI, reuse-event authority, timestamp formats, purchase-key normalization, index-lag policy and reservation behavior after policy changes.

Do not assume HCS messages are directly indexable by a regular subgraph. Prefer structured contract events with a shared decision ID if the validated provider supports that path. No bridging or custom Firehose implementation is included in the scaffold.
