# Overview

`@lxagents-mcp/security` is a **dual-purpose** package: the same implementation is
reachable as a terminal command and as an MCP server. It serves one thing — the global
security instruction set — and it serves it read-only.

## The two surfaces

| Surface | Bin | Who uses it |
|---|---|---|
| CLI | `lxagents-security` | A person running it by hand or from a script |
| MCP server | `lxagents-security-server` | An MCP client, an editor, an agent, or a connector |

Both share one implementation and one tool list, so a result produced through one is
identical to the same result produced through the other. `npm test` pins that agreement.

## The tools

One tool per markdown file in `content/`, so 11 tools, named after the file each one
serves — the folder is dropped, the `.md` goes, the name is lowercased and `-` becomes
`_`. `SKILL.md` is therefore `skill`, and
`references/python-flask-web-server-security.md` is `python_flask_web_server_security`.

**No tool takes an argument.** The names are long because they name the guide they serve
rather than the folder holding it; that is the cost of a caller being able to read the
tool list and know what each tool is for.

`skill` is the router. It names the language-and-framework workflow and points at the
ten reference files under `references/`, one per language and framework, named
`<language>-<framework>-<stack>-security.md`. The general file for a language comes
before the framework-specific one, and the pair is written to be read in that order.

`content/LICENSE.txt` is **not** served. A licence is not an instruction, and it has no
frontmatter for a caller to route on.

## Read-only, structurally

The server has no write path. No tool accepts a verb, no tool takes a credential, and no
tool opens a socket. The code that would write is absent rather than disabled, which is
what makes "pointing a repository at this server cannot mutate the set" a property of the
code rather than a configuration someone can change.

The read-only claim is now also structural on the way in. The set is read once at boot and
every tool is a map lookup over what it read, so there is no path for a caller to traverse
with and no filesystem I/O on the read path. Containment is a property of the
`CONTENT_DIR` constant rather than of a check that runs against something a caller passed.

## What ships

* An MCP server over **stdio** and **streamable HTTP**, with a `/healthz` endpoint on the
  HTTP transport.
* A CLI with `help`, `version`, `tools`, and `serve`.
* A tool layer **derived from `content/` at boot** — one tool per file, no hand-written
  tool module, no argument anywhere.
* A `Host` allow-list for the HTTP transport that is **off unless it is set**, and says
  so on startup when it is off.
* A test suite covering the bijection between files and tools in both directions, the
  derivation, that no tool declares an input schema, that the served text totals the text
  on disk, that the licence is not served, the structural claim that no tool takes a verb
  or a credential, and — over a real socket — the route table, tool parity, concurrent
  requests, the `Host` allow-list, and what a shutdown does.

## Requirements

Node.js 20 or newer. One dependency (`@modelcontextprotocol/sdk`), and **no build step** —
the package ships source and Node runs it directly.

## Related pages

* [`architecture.md`](architecture.md) — how the pieces fit together.
* [`../environments/setup.md`](../environments/setup.md) — installing and running it.
* [`../environments/env.md`](../environments/env.md) — environment variables.
