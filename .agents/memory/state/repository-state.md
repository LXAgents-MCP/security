---
name: memory-state-repository-state
description: Current known state of lxagents-security - what exists after the template was turned into the global security set, and the next obvious step.
---

# Repository State

## What this repository is right now

`lxagents-security` is a working dual-purpose MCP server and CLI at version `0.1.0`. It
serves the **global security set** read-only. It is no longer a template: `PROMPT.md` and
`template-mode.md` are gone, and `src/tools/` holds one real tool.

## Stack

Node.js 20+, ESM, no build step. Two runtime dependencies:
`@modelcontextprotocol/sdk` and `zod`. Tests are `node --test`, no framework.

## What exists

* **The set.** `content/` holds `SKILL.md`, the upstream Apache-2.0 `LICENSE.txt`, and
  ten reference guides under `references/`, named
  `<language>-<framework>-<stack>-security.md` across Python, JavaScript/TypeScript, and
  Go. Copied verbatim from the workspace `.agents/security/security-best-practices/`
  package, frontmatter intact.
* **Tool layer.** `src/tools/security-instruction.js` — reads one file from `content/`
  by path. `src/server.js` registers it through `TOOL_MODULES`, which is the whole
  surface.
* **Traversal defence.** `src/content.js` rejects a `..` segment before any filesystem
  call, then confirms containment. The second check is redundant on purpose.
  `test/http.test.js` repeats the hostile-path check over a real socket and adds the
  three a container makes reachable and a host checkout does not.
* **Read-only, structurally.** No tool accepts a verb, takes a credential, or opens a
  socket. The code that would write is absent rather than disabled.
* **A configured HTTP transport.** `POST /mcp` is still Streamable HTTP, the only HTTP
  transport, selected by `MCP_TRANSPORT=http`. It now names its interface with `HOST`
  (default `0.0.0.0`), drains in-flight requests on `SIGINT`/`SIGTERM`, and applies
  `MCP_ALLOWED_HOSTS` when it is set — **off when it is not**, and announced on startup
  when it is off. The path and the transport did not change.
* **Surface parity.** `src/cli.js` prints `listTools()` from `src/server.js`;
  `test/server.test.js` pins the CLI list against the MCP client's `tools/list` in
  memory, and `test/http.test.js` pins it again over a socket.
* **Instruction system.** `AGENTS.md` plus `.agents/`, resolving the shared set through
  the `lxagents-agents-base` connector. Local rules: `repository`, `tool-authoring`,
  `secrets`. No overrides.
* **Documentation.** `wiki/information/` and `wiki/environments/`, updated in the same
  commit as the code they describe, plus the first changelog at `wiki/logs/0/1/0/`.

## What is not built

* The HTTP transport is stateless and unauthenticated. `MCP_ALLOWED_HOSTS` filters
  which `Host` values are answered; it says nothing about who is asking. `HOST` defaults
  to `0.0.0.0`, so the port is open on every interface unless the operator narrows it,
  and the allow-list is off unless the operator sets it.
* No CI workflow, no linter, no formatter.
* `content/` is a copy. A change to the set belongs upstream in the workspace set first;
  this repository is a delivery surface for it, not its editor.
* The version is still `0.1.0` from the template and has not been bumped — that needs
  the owner.

## Shared set

Resolved through the `lxagents-agents-base` MCP connector. Nothing shared is vendored
here, and there are no overrides - see
[`../../index/root-index.md`](../../index/root-index.md).

## Sibling servers

`lxagents-agents-base` carries the org-wide conventions.
`RBAgents-MCP/shared-instruction` carries Roblox development and
`RBAgents-MCP/security` carries Roblox security. Roblox is a different threat model — a
hostile client against a server holding the authority — and is not covered by the
material in `content/`.

## Next obvious step

Add CI that runs `npm test` on push. The suite is the only thing holding the two
surfaces and the traversal defence together, and nothing runs it automatically.
