/**
 * MCP server exposing Common's indexed spending memory to AI agents.
 *
 * Read-only by construction: this package imports the Graph read client and nothing that
 * can write a contract, sign a transfer or publish to HCS. No prompt can reach a payment
 * path from here, because one does not exist in this dependency graph.
 */
export { buildTools, evaluateReuse, indexNote } from './tools.js';
export type { IndexNote, ReuseVerdict, ToolDefinition, ToolDeps } from './tools.js';
export { createMemoryServer } from './server-factory.js';
