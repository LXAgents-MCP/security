---
name: logs-index
description: Release history of lxagents-security, newest version first - what changed in each version and where its changelog lives.
---

# Logs Index

**Scope:** `wiki/logs/`
**Parent:** [`project-wiki-index.md`](project-wiki-index.md)

## Versions

| Version | Changelog | Summary |
|---|---|---|
| `2.0.0` | [`../../wiki/logs/2/0/0/CHANGELOG.md`](../../wiki/logs/2/0/0/CHANGELOG.md) | The HTTP transport requires a bearer token: every route except `GET /healthz` needs `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`, and HTTP refuses to start without a token of at least 32 characters. stdio is unchanged and needs none. The container image defaults to HTTP, so `docker run -p 3000:3000` now needs `-e MCP_AUTH_TOKEN`. Tests 42 → 58. Clients must set the token where HTTP runs before deploying, send the header, and put TLS in front. |
| `1.1.0` | [`../../wiki/logs/1/1/0/CHANGELOG.md`](../../wiki/logs/1/1/0/CHANGELOG.md) | The HTTP transport becomes an express application, and a `node:cluster` primary forks workers that share the one `PORT`. The published contract does not change. |
| `1.0.0` | [`../../wiki/logs/1/0/0/CHANGELOG.md`](../../wiki/logs/1/0/0/CHANGELOG.md) | The single path-taking tool is replaced by eleven derived tools, one per file in the set; no tool takes an argument; the licence is no longer served. |
| `0.1.0` | [`../../wiki/logs/0/1/0/CHANGELOG.md`](../../wiki/logs/0/1/0/CHANGELOG.md) | Per-file tool layer with zod schemas and an optional unified API key; agent instruction system adopted. |

## Maintenance

A new version directory is added here **in the same commit** that creates it. Newest
version first. Version directories are `wiki/logs/{Major}/{Minor}/{Patch}/`, and a
version is never bumped without explicit user approval — see
`agents://rules/versioning.md`.
