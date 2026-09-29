# Local Setup

`@lxagents-mcp/security` is **dual-purpose**. The same code is reachable two ways:

| Mode | What it is | Who uses it |
|---|---|---|
| **CLI mode** | A terminal command | A person running it by hand or from a script |
| **Server mode** | An MCP server over stdio or streamable HTTP | An MCP client, an editor, an agent, or a connector |

Both modes share one implementation, so a result produced in one is identical to the
same result produced in the other.

## Requirements

Node.js 20 or newer. There is no build step.

```bash
npm install
npm test
```

Two dependencies: `@modelcontextprotocol/sdk` and `zod`.

There is also a container image, for a host that cannot run Node at all — see
[`docker.md`](docker.md). It is not built by `npm test` and has never been built.

## No authentication

Nothing here reaches an external service, so there is no key. The server starts, lists
its tool, and answers every request with nothing configured.

There are four optional environment variables — `MCP_TRANSPORT`, `PORT`, `HOST`, and
`MCP_ALLOWED_HOSTS` — and none of them is required. `MCP_ALLOWED_HOSTS` is a `Host`
allow-list for the HTTP transport and is **off unless you set it**; the server says so
on startup. Set it before exposing the port anywhere but your own machine. Full list:
[`env.md`](env.md).

## CLI mode

### Install

```bash
# From a checkout, for development
npm install
npm link

# Or globally, from the registry
npm install -g @lxagents-mcp/security
```

Without installing anything:

```bash
node src/cli.js --help
npm run cli -- --help
```

### Use

```bash
lxagents-security --help
lxagents-security --version
lxagents-security tools
```

`tools` prints every registered tool with its description:

```text
security_instruction  Read one security guide from the global security set by path, e.g. …
```

The list comes from `listTools()` in `src/server.js` — the same list the MCP server
registers — so the two surfaces cannot disagree.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | The request was understood but could not be satisfied |
| `2` | The command line itself was wrong |

## Server mode

### Install

An MCP client spawns the server as a subprocess, so installing it means pointing the
client at it. Either bin works: `lxagents-security-server` is the server directly, and
`lxagents-security serve` reaches the same server through the CLI.

```json
{
  "mcpServers": {
    "lxagents-security": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/path/to/security"
    }
  }
}
```

Once the package is installed globally, the bin can be named directly instead:

```json
{
  "mcpServers": {
    "lxagents-security": {
      "command": "lxagents-security-server"
    }
  }
}
```

For a remote connector, point the client at `https://<host>/mcp`, including the
`/mcp` path.

### Run

```bash
# stdio
npm start
lxagents-security serve --stdio

# streamable HTTP
npm run start:http
lxagents-security serve --http --port 3000
```

`HOST` has no flag — set it in the environment, for example
`HOST=127.0.0.1 npm run start:http` to keep the port off every interface.

Check it is up:

```bash
curl -s http://localhost:3000/healthz
```

### Inspect it

```bash
npm run inspect
```

This runs the MCP Inspector against the stdio server, listing every tool and letting
you call them.

### stdout belongs to the protocol

On the stdio transport, stdout **is** the JSON-RPC channel. Logging goes to stderr,
and `serve` prints nothing of its own. Only CLI commands write to stdout.

A `console.log` on the server path is a bug that corrupts the protocol stream.

## Related pages

- [`env.md`](env.md) — every environment variable this project reads
- [`docker.md`](docker.md) — building and running the container image
- [`../information/overview.md`](../information/overview.md) — what this project is
- [`../information/architecture.md`](../information/architecture.md) — how the pieces fit
- [`README.md`](../../README.md)
