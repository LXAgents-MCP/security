#!/usr/bin/env node

/*
 * Server entry point.
 * Nothing here may write to stdout: on stdio, stdout is the JSON-RPC channel.
 */

import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allowedHosts, createApp } from "./app.js";
import { MIN_TOKEN_LENGTH, tokenProblem } from "./auth.js";
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

/**
 * How many HTTP workers to run.
 *
 * `MCP_CLUSTER_WORKERS` overrides the count. **A value of 1 means no forking at all** —
 * one process, one listener, the pre-cluster behaviour — which is what makes the
 * cluster change bisectable: the same code answers, with and without workers, and a
 * difference between them is a difference in the fork rather than in the transport.
 *
 * Unset, the count is the number of CPUs the process was actually given, not a
 * constant: a container with two CPUs gets two workers and a laptop does not get
 * eight.
 *
 * @returns {number}
 */
function workerCount() {
  const configured = Number.parseInt(process.env.MCP_CLUSTER_WORKERS ?? "", 10);
  if (Number.isInteger(configured) && configured >= 0) return configured;
  return availableParallelism();
}

/**
 * The worker: the process that actually answers.
 *
 * Every worker binds the same `port`. The kernel's shared handle and the round-robin
 * scheduler do the distribution — no `SO_REUSEPORT` is set by hand and no sticky
 * session logic is written, because the scheduler already has the information
 * (which connection is next) that a sticky-session scheme would have to reconstruct.
 */
function startWorker() {
  // A worker whose primary is gone holds the port for whoever starts next. The test
  // harness kills the child process directly, so this is the difference between a
  // suite that passes and a suite that fails on its second run with EADDRINUSE.
  process.on("disconnect", () => process.exit(0));

  const server = createApp().listen(port, host, () => {
    const where = host === "0.0.0.0" ? "all interfaces" : host;
    process.stderr.write(
      `${SERVER_ID} ${version} serving over http on :${port}/mcp (${where})\n`
    );

    // The token is required for the process to be here at all, so this line is a
    // statement of fact and not a warning. It never carries the value.
    process.stderr.write(
      `${SERVER_ID} ${version} bearer token required on every route except GET /healthz.\n`
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
}

/**
 * The primary: the process that forks workers and does not serve.
 *
 * It binds nothing, so the startup lines in a container's log describe ports that are
 * genuinely open — one per worker, from the processes that opened them. A primary that
 * logged a listening line of its own would be claiming a port it does not hold.
 */
function startPrimary() {
  // Fail closed, before anything is forked. HTTP without a token is an open door on a
  // network, and the only thing that can be done about it is not to start. Checked here
  // as well as in `createApp` because here it is reported once: left to the workers, a
  // missing token would be the same line printed by each of them and then a respawn loop
  // through the crash limit.
  //
  // `exitCode` and a return, not `process.exit()`: nothing is listening yet, so the
  // process ends on its own once the line is written, and the line is never cut off.
  const problem = tokenProblem();
  if (problem) {
    process.stderr.write(
      `${SERVER_ID} ${version} will not start the HTTP transport: ${problem}. ` +
        `Set MCP_AUTH_TOKEN to a secret of at least ${MIN_TOKEN_LENGTH} characters, for example ` +
        "the output of: openssl rand -hex 32. stdio needs no token.\n"
    );
    process.exitCode = 1;
    return;
  }

  const count = workerCount();

  // Read by the respawn handler below, and set by the signal handler further down, so
  // it is declared before either can run rather than beside the one that reads it
  // first.
  let draining = false;

  if (count <= 1) {
    // No fork. The worker path is the whole server, and the two lines below are what a
    // single-process run prints; saying so is worth a line of its own.
    process.stderr.write(
      `${SERVER_ID} ${version} MCP_CLUSTER_WORKERS is ${count}, so no worker is forked.\n`
    );
    startWorker();
    return;
  }

  process.stderr.write(
    `${SERVER_ID} ${version} forking ${count} HTTP workers on :${port}/mcp\n`
  );

  // A worker that exits unexpectedly is replaced, but not forever: a server that cannot
  // start its workers is a server that should say so and stop, not one that respawns
  // into a crash loop nobody is watching.
  let starts = 0;

  cluster.on("exit", (worker, code, signal) => {
    if (draining) return;
    if (starts > count * 10) {
      process.stderr.write(
        `${SERVER_ID} ${version} a worker exited ${code ?? signal} ${starts} times, not restarting it.\n`
      );
      process.exit(1);
      return;
    }
    process.stderr.write(
      `${SERVER_ID} ${version} worker ${worker.process.pid} exited ${code ?? signal}, restarting it\n`
    );
    forkWorker();
  });

  function forkWorker() {
    starts += 1;
    cluster.fork();
  }

  for (let i = 0; i < count; i += 1) forkWorker();

  /*
   * Relay the signal, then wait.
   *
   * The signal goes to the workers rather than being handled here alone, because the
   * workers hold the requests and the listener. The primary exits when the last worker
   * is gone, so the port is genuinely closed before the process that started it is —
   * a test that stops the server and then checks the port is refused must not race a
   * primary that exits while its workers are still answering.
   */
  const shutdown = (signal) => {
    if (draining) {
      // A second signal means the operator has stopped waiting.
      process.exit(0);
    }
    draining = true;

    const workers = Object.values(cluster.workers ?? {}).filter(Boolean);
    process.stderr.write(`${SERVER_ID} ${version} ${signal}, draining ${workers.length} worker(s)\n`);

    // Unref'd: this timer is a backstop for a wedged worker, not a reason to keep the
    // process alive when every worker has already gone.
    const forced = setTimeout(() => process.exit(0), 10_000);
    forced.unref();

    let remaining = workers.length;
    for (const worker of workers) {
      worker.once("exit", () => {
        remaining -= 1;
        if (remaining === 0) {
          clearTimeout(forced);
          process.exit(0);
        }
      });
    }

    for (const worker of workers) worker.kill(signal);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (transportName === "http" || transportName === "streamable-http") {
  if (cluster.isPrimary) {
    startPrimary();
  } else {
    startWorker();
  }
} else {
  // stdio never forks. stdout is the JSON-RPC channel here, and a worker's copy of it
  // would corrupt the stream.
  const server = createServer({ version });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${SERVER_ID} ${version} serving over stdio\n`);
}
