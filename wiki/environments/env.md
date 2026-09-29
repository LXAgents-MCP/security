# Environment Variables

Three variables, all optional. The server starts with none of them set and answers
every request.

| Variable | Default | Read by | Effect |
|---|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `src/index.js` | `stdio` or `http` (`streamable-http` is accepted too). `http` is **Streamable HTTP on `/mcp`** — it is the only HTTP transport this server has. |
| `PORT` | `3000` | `src/index.js` | The port the HTTP transport listens on. Ignored on stdio. |
| `HOST` | `0.0.0.0` | `src/index.js` | The interface the HTTP transport binds. Ignored on stdio. |

`0.0.0.0` is every IPv4 interface. It is **not** the dual-stack `::` that Node binds when
no interface is named, so a client reaching the server over IPv6 needs `HOST=::`.

## There is no `API_KEY`

The template this repository was scaffolded from took one key for tools that reached an
external service. Nothing here reaches an external service, so there is no key, and no
tool reads a credential.

If a future tool needs one, the contract for that is
[`../../../.agents/rules/secrets.md`](../../../.agents/rules/secrets.md): check
`process.env` **inside the handler**, never at module scope, and never as a condition on
whether the tool is registered.

## `MCP_TRANSPORT` and `PORT`

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
