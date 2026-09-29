---
name: tool-authoring
description: How a tool comes to exist - the surface is derived from content/, so adding a markdown file to the set is the whole procedure.
---

# Tool Authoring

**Adding a markdown file to `content/` is adding a tool.** There is no tool file to
write, no import to add, and no entry to put in an array.

The surface is built at boot by `src/tools/from-content.js`, which walks `CONTENT_DIR`
once and makes one tool per `.md` file it finds. A contributor who follows the older
text in this file — write `src/tools/{name}.js`, import it, add it to `TOOL_MODULES` —
would hand-write a module for a guide that already has a tool, and put two tools for one
file on the surface.

## The derivation

A tool's name comes from its own filename:

1. take the basename, dropping the folder;
2. drop `.md`;
3. lowercase;
4. `-` → `_`.

| File | Tool |
|---|---|
| `SKILL.md` | `skill` |
| `references/python-flask-web-server-security.md` | `python_flask_web_server_security` |

So the folder is dropped, and the ten reference guides get long names. That is the honest
consequence of naming a tool after the guide it serves rather than after its folder — a
caller reading the tool list can tell what each one is without opening anything.

`NAME_OVERRIDES` in `src/tools/from-content.js` is the escape hatch, for a filename that
derives a name saying nothing useful. **This repository has no overrides.** Adding one is
a naming decision, and it belongs to the owner, not to whoever happened to add the file.

## The surface is read-only

Every tool is a read, and every tool takes **no argument at all**. Do not add a tool that
takes an argument, a verb, a credential, or a network call.

The property is **structural**: the code that would write is absent, not disabled behind
a check. That is stronger than a permission check on a general-purpose tool, and it is
what a consuming repository depends on when it points at this server — it cannot mutate
the set, because there is nothing here that mutates anything.

Not taking an argument is not a weaker version of the old check; it is the check. There
is no `path` to traverse with, so there is no traversal defence to keep correct.

## What the generator requires of a file

Three things fail the process at boot rather than the first caller, because a set that
cannot be routed on should not start:

* **A `description:` in the frontmatter.** It is the tool description, and it is what a
  caller routes on. A file without one publishes a tool nobody can choose.
* **A filename that derives a valid MCP tool name** — `^[a-z][a-z0-9_]{0,63}$`. A name
  starting with a digit or holding a character the client will not accept is a startup
  error naming the file and the fix.
* **A filename no other file derives.** Two files deriving one name would silently shadow
  each other, so the second is a startup error naming both.

Frontmatter is read by a small hand-rolled parser, not a YAML dependency: single-line
scalar fields only. A folded or multi-line value is not read, and a `description:` it
misses shows up as the missing-description error rather than an empty tool description.
Write `description:` on one line.

## Editing the set

`content/` is a copy of an upstream workspace set. It is served verbatim, with its
frontmatter intact, on the next boot — there is no draft space inside it. A change to a
guide belongs upstream and is copied here; see [`repository.md`](repository.md).

A file that must **not** be served still has to be a `.md` file to be skipped, so nothing
under `content/` can opt out by other means. `LICENSE.txt` is unserved because it is not
markdown. That is the whole mechanism, and it is why the licence is a `.txt`.

## Errors

A malformed set throws a plain `Error` naming the file and what to do about it, at
import. There is no runtime error path to design for: by the time a call arrives, the set
has already been validated and read.

## Tests

`test/server.test.js` owns the surface, and it is written to fail if the derivation is
broken:

* every `.md` under `content/` has exactly one tool, and every tool maps back to one
  file — the bijection, in both directions, so a guide added and never surfaced is caught
  as loudly as a tool serving a file that is gone;
* every name matches the derivation, and is a valid MCP tool name;
* no tool declares an input schema, so no tool takes an argument;
* every tool returns its own file byte for byte, frontmatter included;
* the total served text equals the total text on disk;
* `LICENSE.txt` is not served.

**If a change to `src/server.js` or `src/tools/from-content.js` makes any of those true
of a new tool, the test that should catch it does not exist yet — write it.**
