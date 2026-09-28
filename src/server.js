/*
 * The MCP server.
 *
 * A fresh instance is created per connection because McpServer holds
 * per-connection state.
 *
 * Every tool lives in its own file under ./tools/. Adding one means two edits:
 * the new file, and an import plus an entry in TOOL_MODULES below. Nothing else
 * registers tools - listTools() and the CLI both read this array, so a tool
 * registered outside it would be invisible to both.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import securityInstruction from "./tools/security-instruction.js";

export const SERVER_ID = "lxagents-security";
export const SERVER_TITLE = "LXAgents Security";

/*
 * The whole surface. Nothing here takes a verb, and no tool in this repository
 * reaches a network or a credential - the code that would write is absent, not
 * disabled. A repository pointed at this server cannot mutate the set.
 */
const TOOL_MODULES = Object.freeze([securityInstruction]);

/**
 * The registered tools, as name/description pairs.
 *
 * The CLI prints this rather than keeping a list of its own, so the two
 * surfaces cannot drift apart.
 *
 * @returns {{ name: string, description: string }[]}
 */
export function listTools() {
  return TOOL_MODULES.map(({ config }) => ({
    name: config.name,
    description: config.description,
  }));
}

/**
 * @param {{ version: string }} options
 * @returns {McpServer}
 */
export function createServer({ version }) {
  const server = new McpServer(
    { name: SERVER_ID, title: SERVER_TITLE, version },
    {
      instructions:
        "The global security set for python, javascript/typescript, and go, served read-only. Call security_instruction with a path to read one file. Start at 'SKILL.md': it names the language and framework workflow and routes to the ten reference files under 'references/'. Read the general file for the language before the framework-specific one - they are written to be read in that order.",
    }
  );

  for (const { config, handler } of TOOL_MODULES) {
    if (config.schema) {
      server.tool(config.name, config.description, config.schema, handler);
    } else {
      server.tool(config.name, config.description, handler);
    }
  }

  return server;
}
