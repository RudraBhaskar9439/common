/**
 * Drives the MCP server over a real stdio transport against a live index.
 *
 *   GRAPH_ENDPOINT=... npm run live:check --workspace @common/graph-mcp
 *
 * This is the end-to-end proof that an agent can reach Common's memory through MCP:
 * a real handshake, a real tool listing, real tool calls, real indexed answers.
 * Read-only. No payment, no chain write.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const WORKSPACE = process.env['CHECK_WORKSPACE'] ?? 'demo-workspace-1789073544816';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
};

const serverPath = new URL('../server.ts', import.meta.url).pathname;
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', serverPath],
  env: {
    PATH: process.env['PATH'] ?? '',
    GRAPH_ENDPOINT: process.env['GRAPH_ENDPOINT'] ?? '',
    GRAPH_CHAIN_HEAD_RPC_URL: process.env['GRAPH_CHAIN_HEAD_RPC_URL'] ?? '',
    HEDERA_MIRROR_NODE_URL: process.env['HEDERA_MIRROR_NODE_URL'] ?? '',
    HCS_DECISION_TOPIC_ID: process.env['HCS_DECISION_TOPIC_ID'] ?? '',
  },
});

const client = new Client({ name: 'common-live-check', version: '0.1.0' });

console.log('\nCOMMON — MCP live check (read-only, real stdio transport)\n');

await client.connect(transport);
check('MCP handshake completes over stdio', true);

const { tools } = await client.listTools();
check('tools are advertised', tools.length === 5, `${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);
check('every tool is annotated read-only', tools.every(t => t.annotations?.readOnlyHint === true));

const callJson = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: any }> => {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content as { type: string; text: string }[])[0]!;
  return { isError: result.isError === true, body: JSON.parse(content.text) };
};

// --- index health ----------------------------------------------------------
const health = await callJson('check_index_health', {});
check('check_index_health reports live index state', !health.isError,
  `status ${health.body.index?.status} @ block ${health.body.index?.indexedBlock}`);
check('it states that the index is not spending authority', /not spending authority/i.test(health.body.authority ?? ''));

// --- spending --------------------------------------------------------------
const spend = await callJson('get_workspace_spending', { workspaceId: WORKSPACE });
check('get_workspace_spending returns live figures', !spend.isError,
  `budget ${spend.body.budget?.amount}, acquisitions ${spend.body.successfulAcquisitions}, reuseRate ${spend.body.reuseRate}`);
check('unindexable counters are flagged', /Not indexable/.test(spend.body.notIndexable?.deniedRequests ?? ''));

// --- decisions with verified rationale ------------------------------------
const decisions = await callJson('get_decision_history', { workspaceId: WORKSPACE });
check('get_decision_history returns live decisions', !decisions.isError, `${decisions.body.decisions?.length ?? 0} decision(s)`);
const verified = (decisions.body.decisions ?? []).filter((d: any) => d.rationale?.trustworthy === true);
check('rationale is verified against the HCS note', verified.length > 0,
  verified.length > 0 ? `"${verified[0].rationale.reason}"` : 'no verified note found');

// --- the reuse question ----------------------------------------------------
const miss = await callJson('find_reuse_candidate', { workspaceId: WORKSPACE, purchaseKey: 'a-key-nobody-ever-bought' });
check('an unknown purchase key yields no candidate', !miss.isError && miss.body.candidateFound === false);
check('and refuses to be read as permission to buy', /does NOT authorize/.test(miss.body.ifNoCandidate ?? ''));

await client.close();
console.log(`\n${failures === 0 ? 'MCP server is live over stdio against the real index.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
