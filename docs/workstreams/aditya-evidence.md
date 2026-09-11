# Graph workstream — evidence

Reproduction for every claim in `docs/workstreams/aditya.md`. Read-only: no keys, no writes,
no deployment. Phase 0, 2026-09-11.

`RPC=https://testnet.hashio.io/api`, `ADDR=0x7a6a1edE510692F5f6208733fD849833Fd86A893`.

---

## 1. Baseline checks

```sh
git clone <repo> && cd common
npm ci                      # lockfile unchanged afterwards: git status --porcelain package-lock.json
npm run check               # typecheck + build + 10 tests
npm run demo:mock
```

Observed: `npm run check` → `# pass 10 / # fail 0`, exit 0.
`npm run demo:mock` → reuse decision on fixtures, `newPaymentsExecuted: 0`.
Node used locally: **v22.17.0** (declared `>=24 <27` — discrepancy noted, not blocking).

---

## 2. Deployment is real

```sh
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"result":"0x128"}                       -> 296

curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'$ADDR'","latest"]}'
# 0x6080604081815260049081361015...        -> bytecode present

curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"web3_clientVersion","params":[]}'
# {"result":"relay/0.78.5"}
```

---

## 3. Log inventory, and that 159 is not a truncation

Full range `40352293` → head returns **159** logs. Ten 500-block chunks across
`40352300–40357299` sum to **159** (9, 0, 0, 20, 9, 14, 41, 18, 48, 0), so the relay is
returning complete result sets, not a capped page.

Decoded against `contracts/abi/CommonBudget.json`:

```
 40 PurchaseReserved      13 PaymentPending       9 PaymentSettled
 26 AgentAuthorized       13 WorkspaceFunded      8 DeliveryRecorded
 24 ReservationReleased   14 WorkspaceCreated     6 DecisionRecorded
                                                  6 SettlementUnknownFlagged
```

All ten event types have real logs, including `ReservationReleased`
(reason 0 ×15, reason 1 ×5, reason 2 ×4), which `contracts/README.md` still lists as absent.

**Start block check:** folding all 159 logs into Workspace/Purchase/Decision produced
**0 orphans** — every `operationId`-keyed event resolved to a `PurchaseReserved` in range.
40 operations: 19 released, 7 reserved, 6 delivered, 5 expired, 2 delivery-failed, 1 paid.
14 workspaces, 1 created but never funded.

---

## 4. Values the mappings must handle

```
asset        : '0.0.0' on all 40 reservations          (HBAR; decimals 8 per hedera-adapter)
amount       : 50000000 tinybar on all 40              (0.5 HBAR)
resource     : 'http://localhost:3002/datasets/daily-transfers' on all 40
payTo        : 0.0.10463485, 0.0.10463575
agentIds     : 2 distinct;  workspaces: 13 reserving;  purchaseKeys: 30 distinct over 40 ops
              -> 10 purchase keys carry more than one operation
freshUntil   : unix seconds (adapter.ts:317, seed-testnet.js:112)
resultRef    : "" on both usable=false deliveries
hcsSeqNumber : "" on 4 of 6 decisions; "1" and "2" on the newest two
decisionType : 1 (reuse) on all 6 — no buy/wait/reject on chain
```

---

## 5. One real transfer recorded as two settlements

9 `PaymentSettled` events, 9 distinct raw ids, **8 distinct canonical transfers**:

```
block 40354349  op 0x36ae15c999982586…  ws 0xb07e3f1399062affc3… (demo-workspace-1789069182855)
                purchaseKey 0x37b9fbfda5…  agent 0x61f0ffa6b3…
                txid 0.0.7162784@1789069246.329605799   settledAt 1789069256

block 40355252  op 0x9f43ff32ad270a39…  ws 0x846f76a082d34453… (unlabelled)
                purchaseKey 0x48f6637acd…  agent 0x61f0ffa6b3…
                txid 0.0.7162784-1789069246-329605799   settledAt 1789071185
```

Canonicalising `0.0.X-sec-nanos` → `0.0.X@sec.nanos`:

```
sum of all PaymentSettled.amount    : 450000000 tinybar
de-duplicated by canonical txid     : 400000000 tinybar   (12.5% lower)
```

Different workspaces, so per-workspace spend is unaffected; only totals above workspace
scope double-count. Reported to Kavish as an observation, not a diagnosis.

---

## 6. The three MemoryReader queries, folded from real logs

Evaluated at the latest on-chain `settledAt` (1789074285):

```
reuse candidates (paid -> delivered usable -> freshUntil > now -> resultRef present): 6 of 40
  ws 0x118a93bbb1…  ref result-daily-transfers-1   fresh for 77199s
  ws 0x7937fe83bd…  ref result-1789068849025       fresh for 81047s
  ws 0xb07e3f1399…  ref result-1789069182855       fresh for 81380s
  ws 0xd8a21a516c…  ref result-1789072883537       fresh for 85085s

correctly excluded, delivery said unusable:
  op 0x4da13eddb2…  "provider returned a corrupt payload"  resultRef ""
  op 0x17ae0f069d…  "provider returned a corrupt payload"  resultRef ""

decision history: 6 records, all type=reuse
workspace stats : 14 workspaces; 1 unfunded (budget 0) — empty-workspace case is real data
```

---

## 7. The capability gap, against the real consumer

A `Purchase` built from **only** ABI-emitted fields, from the delivered operation in
`demo-workspace-1789073544816`, passed through the real `findReusablePurchase`
(`packages/agent-tools/src/index.ts`):

```
freshUntil    2026-09-11T20:53:44.000Z
capabilities  []                        <- nothing on chain populates this

findReusablePurchase(capabilities: ["historical-data"]) -> null  <-- rejected
findReusablePurchase(capabilities: [])                  -> CANDIDATE FOUND
```

`apps/orchestrator/src/demo.ts` requests `['historical-data']`. Capabilities do exist, but
off-chain: `apps/paid-service/src/providers/datasets.ts` defines them and `server.ts:159`
returns them in the paid response body.

The probe was run from a throwaway directory and deleted; it is not committed.

---

## 8. Relay capability matrix

Against relay `0.78.5`:

| Method | Result |
| --- | --- |
| `net_version` | `296` |
| `eth_getLogs` | OK to 39,834-block spans; no range error |
| `eth_getBlockByNumber` (full tx, incl. `0x0`,`0x1`,`0x2`) | OK |
| `eth_getBlockByHash` | OK |
| `eth_getTransactionReceipt` | OK |
| `eth_call` | OK (reverted correctly on junk calldata) |
| `trace_filter` | **`-32601 Not yet implemented`** |
| `trace_block` | **`-32601 Not yet implemented`** |
| `debug_traceBlockByNumber` | `-32602` (tracer config required) |

Consequences: event handlers only, no `callHandlers`; reverted reservations are unreachable
by any route, so `deniedRequests` cannot be indexed.

`eth_getLogs` with `toBlock` past the head returns **`[]`, not an error** — verified at
`toBlock` = head + ~10k. A client must not read that as "no data".

25 sequential `eth_blockNumber` calls: 25 × HTTP 200, no throttling observed.

---

## 9. Identifier scheme

`toId = keccak256(utf8(label))` (`packages/hedera-adapter/src/contracts/budget-client.ts:59`,
ethers `id()`). Verified by hashing labels and matching against on-chain workspace ids:

```
PRESENT  demo-workspace-1789073544816    PRESENT  demo-workspace-1789069182855
PRESENT  drill-workspace-1789073972630   PRESENT  demo-workspace-1789068849025
PRESENT  workspace-1
```

9 further on-chain workspace ids have no label I was given — preimages are unrecoverable,
which is why unresolved identifiers will surface as labelled hex.

---

## 10. Tooling versions

| | Hedera official example | Current |
| --- | --- | --- |
| `graph-node` | `v0.27.0` | **`v0.45.0`** (2026-08-03) |
| `@graphprotocol/graph-cli` | `0.33.0` | **`0.98.1`** |
| `@graphprotocol/graph-ts` | `0.27.0` | **`0.38.2`** |
| `matchstick-as` | `0.5.0` | **`0.6.0`** |

`hashgraph/hedera-subgraph-example`: 11 commits, last substantive change 2023, one
dependency audit 2025-01-15. Stale; its one durable detail is the provider string
`ethereum: 'testnet:https://testnet.hashio.io/api'`.

Hedera is absent from <https://thegraph.com/docs/en/supported-networks/>; Hedera's own
tutorial states the hosted service is unavailable and a local graph node is required:
<https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-subgraph-using-the-graph-and-json-rpc>

---

## What this evidence does not show

- **No subgraph exists yet.** Section 6 is an event fold written for verification, not a
  deployed subgraph, and not a `MemoryReader`.
- **No graph-node has been run.** The deployment path is sourced and the relay is probed;
  live indexing is unproven.
- **Nothing was deployed, pushed or published.**
- The seeded `PaymentSettled` carries `SEED-PLACEHOLDER-not-a-real-payment`; it is a log to
  index, not payment evidence.
