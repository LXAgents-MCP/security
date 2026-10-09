# Environment Variables

Six variables. **Five are optional, and stdio needs none of them.** The sixth,
`MCP_AUTH_TOKEN`, is a secret and is **required by the HTTP transport**: without it the
HTTP server does not start.

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `src/index.js` | `stdio` or `http` (`streamable-http` is accepted too). `http` is **Streamable HTTP on `/mcp`** — it is the only HTTP transport this server has. |
| `PORT` | `3000` | `src/index.js` | The port the HTTP transport listens on. Ignored on stdio. |
| `HOST` | `0.0.0.0` | `src/index.js` | The interface the HTTP transport binds. Ignored on stdio. |
| `MCP_ALLOWED_HOSTS` | *unset* | `src/app.js` | Comma-separated `Host` allow-list. **Unset means no allow-list is applied.** Read on the HTTP transport only. |
| `MCP_AUTH_TOKEN` | **none - required for HTTP** | `src/auth.js` | The bearer token every HTTP request except `GET /healthz` must carry. At least 32 characters. **HTTP will not start without it.** stdio never reads it. |
| `MCP_CLUSTER_WORKERS` | *the CPU count* | `src/index.js` | How many HTTP workers to fork. **`1` means no fork at all** — one process, one listener. Read on the HTTP transport only; stdio never forks. |

`0.0.0.0` is every IPv4 interface. It is **not** the dual-stack `::` that Node binds when
no interface is named, so a client reaching the server over IPv6 needs `HOST=::`.

## `MCP_ALLOWED_HOSTS`

A comma-separated list of hostnames the `Host` header may carry. Matching is
**port-agnostic** — `security.example.test` allows `security.example.test:8080` — and an
IPv6 literal is written in brackets. A request outside the list is refused with a 403
and a JSON-RPC error naming the host that was rejected.

**An empty value means the guard is off.** Not "allow nothing". Set to nothing, or to
nothing but commas and spaces, the variable reads as unset: no list is applied and every
request is served. The server says so on startup, and says it only when it is true.

```text
lxagents-security 2.0.0 serving over http on :3000/mcp (all interfaces)
lxagents-security 2.0.0 bearer token required on every route except GET /healthz.
lxagents-security 2.0.0 MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied.
```

Set it before exposing the port anywhere but your own machine. The SDK applies host
validation on its own only through its Express app factory, and only when the host is
loopback; `HOST` defaults to `0.0.0.0`, so without an explicit list nothing is filtering
the `Host` header in exactly the deployment — a container, a shared host — where it
would matter.

Unset is a skipped check rather than a guessed one, because a wrong allow-list silently
refusing every request is a worse failure than an absent one, and the set is public
markdown either way.

## `MCP_AUTH_TOKEN`

The transport decides. A server a client spawns is a pipe on the client's own machine, so
there is nobody to authenticate; a server on a port is reachable by anyone who can open a
socket, so every request must prove the caller holds the token. An optional token would mean
a deployment that forgot to set it ran open and said nothing, so instead the process refuses
to start: one line on stderr naming the variable, and exit code `1`. `createApp` refuses to
build without it too, so the check cannot be skipped by calling the app directly.

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"    # 64 hex characters; keep it, clients need it
npm run start:http
```

* **Length.** Under 32 characters is refused at startup, so a value like `test` is found by
  you and not by a scanner. Surrounding whitespace is dropped, because a token read out of a
  file or an `env_file` often ends in a newline and an HTTP header cannot.
* **Sending it.** `Authorization: Bearer <token>` on every request. A missing header and a
  wrong token are both a `401` with `WWW-Authenticate: Bearer`; the second also says
  `error="invalid_token"`. There is no query-string form, because a URL is logged.
* **One token, shared.** Every client holds the same value, so there is no per-client
  identity and no revoking one client alone. Rotate it by changing the variable and
  restarting; the server is stateless, so a restart drops nothing.
* **Never logged.** The startup line says a token is required and never what it is, and a
  rejected token is not echoed. Keep it out of the image, the repository and the command
  line: pass it from the environment, an `env_file`, or the host's secret store.
* **`GET /healthz` is the one open route**, so an orchestrator's probe needs no token. It
  returns `{ status, server, version }` and nothing else.
* **Put TLS in front.** A bearer token sent over plain `http` can be read by anyone on the
  path. This server does not terminate TLS.

The token gates the *service*, not the *text*: the set is public, so it does not become
confidential. No tool reads a credential, and none takes one as an argument.

If a future *tool* needs a credential, the contract for that is
[`../../../.agents/rules/secrets.md`](../../../.agents/rules/secrets.md): check
`process.env` **inside the handler**, never at module scope, and never as a condition on
whether the tool is registered.

## `MCP_TRANSPORT`, `PORT` and `HOST`

```bash
# stdio (default)
npm start

# streamable HTTP on 3000 (MCP_AUTH_TOKEN must be set)
npm run start:http

# streamable HTTP on another port
npm run start:http -- --port 8080

# the same, through the CLI
lxagents-security serve --http --port 8080
```

`HOST` has no flag, because the CLI has one transport and one reason to want a
different interface. Set it in the environment, which every shell can do:

```bash
HOST=127.0.0.1 npm run start:http
MCP_ALLOWED_HOSTS=security.example.com npm run start:http
```

The CLI's `serve` command sets both variables from its flags, so `--http`, `--stdio`,
and `--port` are equivalent to exporting them.

`start:http` goes through `serve --http` rather than setting the variable in the script.
A `VAR=value command` prefix is a shell feature, not a Node one: it works under `sh` and
fails in `cmd.exe`, so the same script could not run on a stock Windows checkout. Setting
the variable in `src/cli.js` keeps one mechanism for both platforms and adds no
dependency. `MCP_TRANSPORT=http node src/index.js` still works wherever the shell
supports it; it is the npm script, not the server, that avoids the prefix.

## `MCP_CLUSTER_WORKERS`

How many HTTP workers the primary forks. Each worker binds the same `PORT`; the kernel's
shared handle and the round-robin scheduler distribute the connections.

Unset, the count is `os.availableParallelism()` — the CPUs this process was actually
given, not a constant, so a two-CPU container gets two workers and a laptop does not get
eight.

```bash
# one worker per CPU (the default)
npm run start:http

# no fork at all: one process, one listener, the pre-cluster behaviour
MCP_CLUSTER_WORKERS=1 npm run start:http

# four workers on a machine that reports two CPUs
MCP_CLUSTER_WORKERS=4 npm run start:http
```

**`1` disables forking**, and that is the point of it rather than a special case: the
same code answers with and without workers, so a difference between the two is a
difference in the fork rather than in the transport.

The primary forks workers and serves nothing itself, so the `serving over http` line is
printed once per worker — the number of lines is the number of open ports in the log.
The primary also replaces a worker that dies, and gives up rather than respawning into a
crash loop nobody is watching. It has no flag in the CLI for the same reason `HOST` has
none: one transport, one reason to want a different value.

## Related pages

* [`setup.md`](setup.md) — installing and running both modes.
* [`../information/overview.md`](../information/overview.md) — what the project is.
