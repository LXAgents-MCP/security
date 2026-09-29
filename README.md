# lxagents-security

The global security instruction set, served read-only over MCP.

- **Organization:** `LXAgents-MCP`
- **Repository:** `security`
- **Server ID:** `lxagents-security`
- **Package:** `@lxagents-mcp/security`
- **Dual-purpose:** a CLI (`lxagents-security`) and an MCP server
  (`lxagents-security-server`).

The set covers **Python**, **JavaScript/TypeScript**, and **Go** — the language and
framework guides for writing secure code and reviewing code that is already written.
One implementation behind two surfaces, so a result produced through the CLI is identical
to the same result produced through an MCP client. Node.js 20+, ESM, no build step.

## The tools

One tool per file in the set — 11 of them, named after the file each one serves, and none
of them takes an argument.

| Tool | Returns |
|---|---|
| `skill` | `SKILL.md`, the workflow and the router |
| `golang_general_backend_security` | `references/golang-general-backend-security.md` |
| `javascript_express_web_server_security` | `references/javascript-express-web-server-security.md` |
| `javascript_general_web_frontend_security` | `references/javascript-general-web-frontend-security.md` |
| `javascript_jquery_web_frontend_security` | `references/javascript-jquery-web-frontend-security.md` |
| `javascript_typescript_nextjs_web_server_security` | `references/javascript-typescript-nextjs-web-server-security.md` |
| `javascript_typescript_react_web_frontend_security` | `references/javascript-typescript-react-web-frontend-security.md` |
| `javascript_typescript_vue_web_frontend_security` | `references/javascript-typescript-vue-web-frontend-security.md` |
| `python_django_web_server_security` | `references/python-django-web-server-security.md` |
| `python_fastapi_web_server_security` | `references/python-fastapi-web-server-security.md` |
| `python_flask_web_server_security` | `references/python-flask-web-server-security.md` |

Start at `skill`. It names the language-and-framework workflow and routes to the ten
reference guides.

The surface is derived from `content/` at boot, so adding a guide to the set is the whole
procedure for adding a tool — there is no tool file to write. See
[`.agents/rules/tool-authoring.md`](.agents/rules/tool-authoring.md).

There is no write path. No tool takes an argument at all, no tool accepts a verb, no tool
takes a credential, and no tool reaches a network. The code that would write is absent
rather than disabled, so pointing a repository at this server cannot mutate the set.

## Quick start

```bash
npm install
npm test
npm run cli -- tools
npm start
```

On the stdio default, no key, no environment variable, no configuration. The server
starts and answers with nothing set. No tool reads a credential, on any transport.

### Security note — the HTTP transport

`MCP_ALLOWED_HOSTS` is a comma-separated allow-list of `Host` header values, and **an
empty value means the guard is off** — not "allow everything on the list", which is the
same thing, but not "allow nothing", which is what the name suggests. The server
announces on startup when it is unset, because the default is the unguarded one.

The list is needed because the SDK applies host validation on its own only when the
server is on loopback, and the HTTP transport binds `0.0.0.0` — so without an explicit
list, nothing is filtering the `Host` header in exactly the deployment that reaches it
from a network. Set it before exposing the port anywhere but your own machine. Full
variable reference: [`wiki/environments/env.md`](wiki/environments/env.md).

## The set

```
content/
  SKILL.md                        the workflow, and the router into references/
  LICENSE.txt                     Apache-2.0, from the upstream package — not served
  references/
    golang-general-backend-security.md
    javascript-express-web-server-security.md
    javascript-general-web-frontend-security.md
    javascript-jquery-web-frontend-security.md
    javascript-typescript-nextjs-web-server-security.md
    javascript-typescript-react-web-frontend-security.md
    javascript-typescript-vue-web-frontend-security.md
    python-django-web-server-security.md
    python-fastapi-web-server-security.md
    python-flask-web-server-security.md
```

Every `.md` file here is a tool. `LICENSE.txt` is not, and is never served.

## Register it

| Transport | How |
|---|---|
| Local stdio | `command: node`, `args: ["src/index.js"]`, `cwd:` this checkout |
| Local HTTP | `npm run start:http`, then `http://localhost:3000/mcp` |
| Remote | Settings → Connectors → Add custom connector → `https://<host>/mcp` |

The `/mcp` path is not optional on either HTTP form.

## Documentation

- [`wiki/information/overview.md`](wiki/information/overview.md) — what this project is.
- [`wiki/information/architecture.md`](wiki/information/architecture.md) — how the pieces
  fit together.
- [`wiki/environments/setup.md`](wiki/environments/setup.md) — installing and running
  both modes.
- [`wiki/environments/env.md`](wiki/environments/env.md) — environment variables.
- [`wiki/environments/docker.md`](wiki/environments/docker.md) — the container image.

Full map: [`.agents/index/project-wiki-index.md`](.agents/index/project-wiki-index.md).

## Sibling servers

This is one of four. `lxagents-agents-base` carries the org-wide conventions every
repository resolves; `RBAgents-MCP/shared-instruction` carries Roblox development; and
`RBAgents-MCP/security` carries Roblox security, which is a different threat model and is
not covered here.

## Working with agents

Start at [`AGENTS.md`](AGENTS.md). Shared conventions — branching, commits, pull
requests, the task workflow — are served by the `lxagents-agents-base` MCP connector and
are not stored in this repository.

## License

MIT for the server — see [`LICENSE`](LICENSE).

The material under `content/` is Apache-2.0, redistributed from the upstream
`security-best-practices` package with its licence text intact — see
[`content/LICENSE.txt`](content/LICENSE.txt).
