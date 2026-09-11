# subgraph

**Owner:** Aditya

Schema, ABI consumption and event mappings for `CommonBudget`.

**Status: Phase 0 — nothing implemented.** `src/`, `abis/` and `tests/` are empty. The
deployment path has been verified and is recorded below; see
`docs/workstreams/aditya.md` for the proposed indexed model and
`docs/workstreams/aditya-evidence.md` for reproduction.

## Verified deployment path

The module README previously said "verify supported network and live provider deployment
first". Done, and the answer changes the plan:

**Hedera is not a supported network on The Graph.** It is absent from
[the supported-networks table](https://thegraph.com/docs/en/supported-networks/), and
Hedera's own tutorial states the hosted service is unavailable and a local graph node is
required. **Subgraph Studio and the decentralized network are unavailable for chain 296.**

The only validated path is a **self-hosted `graph-node`** against the Hashio JSON-RPC relay
(`testnet:https://testnet.hashio.io/api`), with Postgres and IPFS alongside.

Verified against relay `0.78.5`: `eth_getLogs` (to ~39.8k-block spans),
`eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getTransactionReceipt` and `eth_call` all
work. **`trace_filter` and `trace_block` return "Not yet implemented"**, so:

- **event handlers only — no `callHandlers`.** The ten `CommonBudget` events cover
  everything the read layer needs.
- reverted reservations (`PurchaseAlreadyReserved`) are unreachable by any route, so denied
  requests cannot be indexed from chain data.

Pin current tooling — `graph-node v0.45.0`, `graph-cli 0.98.1`, `graph-ts 0.38.2`,
`matchstick-as 0.6.0`. The official `hashgraph/hedera-subgraph-example` is on 2023-era
versions and should not be copied verbatim.

## Indexing target

| Field | Value |
| --- | --- |
| Network | Hedera testnet, chain id `296` |
| Contract | `0x7a6a1edE510692F5f6208733fD849833Fd86A893` |
| Start block | `40352293` — verified: folding all logs from here yields zero orphans |
| ABI | `contracts/abi/CommonBudget.json` (owner: Kavish; copy into `abis/`) |
| Events | 10, all with real logs as of 2026-09-11 |

Identifiers are `keccak256(utf8(label))`. Timestamps (`freshUntil`, `settledAt`, `expiresAt`)
are **unix seconds**. `ReservationReleased.reason`: `0` explicit, `1` expired,
`2` reconciled-absent.

Index the adapter-driven operations, not the seeded ones: the seeded `PaymentSettled` carries
`SEED-PLACEHOLDER-not-a-real-payment` and no money moved.

## Layout

- `src/` — mappings
- `abis/` — ABI copied from `contracts/abi/`
- `tests/` — matchstick unit tests over labelled fixtures

## Handoff

Provide setup instructions, example configuration, relevant tests and evidence before
marking the component complete. No live deployment is claimed until a graph-node has
actually synced.
