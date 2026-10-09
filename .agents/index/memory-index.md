---
name: memory-index
description: Index of .agents/memory/ - repository state and decisions. Read every session so work continues rather than restarts.
---

# Memory Index

**Scope:** `.agents/memory/`
**Parent:** [`root-index.md`](root-index.md)

This index is the standing exception to the routing protocol: it is read **every
session**, because continuity depends on it. Load only the rows whose scope matches the
current request.

## State

| File | Purpose |
|---|---|
| [`../memory/state/repository-state.md`](../memory/state/repository-state.md) | Current known state: what exists, the stack, what is not built, and the next obvious step. |

## Decisions

| File | Purpose |
|---|---|
| [`../memory/decisions/harness-branch-naming.md`](../memory/decisions/harness-branch-naming.md) | Why a harness-designated branch never overrides the branching strategy. |
| [`../memory/decisions/express-for-http-transport.md`](../memory/decisions/express-for-http-transport.md) | Why the transport moved to express, and why the SDK's `hostHeaderValidation` is mounted natively rather than through a hand-written response shim. |
| [`../memory/decisions/http-bearer-token.md`](../memory/decisions/http-bearer-token.md) | Why the HTTP transport requires a bearer token and refuses to start without one, when this server had no authentication by design. |

## Tasks

| File | Purpose |
|---|---|
| [`../memory/tasks/http-transport-and-docker.md`](../memory/tasks/http-transport-and-docker.md) | Host allow-list, explicit host binding, drain-before-close, and the container image. No second transport, no version change. |
| [`../memory/tasks/per-file-tools.md`](../memory/tasks/per-file-tools.md) | Replacing the single path-taking tool with eleven tools derived from `content/` — one per file, no argument anywhere. Released as `1.0.0`. |
| [`../memory/tasks/express-cluster-migration.md`](../memory/tasks/express-cluster-migration.md) | Replacing `node:http` with an express application at `POST /mcp`, and answering requests from cluster workers on one port. The `Dockerfile` is untouched. |
| [`../memory/tasks/http-token-auth.md`](../memory/tasks/http-token-auth.md) | Requiring a bearer token on the HTTP transport while stdio stays open, and the breaking release that follows. |

## Maintenance

Any file added to or removed from `.agents/memory/` is reflected here **in the same
commit**. Memory is written freely and needs no approval — see
`agents://rules/memory-policy.md`.
