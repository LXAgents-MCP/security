---
name: memory-state-repository-state
description: Current known state of lxagents-security - the derived per-file tool surface, the read-only set, the stack, and what is not built.
---

# Repository State

## What this repository is right now

`lxagents-security` is a working dual-purpose MCP server and CLI at version `1.0.0`. It
serves the **global security set** read-only. It is no longer a template: `PROMPT.md` and
`template-mode.md` are gone, and the tool surface is derived from the set.

## Stack

Node.js 20+, ESM, no build step. One runtime dependency:
`@modelcontextprotocol/sdk`. Tests are `node --test`, no framework.

## What exists

* **The set.** `content/` holds `SKILL.md`, the upstream Apache-2.0 `LICENSE.txt`, and
  ten reference guides under `references/`, named
  `<language>-<framework>-<stack>-security.md` across Python, JavaScript/TypeScript, and
  Go. Copied verbatim from the workspace `.agents/security/security-best-practices/`
  package, frontmatter intact.
* **A derived tool surface.** `src/tools/from-content.js` walks `content/` once at
  import and builds one tool per `.md` file, named after its own filename — eleven
  tools, `skill` plus the ten reference guides. `src/server.js` registers the frozen
  array as `TOOL_MODULES`, which is the whole surface. There is no hand-written tool in
  this repository.
* **No argument anywhere.** Every tool returns one file verbatim with its frontmatter
  intact. A call is a map lookup over text read once at boot: no filesystem I/O on the
  read path, and no path for a caller to traverse with. `src/content.js` and its `..`
  guard were deleted with the argument they guarded — see
  [`../tasks/per-file-tools.md`](../tasks/per-file-tools.md).
* **Read-only, structurally.** No tool accepts a verb, takes a credential, or opens a
  socket. The code that would write is absent rather than disabled.
* **An express HTTP transport.** `POST /mcp` is still Streamable
  HTTP, the only HTTP transport, selected by `MCP_TRANSPORT=http`; the `node:http` server
  and its hand-rolled body reader and `Host` shim are gone, replaced by `src/app.js` as
  a pure factory. It names its interface with `HOST` (default `0.0.0.0`), drains
  in-flight requests on `SIGINT`/`SIGTERM`, and applies `MCP_ALLOWED_HOSTS` when it is
  set — **off when it is not**, and announced on startup when it is off. The path and the
  transport did not change.
* **Surface parity.** `src/cli.js` prints `listTools()` from `src/server.js`;
  `test/server.test.js` pins the CLI list against the MCP client's `tools/list` in
  memory, and `test/http.test.js` pins it again over a socket.
* **Instruction system.** `AGENTS.md` plus `.agents/`, resolving the shared set through
  the `lxagents-agents-base` connector. Local rules: `repository`, `tool-authoring`,
  `secrets`. No overrides.
* **Documentation.** `wiki/information/` and `wiki/environments/`, updated in the same
  commit as the code they describe, plus changelogs at `wiki/logs/0/1/0/` and
  `wiki/logs/1/0/0/`.

## What is not built

* The HTTP transport is stateless and unauthenticated. `MCP_ALLOWED_HOSTS` filters
  which `Host` values are answered; it says nothing about who is asking. `HOST` defaults
  to `0.0.0.0`, so the port is open on every interface unless the operator narrows it,
  and the allow-list is off unless the operator sets it.
* No CI workflow, no linter, no formatter.
* `content/` is a copy. A change to the set belongs upstream in the workspace set first;
  this repository is a delivery surface for it, not its editor. One consequence is on
  record: `SKILL.md` does not enumerate the ten reference filenames, only their two
  documented shapes, so nothing here can make it do so.
* `content/LICENSE.txt` is no longer served. It never was an instruction, but the old
  path-taking tool would return it on request and the new surface does not.

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

Add CI that runs `npm test` on push. The suite is the only thing holding the two surfaces
and the file-to-tool bijection together, and nothing runs it automatically.

Note that `test/http.test.js` is timing-sensitive under a full parallel run on a slow
or network filesystem: it spawns a child server per test and waits on a startup line.
`the startup line announces that no allow-list is applied` failed in 2 of 8 full-suite runs
on WSL `/mnt/c`, and passed every time the file was run alone. It is a harness race, not a
server defect. Suspect the harness, not the server, before suspecting a change.
