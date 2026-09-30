# 1.1.0

**Released:** 2026-09-30

The HTTP transport becomes an express application, and a `node:cluster` primary forks
workers that share the one `PORT`.

**The published contract does not change.** `POST /mcp` and `GET /healthz` answer as
they did, the `MCP_ALLOWED_HOSTS` guard keeps its exact semantics, the 4 MB body limit
and the existing JSON-RPC error shapes are untouched, and the tool surface is derived
from `content/` exactly as before. This is a minor version because what is added is a
capability, not a new contract — a client written against `1.0.0` needs no change.

## Added

- **Cluster workers.** The HTTP transport forks `MCP_CLUSTER_WORKERS` processes —
  `os.availableParallelism()` by default — and each binds the same `PORT` through the
  cluster's shared handle, so the kernel's round-robin scheduler does the
  distribution. No `SO_REUSEPORT` is set by hand and no sticky-session logic is
  written, because the scheduler already holds the information such a scheme would have
  to reconstruct.

  `MCP_CLUSTER_WORKERS=1` means no fork at all, which is what makes this bisectable
  against the previous commit: the same code answers with and without workers, so a
  difference between the two is a difference in the fork rather than in the transport.

  The primary binds nothing, so the startup line is printed once per worker and a
  container's log describes ports that are genuinely open, from the processes that
  opened them. It relays the signal to its workers and waits for the last to go, so the
  port closes before the process that started it; a second signal during the drain
  exits at once rather than queueing. Workers exit on `disconnect`, or a worker whose
  primary is gone holds the port for whoever starts next.

  **stdio never forks.** stdout is the JSON-RPC channel there, and a worker's copy of
  it would corrupt the stream. A scaffold that adds workers gets them on HTTP only.

- `test/http.test.js`, covering the endpoint mapping, the allow-list, the body limit,
  and the cluster behaviour. Two are worth naming: one `SIGKILL`s the primary and
  proves the port is free afterwards both by refusal and by re-binding; another proves
  a dead worker is replaced and the server keeps serving.

## Changed

- **The transport is an express application.** `src/index.js` no longer builds a
  `node:http` server and no longer hand-parses request bodies. The application is
  `src/app.js`, and the MCP endpoint is strictly `POST /mcp`.

  Preserved exactly, because they are behaviour and not cosmetics: the
  `MCP_ALLOWED_HOSTS` guard including that unset, empty, or separators-only means it is
  not mounted at all; the stateless `McpServer` per request; the 4 MB body limit and the
  existing JSON-RPC error shapes; and the startup line, the `MCP_ALLOWED_HOSTS`
  warning, and the drain line — all three of which are asserted by `test/http.test.js`
  and read by whoever is watching a container start.

  No response advertises that the server runs express; there is a test that says so.

- `express` is a direct dependency, pinned to the version the lockfile already resolved.
- Docs: `wiki/information/architecture.md`, `wiki/environments/env.md`,
  `wiki/environments/docker.md`, and the repository map.

## Removed

- **The unused `inFlight` option on `createApp`.** It shipped with the transport change
  and nothing ever passed it. This server drains through `closeAllConnections()`, not
  through an in-flight set — the option was a shape copied from the repository that does
  keep one. An option with no caller is not a hook for a future change; it is a second
  answer to the question of how this server shuts down, and only one of the two is true
  here.

## Not done

- The `Dockerfile`, which no commit in this migration modified. It already runs
  `npm ci` and already exposes 3000, so nothing in it is made false by this change.
- The version references in `wiki/environments/docker.md` were stale at `0.1.0` and are
  corrected to this release here. They should have moved at `1.0.0` and did not.
