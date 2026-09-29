# Docker

The server runs in a container. The image serves **HTTP by default** — it is the shape
that reaches the port from another machine — and **stdio is one environment variable
away**, from the same entry point and the same payload.

## What a container is for here

A client can spawn this server as a subprocess and speak JSON-RPC over its stdin and
stdout, or reach it over HTTP. What the image buys either way:

* **A pinned toolchain.** `node:22-alpine` instead of whatever is on the host.
* **A clean dependency tree.** `npm ci --ignore-scripts --omit=dev` from the lockfile.
  `npm ci` fails rather than resolving something the lockfile does not contain.
* **A non-root process.** The image ends as `USER node`.
* **Isolation from the host**, which matters if the client is on a different machine.
* **A network boundary**, if you run it as a service.

## Build

```bash
docker build -t lxagents-security:0.1.0 .
```

Tag it with the version in `package.json` rather than `latest`. The image's job is to
be reproducible, and `latest` is the one tag that cannot be.

## Run — HTTP

The image sets `MCP_TRANSPORT=http`, so nothing has to be overridden:

```bash
docker run --rm -p 3000:3000 lxagents-security:0.1.0
curl -s http://localhost:3000/healthz
```

**`-p` is what makes it reachable**, and forgetting it produces a container that is
running, healthy, and connectable from nowhere. `EXPOSE 3000` documents the port; it
does not publish it, which is the part that surprises people.

Set `MCP_ALLOWED_HOSTS` when the container is reachable from anywhere but this machine —
**the allow-list is off unless you set it**, and the server says so on startup:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_ALLOWED_HOSTS=security.example.com \
  lxagents-security:0.1.0
```

See [Environment variables](env.md).

## Run — stdio

stdio means the container's stdin has to stay open and attached, and the transport has
to be selected:

```bash
docker run --rm -i -e MCP_TRANSPORT=stdio lxagents-security:0.1.0
```

**`-i` is not optional.** Without it Docker does not attach stdin, the server sees
closed input, and it exits immediately — which reads as a broken image rather than a
missing flag. There is nothing to publish: this form has no port.

To point an MCP client at it, give it the same command:

```json
{
  "mcpServers": {
    "lxagents-security": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-e", "MCP_TRANSPORT=stdio", "lxagents-security:0.1.0"]
    }
  }
}
```

Most clients do not attach a persistent stdin to a spawned process, so the stdio form
works only where the client does. The HTTP form reverses that: serving over a port is
the shape every client and every host already understands, which is why it is the image's
default rather than the exception.

## What is in the image

| Path | Why |
|---|---|
| `content/` | The product. Copied, not generated — the only thing a repository change is expected to alter. |
| `src/` | The server. |
| `package.json`, `package-lock.json` | Dependency resolution only. |

`.dockerignore` keeps the rest out: `node_modules`, `test`, `wiki`, `.agents`,
`AGENTS.md`, `README.md`, `Dockerfile`, `.git`, local clones under `mcps/`, and local
noise. **The image therefore cannot run its own test suite** — `npm test` needs `test/`
— and the suite is a gate on the repository, not on the artifact.

## There is no compose file

A `compose.yaml` encodes a deployment: how the service is routed, what it is called,
what fronts it. This repository has no deployment to encode, and whoever operates the
service decides those things. It ships an image that can be deployed, not a deployment.

## Verifying an image

```bash
docker run --rm -i -e MCP_TRANSPORT=stdio lxagents-security:0.1.0 < ../dev/null
```

With stdin closed the server exits at once, so this checks that the entrypoint resolves
and Node starts — not that the set is correct. To check the set, run `npm test` in a
checkout.

> **This image has never been built.** Docker was not available in the environment this
> was written in, so neither `EXPOSE`, nor the `MCP_TRANSPORT` default, nor the entrypoint
> override has been verified by a build. What has been checked is that every `COPY`
> source resolves against the real tree, that every `.dockerignore` entry matches
> something in it, and that `npm ci --ignore-scripts --omit=dev` succeeds against
> `package.json` and `package-lock.json` alone. Treat the rest as written-and-untested.

## Related pages

- [Local setup](setup.md) — running the server without a container.
- [Architecture](../information/architecture.md) — the entry point and the two transports.
- [Environment variables](env.md) — `MCP_TRANSPORT`, `PORT`, `HOST`, `MCP_ALLOWED_HOSTS`.
