#!/usr/bin/env node

/*
 * Server entry point.
 * Nothing here may write to stdout: on stdio, stdout is the JSON-RPC channel.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allowedHosts, createApp } from "./app.js";
import { SERVER_ID, createServer } from "./server.js";
import { version } from "./version.js";

const transportName = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

/*
 * The bind address, named rather than implied.
 *
 * listen(port) with no host binds every interface, which is what a published port needs
 * and what a container gets — but it is a decision nobody made, so it is made here,
 * visibly. `HOST=127.0.0.1` is the way to take it back.
 */
const host = process.env.HOST || "0.0.0.0";

if (transportName === "http" || transportName === "streamable-http") {
  const server = createApp().listen(port, host, () => {
    const where = host === "0.0.0.0" ? "all interfaces" : host;
    process.stderr.write(
      `${SERVER_ID} ${version} serving over http on :${port}/mcp (${where})\n`
    );

    // Said out loud, because the default is the unguarded one. Someone reading a
    // container's startup log is the only person who can act on it, and a control
    // that is off silently is worse than no control at all — it reads as present.
    if (allowedHosts().length === 0) {
      process.stderr.write(
        `${SERVER_ID} ${version} MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied.\n`
      );
    }
  });

  /*
   * Shutdown, in three steps, in this order.
   *
   * `close()` first, so nothing new arrives — a request accepted during the drain gets
   * an answer rather than a refused connection. Then idle keep-alive sockets are
   * closed, because `close()` waits on them and a client that opened one and went quiet
   * would hold the process open indefinitely for a request that no longer exists. Then
   * a short grace period, after which whatever is genuinely still in flight is cut off
   * rather than waited on forever.
   *
   * Each request is self-contained — a fresh McpServer, closed when its response
   * closes — so there is no session state to drain. What drains is the requests.
   */
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`${SERVER_ID} ${version} ${signal}, draining\n`);

    const forced = setTimeout(() => server.closeAllConnections(), 5000);
    forced.unref();

    server.close(() => {
      clearTimeout(forced);
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} else {
  const server = createServer({ version });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${SERVER_ID} ${version} serving over stdio\n`);
}
