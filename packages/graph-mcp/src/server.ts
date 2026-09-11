#!/usr/bin/env -S npx tsx
/**
 * stdio entrypoint. Add to an MCP client config as:
 *
 *   {
 *     "mcpServers": {
 *       "common-memory": {
 *         "command": "npx",
 *         "args": ["tsx", "<repo>/packages/graph-mcp/src/server.ts"],
 *         "env": { "GRAPH_ENDPOINT": "...", "HEDERA_MIRROR_NODE_URL": "...", "HCS_DECISION_TOPIC_ID": "..." }
 *       }
 *     }
 *   }
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configFromEnv, createGraphMemoryReader } from '@common/graph-client';
import { createMemoryServer } from './server-factory.js';

// stdout is the MCP transport. Anything written there that is not a protocol message
// corrupts the stream, so diagnostics must go to stderr.
const log = (message: string): void => {
  process.stderr.write(`[common-graph-mcp] ${message}\n`);
};

let memory;
try {
  memory = createGraphMemoryReader(configFromEnv());
} catch (err) {
  log(`configuration error: ${err instanceof Error ? err.message : String(err)}`);
  log('GRAPH_ENDPOINT is required. HEDERA_MIRROR_NODE_URL and HCS_DECISION_TOPIC_ID enable verified decision rationale.');
  process.exit(1);
}

const server = createMemoryServer({ memory });
await server.connect(new StdioServerTransport());
log('ready — read-only spending memory. This server cannot authorize a purchase.');
