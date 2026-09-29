---
name: agent-wiki-context-repository-map
description: Orientation for lxagents-security - what lives where, how to build and test it, the two surfaces, and the gotchas that bite first.
---

# Repository Map

Read this before touching anything in `lxagents-security`.

## What this repository is

An MCP server and a CLI over one implementation, serving the **global security
instruction set** read-only — the language and framework guides for Python,
JavaScript/TypeScript, and Go. Node.js 20+, ESM (`"type": "module"`), **no build
step** - the published package ships `src/` and Node runs it directly.

* Remote: `LXAgents-MCP/security`, default branch `master`.
* Package: `@lxagents-mcp/security`.
* Bins: `lxagents-security` (CLI) and `lxagents-security-server` (MCP server).

## Layout

```
AGENTS.md                     entry point, connector bootstrap, trigger table
package.json                  both bins, no build step
Dockerfile                    container image; MCP_TRANSPORT=http, node src/index.js
.dockerignore                 what the build context must not carry
content/                      the published security set - the product
  SKILL.md                    the workflow, and the router into references/
  LICENSE.txt                 Apache-2.0, from the upstream package
  references/                 ten guides, <language>-<framework>-<stack>-security.md
src/
  index.js                    entry point; picks stdio or streamable HTTP, owns the HTTP server
  server.js                   builds the McpServer and registers every tool; exports listTools()
  content.js                  resolves a path inside content/, with the traversal defence
  cli.js                      the CLI: help, version, tools, serve
  version.js                  reads version out of package.json at import
  tools/
    security-instruction.js   the only tool: read one file from the set by path
test/
  server.test.js              registration, schema, all ten guides, traversal, surface parity
  http.test.js                the streamable HTTP transport, over a real socket
wiki/                         human documentation
.agents/                      this set - rules, agent wiki, memory, indexes
```

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs `@modelcontextprotocol/sdk` and `zod`. |
| `npm test` | `node --test`. The whole suite; there is no watch mode. |
| `npm run cli -- tools` | Lists registered tools through the CLI surface. |
| `npm start` | Serves over stdio. |
| `npm run start:http` | Serves over streamable HTTP on `PORT` (default 3000). |
| `npm run inspect` | MCP Inspector against the stdio server. |

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `MCP_TRANSPORT` | `src/index.js` | `stdio` (default) or `http` (Streamable HTTP on `/mcp`). |
| `PORT` | `src/index.js` | HTTP port, default `3000`. |
| `HOST` | `src/index.js` | Interface the HTTP transport binds, default `0.0.0.0` — every IPv4 interface. |
| `MCP_ALLOWED_HOSTS` | `src/index.js` | Comma-separated `Host` allow-list for the HTTP transport. **Unset means none is applied**; the server says so on startup. |

There is no `API_KEY`. Nothing here reaches an external service. `MCP_ALLOWED_HOSTS` is
a filter, not a credential — it decides which `Host` values are answered, not who is
asking.

## The two surfaces

`src/server.js` holds the only tool list. `src/cli.js` imports `listTools()` from it
rather than keeping its own, and `test/server.test.js` asserts that what the CLI would
print matches what an MCP client receives from `tools/list`. Adding a tool in one place
therefore adds it in both, and there is no way to add it to only one without failing the
suite.

## Gotchas

* **stdout is the protocol.** On stdio, a `console.log` anywhere on the server path
  corrupts the JSON-RPC stream. Log to stderr. Only CLI commands print.
* **Tool schemas are raw shapes.** `server.tool()` wants `{ a: z.number() }`, not
  `z.object({ ... })`. Wrapping it silently produces a tool with no parameters.
* **Reject `..` before the filesystem call.** A check that runs after `fs` is checking a
  value the caller already influenced. `src/content.js` does both: the segment check
  first, the containment check after, and the second is redundant on purpose.
* **A fresh `McpServer` per HTTP request.** `src/index.js` builds and closes one per
  request because `McpServer` holds per-connection state. Do not hoist it to module
  scope.
* **An unset `MCP_ALLOWED_HOSTS` is the guard being off.** Not "allow nothing". The
  startup line says `MCP_ALLOWED_HOSTS is unset` when there is no list, and `HOST`
  defaults to `0.0.0.0`, so the unguarded state is the default one. Do not "fix" this by
  refusing everything when the variable is empty — a paste that lost its value would
  take the server down with a 403 on every request.
* **`content/` is the product, not a source folder.** Every file in it is served
  verbatim on the next boot, with its frontmatter intact. `src/` is local; a change to
  `content/` changes what every consuming repository reads.
* **Do not add a write path.** The single-tool read-only surface is the property a
  consuming repository depends on. See [`../../rules/tool-authoring.md`](../../rules/tool-authoring.md).
* **`version.js` reads `package.json` at import** via a path relative to `src/`. Moving
  it breaks the version without failing a test.

## Where the conventions come from

Branching, commits, pull requests, the task workflow and the creators are **not** in
this repository. They are served by the `lxagents-agents-base` connector and read as
`agents://` resources. This repository carries only what is its own.
