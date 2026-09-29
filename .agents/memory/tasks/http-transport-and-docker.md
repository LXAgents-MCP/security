---
name: memory-tasks-http-transport-and-docker
description: Task record for configuring the existing Streamable HTTP transport - Host allow-list, explicit host binding, drain-before-close - and adding a container image. No second transport, no version change.
---

# Task: HTTP transport and container image

Branch `feat/http-transport-and-docker`, off `master`. Local commits only; nothing is
pushed from this branch. **No version change** - the version needs the owner.

## What this is

The repository already served `StreamableHTTPServerTransport` on `POST /mcp`. This task
**keeps and configures that transport** and adds a container image. It does not add a
second transport, an `express` dependency, or a separate HTTP entry point.

The request that produced it assumed the server was stdio-only. It was not, and an
earlier draft of the plan was written around adding SSE alongside Streamable HTTP. The
owner closed that: the SDK deprecates `SSEServerTransport` in favour of the transport
already running here, so `src/http.js`, `express`, and a `start:sse` script are all out
of scope. This record supersedes the plan folder's own naming, which still says "sse".

## What landed

| Step | Result |
|---|---|
| Baseline | `npm test` before any change: 12 tests, 12 pass, 0 fail. |
| `start:http` portability | `node src/cli.js serve --http` - no env-var prefix, so it runs under `cmd.exe` as well as `sh`. No new dependency. |
| `HOST` binding | `src/index.js` binds `HOST`, default `0.0.0.0`, as before on the default interface. |
| `MCP_ALLOWED_HOSTS` | Comma-separated `Host` allow-list through the SDK's `hostHeaderValidation`. **Off unless set**, announced on startup when it is unset. |
| Logging | Startup and shutdown diagnostics on **stderr**, never stdout. |
| Shutdown | `SIGINT`/`SIGTERM` drain in-flight requests before the listener closes. |
| Test | `test/http.test.js` - a real process, a real socket, `POST /mcp` and `GET /healthz`. |
| Container | `Dockerfile` and `.dockerignore`; `node src/index.js` with `MCP_TRANSPORT=http`. |
| Documentation | `wiki/environments/docker.md` new; `README.md`, `env.md`, `setup.md`, `architecture.md`, `overview.md`, the repository map and the state record updated. |

## Test counts

| Point | Tests | Pass | Fail |
|---|---|---|---|
| Baseline, before any change | 12 | 12 | 0 |
| After the host binding and the socket suite | 23 | 23 | 0 |
| After the `Host` allow-list | 29 | 29 | 0 |

The suite runs on Node 20+ with `node --test` and no framework. The socket tests start
`src/index.js` as a real child process, because an imported module cannot be given a
second port or stopped; their readiness deadline is 30 seconds, which is generous on
purpose and costs nothing in the common case.

## What was verified, and how

Run on Node 22.15.0. Every check below was executed; nothing in this section is an
intention.

| Check | Result |
|---|---|
| `npm test` | 29 tests, 29 pass, 0 fail |
| `npm run start:http` serves `/healthz` | yes, on the port it was given |
| `HOST=127.0.0.1` is what the startup line reports | yes |
| `SIGINT` drains, logs, and exits 0 | yes |
| Every `COPY` source in the Dockerfile resolves against the tree | yes |
| Every `.dockerignore` entry checked against the tree | yes; `.github` and `compose.yaml` are the deliberate forward-looking exclusions |
| `npm ci --ignore-scripts --omit=dev` against `package.json` + `package-lock.json` alone | succeeds, 91 packages |
| Every markdown link on every page this change touched | resolves, except two pre-existing ones (below) |
| `docker build` | **not run.** No Docker command was issued for this work. |

## What the owner still has to run

**The image has never been built.** Docker was not used for this work.

```bash
docker build -t lxagents-security:0.1.0 .
docker run --rm -i -e MCP_TRANSPORT=stdio lxagents-security:0.1.0 < ../dev/null
docker run --rm -p 3000:3000 lxagents-security:0.1.0
curl -s http://localhost:3000/healthz
```

## Open, not decided here

* **The changelog.** `docs-to-correct.md` asks for an entry naming the second transport.
  There is no second transport, and `0.1.0` is released - so writing the entry would mean
  either editing a released record or creating a version directory for a version that
  does not exist. Neither is this branch's to do. The sibling `per-file-tools` plan takes
  `1.0.0` and `wiki/logs/1/0/0/CHANGELOG.md`; the entry belongs there if it belongs
  anywhere.
* **A guard for `0.0.0.0` without an allow-list.** The default binding exposes the port
  on every interface with no `Host` filtering, because an unset `MCP_ALLOWED_HOSTS` means
  the guard is off. That is the safe-looking default being the unsafe one. The README
  security note says so; nothing in the code prevents it.
* **Two broken links that predate this work.** `wiki/environments/env.md` and
  `wiki/information/architecture.md` both point at `../../../.agents/rules/secrets.md`,
  which is one level above the repository. `../../.agents/rules/secrets.md` would
  resolve. Found while checking the links this change introduced; left alone because it
  is not this change's to make.
