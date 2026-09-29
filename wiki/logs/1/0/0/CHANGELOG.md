# 1.0.0

The first version of `lxagents-security` whose changelog matches the tree.

`0.1.0` describes a per-file tool layer with zod schemas and an optional unified API key.
There was never an API key, and after this release there is no zod schema either. That
entry is history and has not been rewritten.

## The surface is now one tool per file

`security_instruction`, which took a `path` into `content/`, is **removed**. It is
replaced by eleven tools, one per markdown file in the set, each named after the file it
serves:

```text
skill
golang_general_backend_security
javascript_express_web_server_security
javascript_general_web_frontend_security
javascript_jquery_web_frontend_security
javascript_typescript_nextjs_web_server_security
javascript_typescript_react_web_frontend_security
javascript_typescript_vue_web_frontend_security
python_django_web_server_security
python_fastapi_web_server_security
python_flask_web_server_security
```

**Breaking.** A client calling `security_instruction` must now call the tool for the
guide it wanted. There is no alias, deliberately: keeping one would preserve the exact
surface being removed.

The surface is derived from `content/` at boot rather than written by hand, so adding a
guide to the set is now the whole procedure for adding a tool.

## No tool takes an argument

This is the substantive change, not the renaming. The old tool took a `path`, and the
whole of `src/content.js` existed to defend it: reject a `..` segment before any
filesystem call, then confirm the resolved path was still inside the set. With no argument
there is nothing to traverse with and no defence to keep correct, so the module is
deleted rather than left in place with no caller.

A call is now a map lookup over text read once at startup — no filesystem I/O on the read
path, and containment is a property of the `CONTENT_DIR` constant rather than of a check
against something a caller passed in.

The read-only claim is stronger for it. No tool accepts a verb, takes a credential, opens
a socket, or reads a path.

## `content/LICENSE.txt` is no longer served

**Breaking, and small.** The old tool accepted any path inside `content/`, so a caller
could ask for the licence and get it. The new surface serves `.md` files only. The file
stays in the repository and keeps its Apache-2.0 terms; only its serving is dropped.

A licence is not an instruction, and it has no frontmatter `description:` for a caller to
route on — which is exactly why the generator requires one. Serving it would have put a
text nobody should be calling into the same list as the ten guides.

## Removed

* `security_instruction` — the path-taking tool.
* `src/tools/security-instruction.js`.
* `src/content.js` — the traversal guard, with its last caller gone.
* `zod` as a direct dependency — it was there for the one schema on the `path`
  argument, and nothing else in the tree imported it.

## Unchanged

* The transports. `POST /mcp` is still Streamable HTTP and the only HTTP transport;
  stdio is still the default. `HOST`, `PORT`, `MCP_TRANSPORT`, and `MCP_ALLOWED_HOSTS`
  behave exactly as they did at `0.1.0`, including an unset allow-list meaning no
  allow-list rather than an empty one.
* The set itself. Every file under `content/` is byte-identical to `0.1.0`; it is
  served verbatim, frontmatter included.
* `listTools()`, `createServer({ version })`, `SERVER_ID`, and `SERVER_TITLE`. The CLI
  prints the same derived list the MCP server registers.
