/*
 * The MCP server.
 *
 * A fresh instance is created per connection because McpServer holds
 * per-connection state.
 *
 * The tool surface is not written by hand. It is derived from the markdown files
 * under `content/` at boot - one tool per file, named after the file itself -
 * so adding a guide to the set is the whole procedure for adding a tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CONTENT_TOOLS } from "./tools/from-content.js";

export const SERVER_ID = "lxagents-security";
export const SERVER_TITLE = "LXAgents Security";

/*
 * The whole surface. Every tool here takes no argument at all: there is no
 * `path` for a caller to traverse with, no verb to act on, and no credential
 * to present. Nothing in this repository reaches a network - the code that would
 * write is absent, not disabled. A repository pointed at this server cannot
 * mutate the set.
 *
 * A tool registered anywhere else is invisible to `listTools()`, to the CLI, and
 * to the client's `tools/list`. This array is the whole surface.
 */
const TOOL_MODULES = Object.freeze(CONTENT_TOOLS);

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
        "The global security set for python, javascript/typescript, and go, served read-only. Every file in the set is its own tool: call the one whose name says what you need, such as skill, python_flask_web_server_security, or javascript_typescript_nextjs_web_server_security. Start at skill: it names the language and framework workflow and routes to the ten reference guides. Read the general guide for the language before the framework-specific one - they are written to be read in that order. No tool takes an argument.",
    }
  );

  // No generated tool declares a schema, so the three-argument form is the only
  // one that can be reached. It is kept rather than a `registerTool` call with an
  // `inputSchema` key, because that key is where an argument would have to be
  // added - and one would have to be added here, by hand, to bypass the generator.
  for (const { config, handler } of TOOL_MODULES) {
    server.tool(config.name, config.description, handler);
  }

  return server;
}
