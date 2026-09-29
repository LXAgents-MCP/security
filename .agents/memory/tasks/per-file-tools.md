---
name: memory-tasks-per-file-tools
description: Task record for replacing the single path-taking security_instruction tool with eleven tools derived from content/ - one per file, no argument anywhere. Released as 1.0.0.
---

# Task: per-file tool surface

Branch `feat/per-file-tools`, off `master`. **Local commits only — nothing was pushed.**
No pull request was opened and nothing was merged, per the owner's explicit instruction;
it sets aside this repository's own "ask before opening a pull request" and "ask before
merging" gates deliberately.

## What this is

`security_instruction` took a `path` into `content/` and returned one file. That argument
is what a caller could have traversed with, what `src/content.js` existed to defend, and
what a caller had to guess correctly before it could read anything.

It is replaced by a surface **derived from the set at boot**: one tool per markdown file,
named after the file itself. Eleven tools. None of them takes an argument.

The surface is not written by hand, and that is the point of the change. Adding a guide
to `content/` is now the whole procedure for adding a tool — see
[`../../rules/tool-authoring.md`](../../rules/tool-authoring.md), which was rewritten
because it previously told a contributor to do the opposite.

## What landed

| Task | Result |
|---|---|
| T1 Baseline | `npm test` before any change: **29 tests, 28 pass, 1 skipped, 0 fail** on `master` @ `9deba2d`. Recorded in the plan's `verification.md` before anything was touched. |
| T2 Generator | `src/tools/from-content.js`, new. Reads `CONTENT_DIR` once at import; throws at boot on a name collision, an invalid MCP tool name, or a missing frontmatter `description:`. |
| T3 Registration | `src/server.js` — `TOOL_MODULES = Object.freeze(CONTENT_TOOLS)`. `listTools()`, `SERVER_ID`, `SERVER_TITLE`, and `createServer({ version })` unchanged. The `instructions` prose no longer names a tool that does not exist. |
| T4 Path tool deleted | `git rm src/tools/security-instruction.js`. Nothing else imported it. |
| T5 Suite rewritten | `test/server.test.js`. Traversal, unknown-path, set-root and path-schema cases **deleted**, not left passing. Bijection, derivation, no-argument, byte-identical, totals, licence-not-served, and `skill` reachable added. Write-verb, credential, no-key and CLI-parity kept. |
| T6 `src/content.js` | **Deleted.** Its only importer was the deleted tool, so nothing was left guarding. See below. |
| T7 Docs | `README.md`, `wiki/information/overview.md`, `wiki/information/architecture.md`, `wiki/environments/setup.md`, `wiki/environments/env.md`. |
| T8 Rules and state | `.agents/rules/tool-authoring.md` (rewritten), `.agents/rules/repository.md`, `.agents/memory/state/repository-state.md`, `.agents/wiki/context/repository-map.md`. |
| T9 Release | `package.json` `0.1.0` → `1.0.0`, `wiki/logs/1/0/0/CHANGELOG.md` new, `.agents/index/logs-index.md` row. |
| T10 Task record | This file, plus the `memory-index.md` row. Its own commit. |

## Test counts

| Point | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Baseline on `master` @ `9deba2d` | 29 | 28 | 0 | 1 |
| After this change | 30 | 29 | 0 | 1 |

The one skip is the Windows signal-delivery test in `test/http.test.js`, and it was
skipped at baseline too. It is not a failure and it is not this change's.

**The counts differ from what the plan predicted, and here is why.** `tasks.md` named
`test/server.test.js` for T5 and did not mention `test/http.test.js` at all — but that
file called `security_instruction` with a `path` in six places and asserted a one-tool
surface in a seventh, so it would have shipped red. T5 therefore also retargeted
`test/http.test.js`. Net: `server.test.js` went from 12 tests to 13, `http.test.js` from
17 to 17 (two payload-based tests replaced by one structural one and one parity one, one
tool-call test retargeted), and the total moved from 29 to 30.

**One flaky failure, observed in 2 of 8 full-suite runs.** `the startup line announces that
no allow-list is applied` in `test/http.test.js` failed twice on a full `node --test` run
and passed on every isolated run of that file and on the other six full runs. That test
spawns `src/index.js` as a child and waits for a startup line on a 30-second deadline;
under 30 concurrent child processes on WSL `/mnt/c` the line can lose that race. It is a
harness timing sensitivity that predates this change — the same file and the same mechanism
landed in the previous task — and not a defect in the surface. It is recorded in
[`../state/repository-state.md`](../state/repository-state.md) so the next person to see it
knows where to look, and it is **not fixed here**.

## What was verified, and how

Every check below was executed. Nothing in this section is an intention.

| Check | Result |
|---|---|
| `npm test` | 30 tests, 29 pass, 0 fail, 1 skipped (Windows) — on the last of eight full-suite runs; see the flake note above |
| `listTools()` returns 11 | yes |
| The 11 names match `tasks.md` exactly | yes, character for character |
| `node src/cli.js tools` prints 11 names, equal to the client's `tools/list` | yes |
| The traversal / unknown-path / set-root / path-schema tests are **gone from the file** | yes; `grep -c '^test(' test/server.test.js` = 13, and none of them takes a `path` |
| Bijection holds in both directions | yes — asserted as `deepEqual(served, files)` plus a size check |
| No tool declares an input schema | yes — asserted per tool, `properties` and `required` both empty |
| `skill` reachable | yes |
| `LICENSE.txt` not served | yes — asserted by a named test |
| Total served text equals total bytes of the markdown in `content/` | yes |
| `package.json` is `1.0.0` | yes; `src/version.js` reports `1.0.0` at import |
| `src/tools/from-content.js` is byte-identical to the reference | yes — `diff` against `LXAgents-MCP/shared-instruction/src/tools/from-content.js` is empty |
| `wiki/logs/1/0/0/CHANGELOG.md` exists and `logs-index.md` carries the row | yes |
| `git check-ignore -v .agents/plans/tasks.md` prints the `/.agents/plans/` rule | yes |
| Session-link scan over `master..HEAD` | no output |
| Every commit carries the `Co-Authored-By:` trailer, and nothing else from the harness | yes — 5 commits, 5 trailers, one distinct trailer line |

## Deviations from the plan, and why

Four places where the plan and the repository did not agree. Each was resolved in favour
of what the tree actually is, and none was resolved silently.

### 1. `test/http.test.js` was not in the plan and had to be rewritten

Described in **Test counts** above. Leaving it would have meant committing a red suite.

### 2. Verification item 6 is unsatisfiable as written

> "`skill` is reachable, and its text names all ten reference files."

**It does not.** `content/SKILL.md` names the references *directory* and the two filename
shapes its guides follow — `<language>-<framework>-<stack>-security.md` and
`<language>-general-<stack>-security.md` — and names exactly one file by name
(`javascript-general-web-frontend-security.md`). The other nine are described, not listed.

Satisfying the check as written would have meant editing `content/SKILL.md`, which this
repository does not do: the set is a verbatim copy of the upstream workspace set and a
change to it belongs there. **Reported, not fixed.**

What the test asserts instead is the routing property that actually holds and is worth
pinning: `skill` is reachable, it names the directory and both patterns, and every one of
the ten reference files matches one of them. That is how a caller reading `skill` finds a
guide — by shape, not by a list. The test comment says so, and says that `skill` does not
enumerate the ten filenames, so a reader is not misled about what was checked.

The upstream fix, if the owner wants the plan's original intent: have `SKILL.md` enumerate
its ten references. That is a change to the workspace set, not to this repository.

### 3. `src/version.js` gained two exports

The plan has `from-content.js` import `CONTENT_DIR` from `../version.js`, and requires
that module to be byte-identical to the reference. This repository's `src/version.js` did
not export `CONTENT_DIR` — `src/content.js` did, and T6 deletes that file. So `ROOT` and
`CONTENT_DIR` moved to `src/version.js`, which is where the sibling repository keeps them
and where the generator reads them from. Its version resolution is untouched: same read,
same path, same fallback.

Verification item 12 says `src/version.js` is "untouched". Read as *the version carrier is
untouched*, that holds. Read as *the file gained no lines*, it does not, and there was no
way to satisfy both the byte-identical module and that reading at once.

### 4. `zod` was found to be unused, and kept anyway

Not in the plan. It existed for the one schema on the `path` argument, and after T4 nothing
in the tree imported it — the same "left behind with no caller" problem T6 was told to
resolve for `src/content.js`. `@modelcontextprotocol/sdk` still depends on zod
transitively, so nothing is missing at runtime, and the suite passes either way.

It was removed at first, on that reasoning. **The owner decided to keep it**, so it is
restored in `package.json` and this record is the correction. `package.json`, `setup.md`
and `overview.md` all still declare it. Dropping an unused dependency is a separate
change from the tool surface, and it is the owner's call rather than this task's.

## Other things worth knowing

* **`NAME_OVERRIDES` carries an entry for `AGENTS.md` that this repository cannot use.**
  The plan says "no overrides needed in this repository" and also says the module must be
  byte-identical to the reference. The reference needs the override because it has an
  `AGENTS.md`; this set does not. The unused entry was kept, because the plan's stated
  reason for the file being identical is that four repositories serving this shape of set
  should hold one derivation rather than four — and a future fix wants one place to change.
* **`content/LICENSE.txt` is no longer served.** The old tool accepted any path inside
  `content/`, so a caller could ask for the licence and get it. It is in the changelog and
  in `scope.md`'s terms, and `test/server.test.js` pins the decision so a later change
  cannot quietly add it back.
* **The `instructions` prose was rewritten, not deleted.** It names `skill` as the entry
  point and three example tools, states the reading order, and ends "No tool takes an
  argument."

## Open, not decided here

* **`SKILL.md` does not enumerate its ten references.** See deviation 2. It belongs
  upstream, in the workspace `.agents/security/security-best-practices/` set, and cannot be
  fixed from this repository.
* **Two broken links that predate this work.** `wiki/environments/env.md` and
  `wiki/information/architecture.md` both point at `../../../.agents/rules/secrets.md`,
  which is one level above the repository; `../../.agents/rules/secrets.md` would resolve.
  Found while checking links during the previous task; left alone because it is not this
  change's to make, and neither file was otherwise falsified here.
* **No push.** The branch is local. The owner handles delivery.
* **`test/http.test.js` remains timing-sensitive** under a full parallel run on a slow or
  network filesystem. Not fixed here; fixing it would be a change to the transport suite
  that no task asked for.
