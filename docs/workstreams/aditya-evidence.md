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

---

## 11. HCS decision notes bind to the indexed events

Topic `0.0.10465595` (from `docs/workstreams/kavish-evidence.md`), read via the mirror node.

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10465595/messages?limit=5&order=asc"
# 2 messages; base64-decode .messages[].message
```

Both notes carry the fields `DecisionRecorded` omits — `chosen`, `rejected`, `reason`,
`createdAt` — **and plaintext identifiers**. Re-hashing those with `keccak256(utf8(x))` and
comparing to the indexed `bytes32`:

```
HCS seq 1  (DecisionRecorded at block 40356185)
  MATCH  decisionId   "decision-b-1789073075596"      -> 0x4df61cd63e8d…
  MATCH  workspaceId  "demo-workspace-1789073075596"  -> 0x2559c95fea8e…
  MATCH  agentId      "agent-b"                       -> 0xa2faf6b08bba…
  MATCH  operationId  "op-a-1789073075596"            -> 0x07cba33099af…

HCS seq 2  (DecisionRecorded at block 40356400)
  MATCH  decisionId   "decision-b-1789073544816"      -> 0xdd3811334e6e…
  MATCH  workspaceId  "demo-workspace-1789073544816"  -> 0xce2d9c7f59da…
  MATCH  agentId      "agent-b"                       -> 0xa2faf6b08bba…
  MATCH  operationId  "op-a-1789073544816"            -> 0x640a27e8643b…
```

8 of 8 fields matched. The other 4 `DecisionRecorded` logs carry
`hcsSequenceNumber: ""` and have no note — rationale is unavailable for those, by design.

The topic has **no submit key**, so anyone may post. The four-way keccak check is what makes
a hydrated note trustworthy: nobody can post at a sequence number the contract already
committed to.

---

## 12. Counter reconciliation against the mirror node

The transfer that `PaymentSettled` recorded against two operations:

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1789069246-329605799"
# mirror-node records: 1   result SUCCESS
#   0.0.10463485  -50000000 tinybar
#   0.0.10463575  +50000000 tinybar
```

**One** transfer. The ledger records it as the settlement of two operations.

Every payment the seller actually received:

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions\
?account.id=0.0.10463575&transactiontype=CRYPTOTRANSFER&limit=100&order=desc"

SUCCESSFUL 0.5 HBAR payments received : 8
distinct canonical transaction ids    : 8
total actually received               : 400000000 tinybar

  0.0.7162784@1789074269.171588287     0.0.7162784@1789072186.495089661
  0.0.7162784@1789073600.680467509     0.0.7162784@1789069246.329605799
  0.0.7162784@1789073145.346612118     0.0.7162784@1789068900.780108208
  0.0.7162784@1789072946.072249776     0.0.7162784@1789067662.127260536
```

| Source | Payments | Tinybar |
| --- | --- | --- |
| Mirror node — ground truth | **8** | **400,000,000** |
| `PaymentSettled` events, naive | 9 | 450,000,000 |
| …excluding the seed placeholder | 8 | 400,000,000 |
| …de-duplicated by canonical id | **7** | **350,000,000** |

Canonical dedup collapses exactly the one pair the mirror node says is a single transfer,
and nothing else — so the rule is verified against independent ground truth.

The naive 8-event total matches the mirror node **by coincidence**: it double-counts
`@1789069246.329605799` and omits `@1789067662.127260536`, which was a standalone `pay:once`
test with no reservation and so never reached `recordSettlement`. Two offsetting errors.

---

## 13. LIVE: graph-node v0.45.0 indexes Hedera testnet

The open question from Phase 0 — whether a current `graph-node` can sync Hedera at all —
is answered. **It can.**

```sh
cd subgraph
npm install
npm run node:up                 # graph-node v0.45.0 + postgres 16 + ipfs, docker compose
npm run create:local
npm run deploy:local
```

Chain accepted at startup:

```
INFO Creating transport, capabilities: archive, traces, url: https://testnet.hashio.io/api
INFO Creating block ingestor, network_name: testnet
INFO Starting block ingestor for network, kind: ethereum, network_name: testnet
INFO Syncing 1 blocks from Ethereum, latest_block_head: 40394941, current_block_head: 40394940
```

Synced to the head, healthy:

```json
{"synced": true, "health": "healthy",
 "chains": [{"latestBlock": {"number": "40394976"},
             "chainHeadBlock": {"number": "40394976"}}]}
```

~42,700 blocks from start block 40352293 to the head, no fatal error, no halt.

### Two gotchas worth writing down

**`eth_getBlockReceipts` is unsupported by the relay.** graph-node probes for it, logs a
warning and carries on with individual receipt calls. Non-fatal, and it appears in the log
as an alarming HTTP 400:

```
WARN Skipping use of block receipts, reason: Error fetching block receipts: HTTP error 400
     ... Expected 0x prefixed hexadecimal block number ...
```

**Postgres must run natively.** On Apple silicon a corrupted `postgres:16` layer produced
`exec /usr/local/bin/docker-entrypoint.sh: accessing a corrupted shared library` and the
container exited 255 before graph-node could connect. `docker rmi postgres:16 && docker
pull --platform linux/arm64 postgres:16` fixed it. `graph-node` itself is published for
amd64 only and runs under emulation; that works. The compose file uses named volumes —
a macOS bind mount under `PGDATA` is a known source of trouble.

---

## 14. LIVE: indexed counters reconcile with the raw event log

The independent raw-log fold in §6 was computed before the subgraph existed. The deployed
subgraph agrees with it exactly:

| | Raw log fold (§6) | Live subgraph |
| --- | --- | --- |
| Workspaces | 14 | **14** |
| Purchases | 40 | **40** |
| Decisions | 6 | **6** |
| Distinct canonical transfers | 8 | **8** |
| Reuse candidates | 6 | **6** |

The subgraph **independently rediscovered the duplicated transfer** from live chain data,
without being told about it:

```
duplicated records : 1   0.0.7162784@1789069246.329605799 x2
placeholders       : 1   SEED-PLACEHOLDER-not-a-real-payment
indexed block      : 40394988 | indexing errors: false
```

Reuse candidates, from the live index — the query agent B needs:

```
result-1789073075596      ws 0x2559c95fea…   freshUntil 1789159563
result-1789068849025      ws 0x7937fe83bd…   freshUntil 1789155332
result-1789069182855      ws 0xb07e3f1399…   freshUntil 1789155665
result-1789073544816      ws 0xce2d9c7f59…   freshUntil 1789160024
result-1789072883537      ws 0xd8a21a516c…   freshUntil 1789159370
result-daily-transfers-1  ws 0x118a93bbb1…   freshUntil 1789151484
```

Correctly excluded, with `resultRef` mapped to null rather than an empty reference:

```
0x17ae0f069d67…  resultRef: null | provider returned a corrupt payload
0x4da13eddb261…  resultRef: null | provider returned a corrupt payload
```

Spend, with the de-duplication doing its job:

```
de-duplicated total :  400000000 tinybar
raw total           :  450000000 tinybar
```

The 50,000,000 difference is the duplicated record, excluded exactly once.

---

## 15. LIVE: the client reads the live index

```sh
cd packages/graph-client
GRAPH_ENDPOINT=http://localhost:8000/subgraphs/name/common/budget \
GRAPH_CHAIN_HEAD_RPC_URL=https://testnet.hashio.io/api \
HEDERA_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com \
HCS_DECISION_TOPIC_ID=0.0.10465595 \
npm run live:check
```

All checks passed across five workspaces. The two results worth highlighting:

**Rationale verified end to end, against the real HCS topic:**

```
demo-workspace-1789073544816
  PASS  decision reuse    agent agent-b | rationale: verified
        reason: "A fresh delivered result already exists for this purchase key."
```

The plaintext `agent-b` appears because the note's identifiers re-hashed to the indexed
`bytes32`. Decisions that predate HCS report `rationale: no note on chain` and keep the
hex identifier — no guessing.

**Index lag reported as a fact, not a hope:** `index synced @ 40395016`, from `_meta`
compared against the live chain head.

**Placeholder excluded from spend:** `workspace-1` shows `dedup 0 vs raw 50000000`, which
is the seeded settlement correctly contributing nothing.

---

## What sections 13-15 do NOT show

- **The index is local.** A self-hosted `graph-node` on `localhost:8000` is "local-only",
  which the ETHOnline Graph track explicitly disqualifies. This proves the pipeline works;
  it does not satisfy that requirement.
- **No payment was made** and no key was used. Everything here is read-only.
- **The paid Graph query path is not yet live** — `apps/paid-service` now queries a
  Subgraph, but that has only been exercised against a stubbed provider, not a real
  gateway with an API key.
