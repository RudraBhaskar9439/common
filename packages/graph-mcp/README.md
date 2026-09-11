# graph-mcp

**Owner:** Aditya

MCP server exposing Common's indexed spending memory to AI agents. An agent — or a person
in Claude Code, Claude Desktop or Cursor — can ask *"has anyone here already bought this,
and was it any good?"* in natural language.

**Read-only by construction.** This package imports the Graph read client and nothing that
can write a contract, sign a transfer or publish to HCS. No prompt can reach a payment path
because one is absent from the dependency graph. A test asserts that, so it stays true.

## Why this exists

Common's memory is only useful if something consults it before spending. A subgraph you
have to write GraphQL against is not that. These five tools are the memory in a form an
agent actually reaches for, and each one is shaped around the same problem: **a language
model will act on a confident-sounding answer**, so the answers have to carry their own
caveats.

## Setup

```jsonc
{
  "mcpServers": {
    "common-memory": {
      "command": "npx",
      "args": ["tsx", "<repo>/packages/graph-mcp/src/server.ts"],
      "env": {
        "GRAPH_ENDPOINT": "http://localhost:8000/subgraphs/name/common/budget",
        "GRAPH_CHAIN_HEAD_RPC_URL": "https://testnet.hashio.io/api",
        "HEDERA_MIRROR_NODE_URL": "https://testnet.mirrornode.hedera.com",
        "HCS_DECISION_TOPIC_ID": "0.0.10465595"
      }
    }
  }
}
```

Only `GRAPH_ENDPOINT` is required. Without `GRAPH_CHAIN_HEAD_RPC_URL` sync status reports
`unknown` rather than guessing; without the mirror-node pair, decision rationale reports as
unavailable rather than being invented.

## The tools

| Tool | Answers |
| --- | --- |
| `find_reuse_candidate` | Has this workspace already bought this resource, and can it be reused? |
| `get_decision_history` | What was chosen, what was rejected, and why — where a verified note exists |
| `get_workspace_spending` | Budget, per-asset spend, acquisitions, delivery failures, reuse rate |
| `inspect_purchase` | The full lifecycle of one operation, for verifying a candidate |
| `check_index_health` | How far behind the chain the memory is |

## Four things it refuses to do

These are the point of the package, not caveats bolted on.

**It never authorizes a purchase.** "No candidate found" comes back as an explicit verdict
carrying *"Absence of a candidate does NOT authorize a purchase"*, never as a bare empty
list that reads like permission. The contract reservation is the only spending authority
and the only thing preventing two agents buying the same resource.

**It never lets a stale answer look fresh.** Every result embeds the index state *inside
the payload*, where a model will actually read it. A `lagging` index returns
*"THE INDEX IS BEHIND THE CHAIN… Absence proves nothing."*

**It never turns a failure into an empty result.** An unreachable index raises
`isError` with *"This is a failure to read the index, NOT evidence that nothing was
purchased."* Conflating the two is how an agent pays twice.

**It never presents an unverified claim as reasoning.** Decision rationale lives on a
Hedera Consensus Service topic with **no submit key** — anyone may post to it. So each note
is verified by re-hashing its identifiers against the indexed values, and only
`rationale.binding === "verified"` is marked trustworthy. A forged note is returned
explicitly rejected. Anyone can post to the topic; nobody can post at a sequence number the
contract already committed to.

## One limit worth stating loudly

`find_reuse_candidate` returns `capabilitiesMustBeCheckedElsewhere: true` on every verdict.
Result capabilities are **not indexed** — `DeliveryRecorded` carries no capability field —
so a candidate must be checked against the result store before anything relies on it.

## Verification

```sh
npm test --workspace @common/graph-mcp        # 13 tests, no network

# against a live index, over a real stdio transport
GRAPH_ENDPOINT=http://localhost:8000/subgraphs/name/common/budget \
HEDERA_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com \
HCS_DECISION_TOPIC_ID=0.0.10465595 \
npm run live:check --workspace @common/graph-mcp
```

The live check performs a real MCP handshake, lists the tools, and calls four of them
against the deployed subgraph. Observed:

```
PASS  MCP handshake completes over stdio
PASS  tools are advertised                        5 tools
PASS  every tool is annotated read-only
PASS  check_index_health reports live index state status synced @ block 40396305
PASS  get_workspace_spending returns live figures budget 500000000, acquisitions 1, reuseRate 0.5
PASS  rationale is verified against the HCS note  "A fresh delivered result already exists for this purchase key."
PASS  an unknown purchase key yields no candidate
PASS  and refuses to be read as permission to buy
```

Stubs exist only in `tests/`. No `src/` path has a mock, fallback or fake-success mode.
