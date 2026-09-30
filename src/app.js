import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { SERVER_ID, createServer } from "./server.js";
import { version } from "./version.js";

/**
 * The HTTP transport, as an application.
 *
 * This module builds an express app and returns it. **It does not listen** —
 * `src/index.js` owns the port. A file that both builds the app and binds a port
 * cannot be reasoned about, or tested, without binding one.
 *
 * The surface is deliberately narrow: `POST /mcp` and `GET /healthz`, a JSON-RPC 404
 * for everything else, and a 405 for any other method on `/mcp`. Nothing here is a
 * second source of truth about the tool list — `createServer()` is the same factory
 * `src/index.js` uses on stdio, and it returns a fresh `McpServer` per call, so each
 * request gets its own. Sharing one across requests would be a real bug: `McpServer`
 * holds per-connection state.
 */

/**
 * The request body ceiling, in bytes.
 *
 * The previous implementation enforced this by counting chunks as they arrived and
 * throwing past the limit. The same number, declared rather than counted.
 */
export const BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * The `Host` header allow-list, when one is configured.
 *
 * Unset — or set to nothing but commas and spaces — means the check is skipped rather
 * than guessed at. `MCP_DNS_REBINDING_PROTECTION` used to default to `false`, which
 * made these allow-lists inert; see `.agents/memory/tasks/activation-security.md`. A
 * wrong allow-list silently refusing every request is a worse failure than an absent
 * one, and this server serves public markdown either way, so the absence is reported
 * on startup rather than papered over with a default list.
 *
 * @returns {string[]}
 */
export function allowedHosts() {
  const raw = process.env.MCP_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

/**
 * A JSON-RPC error response.
 *
 * The shape every refusal on this server uses: the same envelope a client parses for a
 * successful response, so a client never has to branch on content type to find out it
 * was refused.
 */
function rpcError(res, status, code, message) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * Build the HTTP application.
 *
 * @param {{ inFlight?: Set<() => void> }} [options] — `inFlight`, when given, receives
 *   one closer per in-flight `/mcp` request so the entry point can drain them
 *   deliberately on shutdown rather than dropping them when the process exits.
 * @returns {import("express").Express}
 */
export function createApp({ inFlight } = {}) {
  const app = express();

  // Express stamps `X-Powered-By: Express` on every response it sends, which hands an
  // unauthenticated caller the framework and the exact version serving the port — a
  // free upgrade suggestion, and a narrowing of what an attacker has to guess. The
  // header is removed here deliberately and this line is a security control, not an
  // omission: do not restore it because a route looks like it is missing a header.
  //
  // `disable` rather than `app.set` because this is a setting of the app itself and it
  // must hold for every response, including the ones no route here produces.
  app.disable("x-powered-by");

  // Ahead of the body parser and ahead of every route, `/healthz` included: an
  // allow-list that guards `/mcp` and not `/healthz` is an allow-list with a hole in
  // it, and a deployment watching a green health check on a service nothing can reach
  // is worse than no check at all.
  //
  // The SDK applies host validation automatically only through its own Express app
  // factory, and only when the host is loopback. This server binds `0.0.0.0` by
  // default, so without an explicit list there is no `Host` filtering in exactly the
  // deployment — a container, a shared host — where it would matter.
  const hosts = allowedHosts();
  if (hosts.length > 0) {
    app.use(hostHeaderValidation(hosts));
  }

  app.use(express.json({ limit: BODY_LIMIT_BYTES }));

  /**
   * The health check. Answers without a session, a request, or a tool.
   */
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", server: SERVER_ID, version });
  });

  /**
   * The MCP endpoint.
   *
   * Stateless: a fresh `McpServer` and a fresh transport per request, with
   * `sessionIdGenerator: undefined` telling the transport not to mint one. There is no
   * session store to keep bounded, because there are no sessions.
   */
  app.post("/mcp", async (req, res) => {
    const server = createServer({ version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Fires on disconnect as well as on a clean close, which is the case that leaks.
    // Closing both halves is what keeps a stateless transport stateless: a retained
    // McpServer per request would be a leak per request.
    const finish = () => {
      if (inFlight) inFlight.delete(finish);
      void transport.close();
      void server.close();
    };
    if (inFlight) inFlight.add(finish);
    res.on("close", finish);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) rpcError(res, 500, -32603, String(error));
    }
  });

  // Any other method on `/mcp` is refused rather than served. It is a refusal and not
  // a 404: the path exists, and saying so is more useful to a client than pretending
  // it does not.
  app.all("/mcp", (req, res) => {
    rpcError(res, 405, -32000, `${req.method} is not supported in stateless mode`);
  });

  // Anything else is not a route this server has. A 404 that says so is more useful
  // than a bare one, and it is the only place a request is answered with prose.
  app.use((req, res) => {
    rpcError(res, 404, -32601, `Not found: ${req.originalUrl}`);
  });

  /**
   * Errors the routes above did not answer.
   *
   * `express.json` reports an oversized body as `entity.too.large` and a malformed one
   * as `entity.parse.failed`. **Both become the same 400 / `-32700`**, because the
   * previous hand-rolled reader produced one answer for both: it threw the same
   * failure whichever way the request was wrong. Collapsing them is a deliberate
   * preservation, not an oversight.
   *
   * Registered last, and declared with four arguments, because that is how express
   * recognises an error handler rather than ordinary middleware.
   */
  app.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error?.type === "entity.too.large" || error?.type === "entity.parse.failed") {
      rpcError(res, 400, -32700, "Parse error: request body is not valid JSON");
      return;
    }

    rpcError(res, 500, -32603, String(error?.message ?? error));
  });

  return app;
}
