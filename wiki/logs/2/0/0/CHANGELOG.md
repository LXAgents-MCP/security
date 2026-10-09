# 2.0.0

**Released:** 2026-10-09

The HTTP transport now requires a bearer token. Every route except `GET /healthz` refuses a
request that does not carry `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`, and the
server refuses to start over HTTP without a token of at least 32 characters. The stdio transport
is unchanged and needs no token. **The tool surface and `content/` are unchanged**: the same
eleven tools return the same text. This is a major release because a client of a deployed HTTP
instance that sends no token now gets a `401`, and because the container image defaults to HTTP:
the documented `docker run -p 3000:3000 lxagents-security` now exits `1` without the variable.

**Clients must:**

1. **Set `MCP_AUTH_TOKEN` wherever the HTTP transport runs, before deploying this version.**
   At least 32 characters; `openssl rand -hex 32` makes one. The new version exits `1` at startup
   without it, so deploying first and setting it after is the wrong order.
2. **Send the token from every client of an HTTP instance**, as `Authorization: Bearer <token>`.
   In a `.mcp.json` that is `"headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }`, with
   the variable set in the client's environment; with Claude Code it is
   `claude mcp add --transport http … --header "Authorization: Bearer …"`. Without the header
   every request except `GET /healthz` is a `401` and the connector reports no tools. A client
   that can only authenticate through OAuth, including a connector added through a settings page
   that offers only OAuth, cannot use a static token.
3. **Put TLS in front of the HTTP transport.** A bearer token over plain `http` can be read on
   the path, and this server does not terminate TLS.
4. **If you run the image, pass the token:**
   `docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-security:2.0.0`. The image defaults to
   HTTP. Its stdio form, `docker run --rm -i -e MCP_TRANSPORT=stdio …`, needs nothing new.
5. **Restart any session that was open**, so the client reloads the connector.

**If you use stdio — a spawned `node src/index.js` or `docker run -i -e MCP_TRANSPORT=stdio` — you
need to do nothing.** It never reads the variable, and a value set in the environment does not
affect it.

## Added

- **`src/auth.js`** — `tokenProblem`, `configuredToken` and `requireBearerToken`. The token is
  read when the app is built, not when the module loads, and surrounding whitespace is dropped
  because a value read out of a file often ends in a newline.
- **`MCP_AUTH_TOKEN`**, the sixth environment variable the server reads and the first that is a
  secret.
- **A startup line** saying a bearer token is required on every route except `GET /healthz`. It
  never carries the value.
- **Sixteen tests**, taking the suite from 42 to 58, and every existing HTTP test now runs with a
  token. They cover missing, wrong, malformed and correct credentials; that no route is revealed
  to an unauthenticated caller; that the check runs before the body is parsed; the exact
  `/healthz` exemption; that the token never reaches the output; the refusal to start with one
  worker and with several; and that stdio ignores even an unusable value. Four controls were each
  broken on purpose, and the matching test failed every time.
- **`.agents/memory/decisions/http-bearer-token.md`**, recording why the token is required, why
  the transport and not the bind address decides, and why there is no opt-out.

## Changed

- **HTTP refuses to start without a usable token.** One line on stderr naming the variable and
  the length it found, then exit code `1`. The check runs in the primary before any worker is
  forked, so a missing token is one line and not a respawn loop; `createApp` throws as well, so
  the check cannot be skipped by calling the app directly. There is no flag that turns it off.
- **The token check sits after the `Host` allow-list and before the body parser and every
  route.** An unauthenticated caller cannot make the server read and parse a body, and cannot tell
  a `404` from a `405`. The one exemption is `GET /healthz`, exactly; `/healthz/x`, `POST` and
  `HEAD` are refused.
- The test "the server reads no credential and needs no key to answer" is reworded to say "the
  tool surface", which is what it checks. The server now reads one credential.
- Documentation that said this server has no authentication now says what is true: the README,
  the Dockerfile comments, and the setup, environment, Docker and architecture pages, plus the
  repository map and state. Image tags in the examples are `2.0.0`.

## Security

- **The comparison is constant-time**, over SHA-256 digests, so neither the token's length nor how
  much of a guess was right shows in how long the answer takes.
- **The token is header-only.** There is no query-string form, because a URL is logged.
- **The token is never logged, echoed in an error, or put in a response**, and a test asserts it.
- **A bind on loopback does not waive the token.** A reverse proxy on the same host would turn
  that into an open door, and the server cannot reliably tell "local" from its bind address.

## Known limits

- **One shared token.** There is no per-client identity and no revoking one client alone; rotate
  by changing the variable and restarting. The server is stateless, so nothing is dropped.
- **No TLS and no rate limiting in this process.** Both belong to whatever fronts it.
- **The token gates the service, not the text.** The set is public, so a token on this server does
  not make any of it confidential.

## Not changed, and noted

Two instruction files still describe the old behaviour and were not edited, because the discovery
protocol reserves edits to instruction files for the owner: `.agents/rules/secrets.md`, which says
no credential is read and that a credential is read inside the handler, whereas the transport token
is read at startup so that the server can fail closed; and `.agents/rules/repository.md`, whose
command table lists the HTTP run command without a token. Both are reported in the pull request.

The Docker image was not built, and nothing was deployed.
