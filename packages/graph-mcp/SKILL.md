---
name: common-spending-memory
description: Query Common's shared spending memory — whether a paid resource has already been bought in a workspace, whether that purchase can be reused, what decisions were recorded and why, and how much has been spent. Read-only; never spending authority.
---

# Common spending memory

Common is shared spending memory for independent AI agents. When two agents need the same
paid resource, one buys it and the other discovers that purchase and reuses the result.
This skill reads that memory.

The memory is a subgraph over the `CommonBudget` contract on Hedera testnet. Payments
settle through x402, and each decision's reasoning is published to a Hedera Consensus
Service topic.

## Before you spend anything

**These tools cannot authorize a purchase, and no answer from them should be read as
permission.** Only an on-chain contract reservation authorizes spending, and it is the only
thing that stops two agents buying the same resource at once.

Three rules follow:

1. **Check `index.status` on every result.** `synced` means the memory is current.
   `lagging` or `unknown` means an absence tells you nothing — a purchase may exist that
   the index has not reached.
2. **An error is not an empty result.** If a tool returns `isError`, the index could not be
   read. That is not evidence that nothing was bought. Never buy on the strength of it.
3. **Reserve through the contract regardless.** Even with a clean "nothing found" from a
   synced index, the reservation is what makes the purchase safe.

## Finding a reuse candidate

Call `find_reuse_candidate` with the workspace label and the purchase key. It returns a
verdict per matching purchase with every check shown — delivered, usable, fresh, has a
result reference, settlement certain — so you can explain *why* something is or is not
reusable rather than asserting it.

**Then check capabilities elsewhere.** Every verdict carries
`capabilitiesMustBeCheckedElsewhere: true`, because the chain records *that* a result was
delivered and usable but not *what it can do*. A dataset may be fresh and usable and still
lack the capability you need. Confirm against the result store before relying on it.

## Reading why something was decided

`get_decision_history` returns recorded buy/reuse/wait/reject decisions. Reasoning is not
on the contract — it is in an HCS note, on a topic with **no submit key**, which anyone may
post to.

So **only trust `rationale.trustworthy === true`**. That means every identifier in the note
re-hashes to the value recorded on chain, which binds the note to the event. A note that
fails that check is returned explicitly rejected; do not repeat its text as the decision's
reasoning. And even a verified note is the agent's own claim — the consensus timestamp
attests *when* it was written, not that it is true.

Decisions recorded before HCS existed have no note and say so.

## Reading spending

`get_workspace_spending` gives budget, per-asset settled spend, acquisitions, delivery
failures and the reuse rate.

Read three fields carefully:

- **`spendByAsset` vs `rawSpendByAsset`** — a gap means duplicate settlement records were
  excluded. Amounts are integers in the smallest token unit and are never added across
  assets.
- **`reuseRate` can be `null`** — the denominator was zero. That is not a reuse rate of 0.
- **`notIndexable`** — denied reservations cannot be counted at all, because a denial
  reverts and a reverted transaction emits no logs. And the reuse count is *intention* to
  reuse, not proof that a task completed.

## Worked example

> *"Agent B needs the Uniswap top-pools dataset at block 25955502 for workspace
> demo-workspace-1789073544816. Has anyone already bought it?"*

1. `check_index_health` — confirm the memory is `synced`.
2. `find_reuse_candidate` with that workspace and
   `thegraph:token-holders:token-holders:block-25955502:demo-workspace-1789073544816`.
3. If a candidate comes back, `inspect_purchase` on its `operationId` to see the full
   lifecycle, then confirm capabilities against the result store.
4. If none, say so plainly — and reserve through the contract before buying. Do not
   present "not found" as clearance.
