---
name: memory-tasks-express-cluster-migration
description: Task record for replacing the node:http transport with an express application mapped strictly to POST /mcp, and for answering requests from cluster workers on one port.
---

# Task: express transport and cluster workers

Three branches, stacked. Local commits only; nothing is pushed from them. **No version
change** — the version needs the owner, and so does the release log.

## The plan

| # | Task | Branch | Scope |
|---|---|---|---|
| 1 | The record | `chore/express-cluster-plan` | This file. |
| 2 | express transport | `feat/express-transport` | `node:http` → express, strictly `POST /mcp`, `GET /healthz` preserved. |
| 3 | cluster workers | `feat/cluster-workers` | A `cluster` primary forking workers onto the one `PORT`. |

The working plan is untracked, under `.agents/plans/`, and is deleted or abandoned when
the work merges. Where the two disagree, this record wins.

## What this is

The repository serves `StreamableHTTPServerTransport` on `POST /mcp` from a
`node:http` server, with a hand-rolled `readBody`, a hand-rolled `rpcError`, and the
SDK's `hostHeaderValidation` bridged onto a raw response through a shim that supplies
the two methods that middleware reaches for. This task replaces that with an express
application and a `cluster` primary, and **preserves** the security logic, the
stateless per-request `McpServer`, the 4 MB body limit, `PORT` (default 3000) and
`HOST` (default 0.0.0.0).

`express@5.2.1` is already resolved in `package-lock.json` as a transitive dependency
of `@modelcontextprotocol/sdk`, so promoting it to a direct dependency changes no
installed version and adds no transitive graph. The reason it is a dependency at all
is recorded in `../decisions/express-for-http-transport.md`.

The `Dockerfile` is not modified. It already runs `npm ci` and exposes 3000, and
nothing in it becomes false.

## Baseline

`npm test` before any change: **30 tests, 30 pass, 0 fail** (Node 24.21.0, `node
--test`, no framework).

## What is preserved, and where the plan says so

| Property | Where it lives now | What happens |
|---|---|---|
| `MCP_ALLOWED_HOSTS` guard | `hostRefused()` in `src/index.js` | Preserved, mounted natively, still **off when unset** |
| Stateless `McpServer` per request | `src/index.js` | Preserved exactly |
| 4 MB body limit | `readBody`'s `limit` argument | Preserved, now declarative |
| `PORT` default 3000, `HOST` default 0.0.0.0 | `src/index.js` | Preserved |
| Startup line, `MCP_ALLOWED_HOSTS` warning, `{signal}, draining` | `src/index.js` | Text preserved — they are asserted by the suite and read by whoever watches a container start |
| 4 MB / `-32700` collapse for oversized *and* malformed bodies | `readBody` | Preserved deliberately; not fixed here |

## What is new

- `src/app.js` — the express application as a pure factory. It does not listen.
- `MCP_CLUSTER_WORKERS` — worker count, defaulting to `availableParallelism()`. `1`
  disables forking, which is how the change can be bisected against the
  pre-cluster behaviour.

## Out of scope

The `Dockerfile`, the tool surface and `content/**`, the stdio transport, the version,
and the release log.

## Test counts

| Point | Tests | Pass | Fail |
|---|---|---|---|
| Baseline, before any change | 30 | 30 | 0 |

---

### Task 1 — `chore/express-cluster-plan`

Created this record with the confirmed task list, before any of the work, so a
reviewer checks the plan against the work rather than inferring the plan from it.
Registered in [`.agents/index/memory-index.md`](../../index/memory-index.md) in this
commit.

Task 2 branches from this branch and adds its own entry here in its own commit.
