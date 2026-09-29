# Architecture

Four source files and one generated tool surface. There is no framework and no build step.

```
src/
  index.js     entry point: picks a transport, owns the HTTP server
  server.js    builds the McpServer, registers every tool, exports listTools()
  cli.js       the CLI: help, version, tools, serve
  version.js   reads the version out of package.json, and holds ROOT and CONTENT_DIR
  tools/
    from-content.js   builds the whole tool surface from content/, once, at import
content/       the published security set
```

## Entry point and transports

`src/index.js` reads `MCP_TRANSPORT` and serves either way:

* **stdio** (default) — one `McpServer` connected to a `StdioServerTransport` for the
  life of the process.
* **streamable HTTP** — a plain `node:http` server exposing `GET /healthz` and
  `POST /mcp`.

The HTTP transport is **stateless**: a fresh `McpServer` and transport are built for
each request and closed when the response closes. That is deliberate — `McpServer`
holds per-connection state, so hoisting one to module scope would leak state between
unrelated callers.

The interface is named rather than defaulted. `listen(port)` with no host argument binds
`::` — every IPv6 address plus IPv4-mapped ones — which reads as a decision to expose the
server everywhere when it is really the absence of one. `HOST` names the interface, and
its `0.0.0.0` default says on the startup line that the port is open on every interface.

`MCP_ALLOWED_HOSTS` guards what reaches it. When it is set, every request — including
`/healthz` — is matched against it first, and a `Host` outside the list is refused with
a 403. When it is unset, no list is applied, and the startup line says so. The matching
is the SDK's `hostHeaderValidation`; `src/index.js` supplies the two Express-shaped
response helpers that middleware needs and delegates the decision, so the port-agnostic
matching and the JSON-RPC refusal body have one implementation rather than two.

### Shutdown drains before it closes

`SIGINT` and `SIGTERM` run the same three steps, in this order: stop accepting
connections, close the sockets that are idle, then wait for what is still in flight
with a five-second ceiling before cutting it off. Idle keep-alive sockets are closed
separately because `server.close()` waits on them, and a client that opened one and went
quiet would otherwise hold the process open for a request that no longer exists.

Because the transport is stateless there is no session to drain — what drains is the
requests. The guard makes a second `SIGINT` during the drain a no-op rather than a
second teardown.

### stdout belongs to the protocol

On stdio, stdout **is** the JSON-RPC channel. Server-side logging goes to stderr and
`serve` prints nothing of its own; only CLI commands write to stdout. A `console.log`
on the server path corrupts the stream, and the client reports a parse error that
points nowhere useful.

## The tool layer

There is no hand-written tool in this repository. `src/tools/from-content.js` walks
`CONTENT_DIR` once, at import, and builds one tool per `.md` file it finds:

```js
for (const path of markdownFiles()) {
  const name = toolNameFor(path);            // folder dropped, .md off, kebab → snake
  const text = readFileSync(join(CONTENT_DIR, path), "utf8");
  const { description } = parseFrontmatter(text);

  files.set(name, path);
  tools.push({
    config: { name, description },
    handler: async () => ({ content: [{ type: "text", text }] }),
  });
}
```

`CONTENT_TOOLS` is frozen at module scope and `TOOL_FILES` maps each tool name back to the
file it serves. `src/server.js` registers the array as-is:

```js
const TOOL_MODULES = Object.freeze(CONTENT_TOOLS);
```

Three things fail **at boot** rather than at the first call, because a set that cannot be
routed on should fail the process and not the caller:

* two files deriving the same tool name — one would silently shadow the other;
* a file deriving a name that is not a valid MCP tool name;
* a file with no frontmatter `description:` — a tool a client cannot choose between.

The file is served whole, frontmatter included, byte-identical to disk. The frontmatter
is part of the published text, not metadata to strip — and `description:` is load-bearing
twice over, as both the tool description and the route a caller makes on it.

No generated tool declares a schema, so `src/server.js` registers with the
three-argument `server.tool(name, description, handler)` form. There is no
`config.schema` branch to take the four-argument form, and no code path by which an
argument could be introduced without hand-writing a tool module beside the generator.

## Reading from the set

Everything is resolved at import, from the constant `CONTENT_DIR` in `src/version.js`.
A call is a map lookup and a string that was read once at startup: there is no filesystem
I/O on the read path, and there is no path a caller could aim at anything with.

The old defence — reject a `..` segment before calling the filesystem, then confirm the
resolved path is still inside `CONTENT_DIR` — guarded a `path` argument. With no argument
there is nothing to guard, so `src/content.js` was deleted rather than left in place with
no caller, where a future reader could not tell whether it was load-bearing.

## Authentication

There is none. No tool in this repository reads a credential, and none opens a socket.
The HTTP transport's `MCP_ALLOWED_HOSTS` is a filter, not a credential: it decides which
`Host` values are answered at all, and it says nothing about who is asking.

The template this repository was scaffolded from took one server-wide `API_KEY` and read
it inside the handler of each tool that needed it. That pattern is still recorded in
[`.agents/rules/secrets.md`](../../../.agents/rules/secrets.md) for a tool that does
need one — the requirement is to read it at call time rather than at import, and never to
make registration depend on it.

## The parity guarantee

`src/server.js` holds the only tool list. `listTools()` derives name/description pairs
from the same `TOOL_MODULES` array used for registration, and `src/cli.js` prints that
rather than keeping a list of its own.

`test/server.test.js` asserts that what the CLI would print matches what an MCP client
receives from `tools/list`, so the two surfaces cannot drift apart without failing the
suite. The same file pins the bijection between the files in `content/` and the tools on
the surface, in both directions.

## Related pages

* [`overview.md`](overview.md) — what this project is.
* [`../environments/setup.md`](../environments/setup.md) — running it.
