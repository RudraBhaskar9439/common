import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildTools, type ToolDeps } from './tools.js';

/**
 * Builds the MCP server and registers every tool.
 *
 * Kept separate from the stdio entrypoint so the tool surface can be tested without
 * spawning a process or holding a transport open.
 */
export function createMemoryServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'common-spending-memory', version: '0.1.0' },
    {
      instructions:
        'Common is shared spending memory for AI agents. These tools answer whether a paid resource has already ' +
        'been bought in a workspace and whether that purchase can be reused.\n\n' +
        'They are READ-ONLY and are not spending authority. A negative or empty answer never authorizes a ' +
        'purchase: the on-chain contract reservation is the only thing that does, and the only thing that stops two ' +
        'agents buying the same resource. Check the `index` block on every result — if it reports `lagging` or ' +
        '`unknown`, an absence tells you nothing.\n\n' +
        'Two limits worth stating up front. Result capabilities are not indexed, so a reuse candidate must be ' +
        'checked against the result store before you rely on it. And decision rationale comes from a Hedera ' +
        'Consensus Service topic that anyone may post to, so trust it only when `rationale.binding` is "verified".',
    },
  );

  for (const tool of buildTools(deps)) {
    server.registerTool(tool.name, tool.config, tool.handler as never);
  }
  return server;
}
