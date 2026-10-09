---
name: memory-decisions-http-bearer-token
description: Why the HTTP transport requires a bearer token and refuses to start without one, when this server had no authentication by design.
---

# Decision - The HTTP Transport Requires a Bearer Token

## Decision

The HTTP transport requires `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN` on every
route except `GET /healthz`, and the process refuses to start without a token of at least 32
characters. The stdio transport reads no token and needs none.

## What it reverses

This repository's documents argued for no authentication on the grounds that the set is public.
That argument was about confidentiality and it still holds: the token does not make a byte of the
set private. What changed is the question being asked. The owner wants a deployed instance to
serve only callers it has issued the token to, and the tool surface is unchanged. The token gates
the service, not the text, and the docs say so, so the old argument and the new control do not
contradict each other.

## Why the transport decides, not the bind address

A server on `127.0.0.1` behind a reverse proxy on the same host is reachable from the internet,
so "loopback needs no token" would be a waiver that fails open in exactly that deployment. The
transport is the fact the server can rely on: a client that spawns a process is local by
construction, and a client that opens a socket is not.

## Why fail closed, with no opt-out

An optional token means a deployment that forgot to set it runs open and says nothing a person
reads. Refusing to start turns that into a visible failure at deploy time, and `createApp` throws
too, so calling the app directly cannot skip it. An opt-out flag was considered and declined: it
is the one setting that would eventually be left on. This matters more here than in a sibling
server because the container image defaults to HTTP.

## Why the check is in the primary

Left to the workers, a missing token is the same line from each of them and then a respawn loop
through the crash limit.

## Alternatives declined

A query-string token, because a URL is logged. OAuth, because a static bearer is what the clients
in use can send and an OAuth server is a service to run. Per-client tokens, because nothing asks
for identity or individual revocation yet; rotation by changing the variable is the remedy.

## Known limits

One shared token; no TLS and no rate limiting in this process; a client that can only
authenticate through OAuth cannot use it.

## Consequence

Breaking for anyone who reaches a deployed instance, and for anyone who runs the image as it is
documented: `docker run -p 3000:3000 lxagents-security` now exits 1 without `MCP_AUTH_TOKEN`.
