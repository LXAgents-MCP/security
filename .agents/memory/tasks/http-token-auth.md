---
name: memory-tasks-http-token-auth
description: Requiring a bearer token on the HTTP transport while stdio stays open, and the breaking release that follows.
---

# Task: require a token on the HTTP transport

Three branches, stacked. **No version change until the owner approves one**, and so for the
release log.

## The plan

| # | Task | Branch | PR |
|---|---|---|---|
| 1 | The record | `chore/http-token-auth-plan` | |
| 2 | Require a token on HTTP | `feat/http-token-auth` | |
| 3 | Release | `release/{version}` | |

Branches stack: task 1 from `master`, task `k` from task `k-1`. The `PR` column is filled by
task 3, because pull request numbers do not exist until every branch is pushed and filling them
in on branch 1 would force a rebase of the rest. The working plan is untracked, under
`.agents/plans/`, and is deleted when the work lands. Where the two disagree, this record wins.

## What this is

**Goal.** A server reached over a network proves who is calling; a server a client spawns on its
own machine does not have to.

**Objective.** The HTTP transport refuses every request except `GET /healthz` unless it carries
`Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`, and refuses to start without a usable
token. The stdio transport is unchanged and needs no token. `npm test` is green, and every page
that said this server has no authentication says what is true now.

**Detail.** This repository only. `shared-instruction` gets the same change in its own record, and
`cli` is excluded because it is stdio-only by design. The token is read from the environment and
appears nowhere in a log, a response or a file. The set under `content/` does not change, so the
tool surface is untouched. The module `src/auth.js` is the same code as in `shared-instruction`,
copied rather than shared, so neither repository depends on the other.

## Baseline

`npm test` before any change: **42 tests, 42 pass, 0 fail** (Node 22).

## Decisions the owner approved with the plan

| # | Decision |
|---|---|
| D1 | Convention-named stacked branches, not the harness-named `claude/…` branch. This repository already recorded that rule in `../decisions/harness-branch-naming.md`. |
| D2 | The transport decides. HTTP always needs the token; stdio never does. A bind on loopback does not waive it, because a reverse proxy on the same host would turn that waiver into an open door. |
| D3 | One variable, `MCP_AUTH_TOKEN`, the sixth this server reads. The owner's approval of the plan is the say-so. |
| D4 | Fail closed. HTTP refuses to start with the token unset or shorter than 32 characters, and there is no opt-out flag. The check runs in the primary before any worker is forked, so a missing token is one clear line and not a crash loop. |
| D5 | `Authorization: Bearer` only, compared in constant time; no query-string form. A wrong or missing token is a `401` with `WWW-Authenticate: Bearer`, in the JSON-RPC error envelope. |
| D6 | The check sits after the `Host` allow-list and before the body parser and every route. `GET /healthz` stays open: it returns only `{status, server, version}` and an orchestrator's probe cannot send a token. |
| D7 | Clients that can send a header are the target: Claude Code, a `.mcp.json` `headers` entry, the Agent SDK, the Inspector. A client that authenticates only through OAuth cannot use a static token. |

## Consequences to carry into the release

Breaking for anyone who reaches a deployed HTTP instance: the new version refuses to boot without
`MCP_AUTH_TOKEN`, and a client without the header gets `401`. The token has to be set where the
service runs, and in each consumer's connector configuration, before the new version is deployed.
The release log names that under **Consumers must**.

## Task entries

### Task 1 — chore/http-token-auth-plan

Landed: this record and its row in `memory-index.md`. The `PR` column is filled by task 3, not
here. Nothing outside `.agents/` changes in this task. Task 2 depends on nothing from this entry
except the plan above.
