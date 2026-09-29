# Environment Variables

Four variables, all optional. The server starts with none of them set and answers
every request.

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `src/index.js` | `stdio` or `http` (`streamable-http` is accepted too). `http` is **Streamable HTTP on `/mcp`** — it is the only HTTP transport this server has. |
| `PORT` | `3000` | `src/index.js` | The port the HTTP transport listens on. Ignored on stdio. |
| `HOST` | `0.0.0.0` | `src/index.js` | The interface the HTTP transport binds. Ignored on stdio. |
| `MCP_ALLOWED_HOSTS` | *unset* | `src/index.js` | Comma-separated `Host` allow-list. **Unset means no allow-list is applied.** Read on the HTTP transport only. |

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
lxagents-security 0.1.0 serving over http on :3000/mcp (all interfaces)
lxagents-security 0.1.0 MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied.
```

Set it before exposing the port anywhere but your own machine. The SDK applies host
validation on its own only through its Express app factory, and only when the host is
loopback; `HOST` defaults to `0.0.0.0`, so without an explicit list nothing is filtering
the `Host` header in exactly the deployment — a container, a shared host — where it
would matter.

Unset is a skipped check rather than a guessed one, because a wrong allow-list silently
refusing every request is a worse failure than an absent one, and the set is public
markdown either way.

## There is no `API_KEY`

The template this repository was scaffolded from took one key for tools that reached an
external service. Nothing here reaches an external service, so there is no key, and no
tool reads a credential.

If a future tool needs one, the contract for that is
[`../../../.agents/rules/secrets.md`](../../../.agents/rules/secrets.md): check
`process.env` **inside the handler**, never at module scope, and never as a condition on
whether the tool is registered.

## `MCP_TRANSPORT`, `PORT` and `HOST`

```bash
# stdio (default)
npm start

# streamable HTTP on 3000
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

## Related pages

* [`setup.md`](setup.md) — installing and running both modes.
* [`../information/overview.md`](../information/overview.md) — what the project is.
