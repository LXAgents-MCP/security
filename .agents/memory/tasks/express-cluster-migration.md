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

### Task 2 — `feat/express-transport`

`node:http` is gone. `src/app.js` is new and holds the whole HTTP surface as a pure
factory: `POST /mcp`, `GET /healthz`, a JSON-RPC 405 for any other method on `/mcp`, a
JSON-RPC 404 for everything else, and a four-argument error handler that answers an
oversized body and a malformed one with the same 400 / `-32700`. `src/index.js` keeps
the transport switch, the port, the interface, the startup lines, and the three-step
shutdown — and calls `createApp().listen(port, host)`.

**The shim is deleted.** The old `node:http` server had no `res.status().json()` to give
`hostHeaderValidation`, so it grafted those two methods onto the real response and
inferred refusal from whether `json` had been called. Express has both, so the SDK
middleware is mounted natively and the shim has no caller left.

Recorded in
[`../decisions/express-for-http-transport.md`](../decisions/express-for-http-transport.md),
which also records the semantics that are preservation rather than rewrite: the guard is
**not mounted at all** when `MCP_ALLOWED_HOSTS` is unset, empty, or separators-only, and
the `-32700` collapse is kept deliberately.

`express@^5.2.1` was already resolved in the lockfile transitively through the SDK. The
diff is the direct-dependency marking and nothing else — no version moved.

**One unrelated fix rode along.** `src/cli.js`'s `--help` block ended with
`unset means none is applied\`` — an unbalanced backtick that swallowed the end of the
template literal and printed the rest of the source on `--help`. The new line added
below it needs a closing backtick, so the stray one had to go.

| Point | Tests | Pass | Fail |
|---|---|---|---|
| Baseline | 30 | 30 | 0 |
| After this task | 34 | 34 | 0 |

Four new tests, all in `test/http.test.js`: the body limit is the 4 MB it was; an
oversized body is refused in the JSON-RPC envelope; malformed JSON gets **exactly** the
same answer; and no response carries `X-Powered-By` — checked on a route, on the 404,
and on the 405, because those three take different paths through the stack.

`npm ci` and the lockfile check are in the task-3 commit; the plan's
[verification checklist](../plans/verification.md) is walked there, once, over the tree
that finally merges.
