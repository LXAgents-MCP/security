---
name: repository-rules
description: Rules specific to lxagents-security - the dual-surface contract, the stdout ban, the derived read-only surface, and what must not be introduced.
---

# Repository Rules

`lxagents-security` is a dual-purpose MCP server and CLI over one implementation, and
it serves the global security set from `content/` read-only. Both facts constrain what
may be changed here.

## Mode and shared set

This repository is a **Mode B consumer**. The shared instruction set is resolved
through the `lxagents-agents-base` MCP connector and is never copied into this tree.
See the bootstrap block in [`../../AGENTS.md`](../../AGENTS.md).

## The two surfaces stay in step

The CLI (`lxagents-security`) and the MCP server (`lxagents-security-server`) are two
doors onto one implementation. A tool reachable from one is reachable from the other,
with the same name and the same description.

* The tool surface is built in exactly one place: `src/tools/from-content.js`, from the
  files in `content/`.
* `src/server.js` registers that array and exports `listTools()`; it does not declare
  tools of its own.
* `src/cli.js` never maintains its own list - it reads the declaration from
  `src/server.js`.
* `test/server.test.js` pins the agreement. A change that makes the two surfaces
  disagree fails the suite, and that failure is the point.

## Nothing writes to stdout except the CLI

On the stdio transport, stdout **is** the JSON-RPC channel. A stray `console.log` on
the server path corrupts the protocol stream and the client reports a parse error
that names nothing useful.

* Server-side logging goes to stderr.
* `serve` prints nothing of its own.
* Only CLI commands write to stdout.

## Where things go

| Thing | Path |
|---|---|
| The served security set | `content/` |
| The tool surface, derived from the set | `src/tools/from-content.js` |
| Tool registration and `listTools()` | `src/server.js` |
| `ROOT`, `CONTENT_DIR`, and the version | `src/version.js` |
| CLI commands | `src/cli.js` |
| Transport and entry point | `src/index.js` |
| Tests | `test/{subject}.test.js` |

## Commands

```bash
npm install       # no build step, Node 20+
npm test          # node --test
npm run cli -- tools
npm start         # stdio
npm run start:http
npm run inspect   # MCP Inspector against the stdio server
```

## What must not be introduced

* A build step. This package ships source and is run directly by Node.
* A second source of truth for the tool list, and a hand-written tool module beside the
  generator - see [`tool-authoring.md`](tool-authoring.md).
* Shared instruction content. If it can be read from `agents://`, it must not exist
  here as a file.
* A write path, and an argument. No tool may take a verb, a credential, or reach a
  network; no tool takes any argument at all. The read-only property is structural - the
  code that would write is absent - and it is the property a consuming repository depends
  on when it points at this server.
* An edit to a guide under `content/`. Those files are copied from the upstream
  workspace set; the change belongs there, and this repository follows it.
