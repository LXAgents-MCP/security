import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer, request } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BODY_LIMIT_BYTES } from "../src/app.js";
import { SERVER_ID, createServer } from "../src/server.js";

/**
 * The Streamable HTTP transport, over a real socket.
 *
 * `test/server.test.js` exercises the server in memory: same code, no listener. What
 * that cannot reach is the part that only exists when there is a socket - the route
 * table, the transport's own framing, the host it binds, the shape of its errors, and
 * what a shutdown does to a request that is still in flight. This file is that half,
 * and it starts the real entry point as a real child process rather than importing it,
 * because an imported module cannot be given a second port or stopped.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * How long to wait for the startup line.
 *
 * A deadline rather than a sleep, so the common case costs nothing: the server is up in
 * well under a second on a normal filesystem. It is generous because a checkout on a
 * network or 9p mount - WSL's `/mnt/c`, a bind mount, a synced folder - can take several
 * seconds just to load the SDK, and a deadline that is too short fails a working server
 * for an environmental reason.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * A port nothing is listening on.
 *
 * Bound and immediately released, so two servers started in the same run do not collide.
 * There is a window between the release and the child's bind; it is small and it is the
 * same window any free-port helper has.
 */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/** Every child started by this file, so a failed assertion cannot leak one. */
const openServers = new Set();

after(() => {
  for (const child of openServers) child.kill("SIGKILL");
});

/**
 * Start `src/index.js` and wait until it is listening.
 *
 * Both streams are captured, because the startup line is on stderr and stdout must stay
 * empty on a server process - a line on stdout would be a defect worth failing on.
 *
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {Promise<{ child: import("node:child_process").ChildProcess, port: number,
 *   url: string, output: () => string, waitForOutput: (needle: string, ms?: number) => Promise<boolean> }>}
 */
async function startServer({ env = {} } = {}) {
  const port = await freePort();

  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MCP_TRANSPORT: "http",
      PORT: String(port),
      // Bound to loopback on purpose: this file must never open a port on every
      // interface of whatever machine runs the suite.
      HOST: "127.0.0.1",
      ...env,
    },
  });

  openServers.add(child);
  child.on("exit", () => openServers.delete(child));

  let captured = "";
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    captured += chunk;
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    captured += chunk;
    stderr += chunk;
  });

  /** Everything the process has written, on either stream. */
  const output = () => captured;

  /**
   * How many times `needle` has appeared so far.
   *
   * Not a boolean: with `MCP_CLUSTER_WORKERS=2` the line is printed once per worker, and
   * "the line appeared" cannot tell one worker from two. Counting it is how the suite
   * observes that a fork happened without adding a pid to a response body or a field to
   * a log line that existing tests pin.
   */
  const countOutput = (needle) => captured.split(needle).length - 1;

  /** Resolve true once `needle` has appeared, false if `ms` runs out first. */
  const waitForOutput = (needle, ms = READY_TIMEOUT_MS) =>
    new Promise((resolveWait) => {
      if (captured.includes(needle)) {
        resolveWait(true);
        return;
      }
      const deadline = Date.now() + ms;
      const poll = setInterval(() => {
        if (captured.includes(needle)) {
          clearInterval(poll);
          resolveWait(true);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          resolveWait(false);
        }
      }, 50);
    });

  /** Resolve true once `needle` has appeared `n` times, false if `ms` runs out first. */
  const waitForCount = (needle, n, ms = READY_TIMEOUT_MS) =>
    new Promise((resolveWait) => {
      if (countOutput(needle) >= n) {
        resolveWait(true);
        return;
      }
      const deadline = Date.now() + ms;
      const poll = setInterval(() => {
        if (countOutput(needle) >= n) {
          clearInterval(poll);
          resolveWait(true);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          resolveWait(false);
        }
      }, 50);
    });

  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  // Either the startup line arrives, or the process dies trying - whichever comes
  // first. A server that exited quietly is a failure to report with its own output
  // attached, not a server to test against.
  const ready = await Promise.race([
    waitForOutput("serving over http").then((ok) => ({ ok })),
    exited.then((exit) => ({ exit })),
  ]);

  if (ready.exit || !ready.ok) {
    const how = ready.exit
      ? `it exited with code ${ready.exit.code} and signal ${ready.exit.signal}`
      : `it printed no startup line within ${READY_TIMEOUT_MS}ms`;
    throw new Error(`the server never came up: ${how}.\n--- output ---\n${captured}`);
  }

  return {
    child,
    port,
    url: `http://127.0.0.1:${port}`,
    output,
    countOutput,
    stdout: () => stdout,
    stderr: () => stderr,
    waitForOutput,
    waitForCount,
  };
}

/**
 * Start a server, hand it to `run`, and stop it afterwards whether or not `run` throws.
 *
 * @param {object} options
 * @param {(server: Awaited<ReturnType<typeof startServer>>) => Promise<void>} run
 */
async function withServer(options, run) {
  const server = await startServer(options);
  try {
    return await run(server);
  } finally {
    server.child.kill("SIGKILL");
  }
}

/**
 * Connect an MCP client to a running server over a real socket.
 *
 * @param {string} url
 */
async function connect(url) {
  const client = new Client({ name: "http-test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  return client;
}

/** The text of a single-content tool result. */
function textOf(result) {
  assert.notEqual(result.isError, true, "expected a successful result");
  assert.equal(result.content.length, 1, "expected exactly one content block");
  return result.content[0].text;
}

/** An in-memory client, the reference the socket client is compared against. */
async function inMemoryClient() {
  const server = createServer({ version: "0.0.0" });
  const client = new Client({ name: "in-memory-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("the health check answers without a session", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/healthz`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.server, SERVER_ID);
    assert.match(body.version, /^\d+\.\d+\.\d+/);
  });
});

test("the startup line names the interface it bound", async () => {
  await withServer({}, async ({ output }) => {
    // The harness binds loopback, so the line has to say loopback. It is the only
    // place the process reports what it actually bound rather than what it was asked
    // to bind, and a container operator reads it first.
    assert.match(output(), /serving over http on :\d+\/mcp \(127\.0\.0\.1\)/);
  });
});

test("a server process writes nothing to stdout", async () => {
  // The transport is selected here, so stdout is not the JSON-RPC channel - but the
  // rule is repository-wide, and the assertion is cheap: a log line that drifts onto
  // stdout is a bug that only shows up when someone switches back to stdio.
  await withServer({}, async ({ url, stdout, stderr }) => {
    const client = await connect(url);

    try {
      await client.listTools();
      textOf(await client.callTool({ name: "skill", arguments: {} }));
    } finally {
      await client.close();
    }

    assert.equal(stdout(), "", `stdout must stay empty, got: ${stdout()}`);
    assert.ok(stderr().length > 0, "the startup line went to stderr");
  });
});

test("the HTTP transport serves the same tools as stdio", async () => {
  await withServer({}, async ({ url }) => {
    const http = await connect(url);
    const memory = await inMemoryClient();

    try {
      const viaHttp = (await http.listTools()).tools;
      const inMemory = (await memory.client.listTools()).tools;

      assert.equal(viaHttp.length, 11, "one tool per file in the set");
      assert.deepEqual(
        viaHttp.map((tool) => tool.name).sort(),
        inMemory.map((tool) => tool.name).sort()
      );
      assert.deepEqual(
        viaHttp.map((tool) => tool.description).sort(),
        inMemory.map((tool) => tool.description).sort()
      );
    } finally {
      await http.close();
      await memory.close();
    }
  });
});

test("no tool advertises an argument over HTTP either", async () => {
  // The read-only claim does not depend on the transport. Over stdio a tool takes
  // no argument; over HTTP it must take none either, or a deployment would have a
  // second door onto whatever a socket opens that a pipe does not.
  await withServer({}, async ({ url }) => {
    const client = await connect(url);

    try {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        assert.deepEqual(
          tool.inputSchema.properties ?? {},
          {},
          `${tool.name} must take no argument over HTTP`
        );
        assert.deepEqual(tool.inputSchema.required ?? [], []);
      }
    } finally {
      await client.close();
    }
  });
});

test("a tool call over HTTP returns the file byte-identically", async () => {
  await withServer({}, async ({ url }) => {
    const client = await connect(url);

    try {
      const text = textOf(
        await client.callTool({
          name: "python_flask_web_server_security",
          arguments: {},
        })
      );

      // \r? because a checkout on Windows serves CRLF, and the bytes are served as
      // they are on disk. The same tolerance is in test/server.test.js.
      assert.match(text, /^---\r?\n/, "frontmatter is part of the served text");
      assert.ok(text.length > 1000, "the guide came back empty or truncated");
    } finally {
      await client.close();
    }
  });
});

test("the server's own source and manifest are unreachable over HTTP", async () => {
  // There is no `path` argument to aim at them, and no tool that reads anything but
  // its own file. That is the whole defence, so it is asserted as a fact about the
  // surface rather than as a set of payloads that a handler happens to refuse: a
  // container copies `src/` and `content/` side by side, so the server's own source
  // and its manifest are the nearest neighbours of the set.
  await withServer({}, async ({ url }) => {
    const client = await connect(url);

    try {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        assert.deepEqual(
          Object.keys(tool.inputSchema.properties ?? {}),
          [],
          `${tool.name} must take no argument to aim with`
        );
      }

      // And nothing outside the set is registered: a tool serving `package.json` or
      // `src/server.js` would be a door the generator does not open.
      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        [
          "golang_general_backend_security",
          "javascript_express_web_server_security",
          "javascript_general_web_frontend_security",
          "javascript_jquery_web_frontend_security",
          "javascript_typescript_nextjs_web_server_security",
          "javascript_typescript_react_web_frontend_security",
          "javascript_typescript_vue_web_frontend_security",
          "python_django_web_server_security",
          "python_fastapi_web_server_security",
          "python_flask_web_server_security",
          "skill",
        ]
      );
    } finally {
      await client.close();
    }
  });
});

test("an unknown route says what this server does not serve", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/nope`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.match(body.error.message, /Not found: \/nope/);
  });
});

test("GET /mcp is refused rather than served", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`);

    assert.equal(response.status, 405);
    assert.match((await response.json()).error.message, /stateless mode/);
  });
});

test("concurrent requests do not share state", async () => {
  await withServer({}, async ({ url }) => {
    const tools = [
      "skill",
      "golang_general_backend_security",
      "javascript_express_web_server_security",
    ];

    // The transport builds a fresh McpServer per request, so three clients answering
    // three different files at once is the assertion that matters. Interleaved calls
    // on one client would pass against a shared server too.
    const clients = await Promise.all([connect(url), connect(url), connect(url)]);

    try {
      const texts = await Promise.all(
        clients.map((client, i) => client.callTool({ name: tools[i], arguments: {} }))
      );

      for (const [i, result] of texts.entries()) {
        assert.ok(
          textOf(result).length > 500,
          `${tools[i]} came back empty - a request answered with another's file`
        );
      }

      // The first client still works after the other two have been talking.
      assert.ok(textOf(
        await clients[0].callTool({ name: "skill", arguments: {} })
      ).length > 0);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  });
});

test(
  "a shutdown drains and stops accepting, rather than dropping a listener",
  // Windows has no signal delivery: child.kill() terminates the process outright, so a
  // handler cannot be observed there at all. The assertion is about the shutdown path,
  // and pretending it passed on a platform that never ran it would be worse than
  // skipping it.
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer({}, async ({ child, url, output }) => {
      const exited = new Promise((resolveExit) =>
        child.once("exit", (code, signal) => resolveExit({ code, signal }))
      );
      child.kill("SIGINT");

      const { code, signal } = await exited;

      // A handled SIGINT ends in `process.exit(0)`, so the process is gone by its own
      // decision. An unhandled one would report the signal instead, with code null.
      assert.equal(code, 0, `the handler did not run: signal ${signal}`);
      assert.match(output(), /SIGINT, draining/);

      // And it really is closed: a request after the drain is refused, not queued.
      await assert.rejects(fetch(`${url}/healthz`), "the port is no longer served");
    });
  }
);

/**
 * A request with a `Host` header of our choosing.
 *
 * `fetch` cannot do this. `Host` is a forbidden header name in the fetch spec, and a
 * client that silently drops it sends the loopback name every time - so a test written
 * with `fetch` would exercise the allow-list and conclude whatever the real control
 * does, which is the worst way to test a security control.
 *
 * @param {{ url: string, host: string, path?: string }} options
 * @returns {Promise<{ status: number, body: string }>}
 */
function requestWithHost({ url, host, path = "/healthz" }) {
  const target = new URL(path, url);

  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "GET",
        headers: { Host: host },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolveRequest({ status: res.statusCode, body }));
      }
    );

    req.on("error", rejectRequest);
    req.end();
  });
}

test("with no allow-list set, nothing is refused", async () => {
  await withServer({}, async ({ url }) => {
    // The default, and the one the plan calls the safe-looking-unsafe one. It is
    // asserted explicitly so that a future change to refuse-by-default has to
    // contradict a test rather than pass quietly.
    for (const host of ["example.test", "evil.test", "127.0.0.1"]) {
      const { status } = await requestWithHost({ url, host });
      assert.equal(status, 200, `${host} must be served when no allow-list is set`);
    }
  });
});

test("the startup line announces that no allow-list is applied", async () => {
  await withServer({}, async ({ output }) => {
    assert.match(output(), /MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied/);
  });
});

test("the allow-list is applied when MCP_ALLOWED_HOSTS is set", async () => {
  const allowed = "security.example.test, other.example.test";

  await withServer({ env: { MCP_ALLOWED_HOSTS: allowed } }, async ({ url, port }) => {
    assert.equal((await requestWithHost({ url, host: "security.example.test" })).status, 200);
    assert.equal((await requestWithHost({ url, host: "other.example.test" })).status, 200);

    // The refusal, and its shape: a 403 carrying a JSON-RPC error, not a 404 and not
    // a dropped connection.
    const refused = await requestWithHost({ url, host: "evil.test" });
    assert.equal(refused.status, 403);
    assert.match(JSON.parse(refused.body).error.message, /Invalid Host: evil\.test/);

    // The port is not part of the match. A client that reaches the server through a
    // proxy sends `host:port`, and an allow-list that matched the whole header would
    // refuse it while looking correct in a test that used the bare name.
    assert.equal(
      (await requestWithHost({ url, host: `security.example.test:${port}` })).status,
      200
    );
  });
});

test("the allow-list guards the health check too", async () => {
  // Otherwise a deployment could watch its own server through /healthz while every
  // real caller was refused - a green check on a service nothing can reach.
  await withServer({ env: { MCP_ALLOWED_HOSTS: "security.example.test" } }, async ({ url }) => {
    assert.equal((await requestWithHost({ url, host: "evil.test" })).status, 403);
    assert.equal((await requestWithHost({ url, host: "security.example.test" })).status, 200);
  });
});

test("setting MCP_ALLOWED_HOSTS silences the warning, so neither can pass by accident", async () => {
  await withServer({ env: { MCP_ALLOWED_HOSTS: "security.example.test" } }, async ({ output }) => {
    assert.doesNotMatch(output(), /MCP_ALLOWED_HOSTS is unset/);
    // The list that is applied is the one that was set, not a fallback.
    assert.doesNotMatch(output(), /no Host header allow-list is applied/);
  });
});

test("an allow-list of nothing but separators still counts as unset", async () => {
  // `MCP_ALLOWED_HOSTS=` is a shell that lost the value, and `MCP_ALLOWED_HOSTS= , ,`
  // is a paste that did. Treating either as "allow nothing" would refuse every request
  // with a message that names no host at all.
  await withServer({ env: { MCP_ALLOWED_HOSTS: " , , " } }, async ({ url, output }) => {
    assert.equal((await requestWithHost({ url, host: "anything.test" })).status, 200);
    assert.match(output(), /MCP_ALLOWED_HOSTS is unset/);
  });
});

/* -------------------------------------------------------------------------- *
 * The body limit, and the framework it replaced.
 * -------------------------------------------------------------------------- */

test("the body limit is the 4 MB it was before express", () => {
  // Pinned as a number, not just as a relation to whatever the constant now says. A
  // limit that quietly became 64 MB would keep every boundary test in this file
  // passing, and the number is a documented property of the transport rather than an
  // implementation detail.
  assert.equal(BODY_LIMIT_BYTES, 4 * 1024 * 1024);
});

test("a body over the limit is refused, and says so in the JSON-RPC envelope", async () => {
  await withServer({}, async ({ url }) => {
    // Valid JSON, valid MCP, simply too large: the only thing wrong with it is its
    // size, so a refusal here is the limit and not a parse failure.
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "skill", arguments: {}, padding: "x".repeat(BODY_LIMIT_BYTES) },
    });
    assert.ok(oversized.length > BODY_LIMIT_BYTES, "the payload must actually exceed the limit");

    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.error.code, -32700);
  });
});

test("malformed JSON is refused with exactly the same answer as a body that is too large", async () => {
  // Not tidiness. The hand-rolled reader this replaced threw one failure for both
  // cases, so a client that learned to expect 400/-32700 on a malformed body was
  // never taught anything different for an oversized one. Collapsing them keeps that
  // promise; splitting them would be a behaviour change nobody asked for.
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not json",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32700);
    assert.equal(body.error.message, "Parse error: request body is not valid JSON");
  });
});

test("no response advertises that the server is running express", async () => {
  await withServer({}, async ({ url }) => {
    // Checked on a served route and on the catch-all, because the 404 is produced by
    // middleware rather than by a route and could plausibly have taken a different
    // path through the stack. `X-Powered-By` hands an unauthenticated caller the
    // framework and its version, which is a free upgrade suggestion.
    const health = await fetch(`${url}/healthz`);
    const missing = await fetch(`${url}/nope`);
    const refused = await fetch(`${url}/mcp`);

    for (const response of [health, missing, refused]) {
      assert.equal(
        response.headers.get("x-powered-by"),
        null,
        `X-Powered-By leaked on ${response.url}`
      );
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The workers.
 * -------------------------------------------------------------------------- */

test("MCP_CLUSTER_WORKERS=1 forks nothing and serves on its own", async () => {
  await withServer({ env: { MCP_CLUSTER_WORKERS: "1" } }, async ({ output, countOutput, url }) => {
    assert.match(output(), /MCP_CLUSTER_WORKERS is 1, so no worker is forked/);
    assert.doesNotMatch(output(), /forking \d+ HTTP workers/);
    assert.equal(countOutput("serving over http"), 1, "one process, one startup line");

    // Still a working server: disabling the fork must not disable the transport.
    const client = await connect(url);
    try {
      assert.ok((await client.listTools()).tools.length > 0);
    } finally {
      await client.close();
    }
  });
});

test("MCP_CLUSTER_WORKERS=2 binds the port from two separate workers", async () => {
  await withServer({ env: { MCP_CLUSTER_WORKERS: "2" } }, async ({ output, countOutput, waitForCount, url }) => {
    assert.match(output(), /forking 2 HTTP workers on :\d+\/mcp/);

    // Two startup lines means two processes each bound the port - which only happens
    // through the cluster's shared handle, because two independent `listen` calls on
    // one port would be EADDRINUSE. This is the assertion that the fork is real.
    assert.ok(
      await waitForCount("serving over http", 2),
      `expected two workers to bind, saw ${countOutput("serving over http")}\n--- output ---\n${output()}`
    );

    // And both are answering: enough concurrent requests to outlast a single-process
    // server's accept loop, each on its own connection.
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => fetch(`${url}/healthz`))
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).server, SERVER_ID);
    }
  });
});

test("concurrent tool calls stay isolated when they cross a process boundary", async () => {
  // The property `cluster` can plausibly break. Each request builds its own McpServer
  // in whichever worker wins the connection, so three callers asking for three
  // different files must each get their own - and the workers are separate processes,
  // so a module-level cache that happened to work in one process would have to hold
  // in two of them to pass.
  await withServer({ env: { MCP_CLUSTER_WORKERS: "2" } }, async ({ waitForCount, url }) => {
    assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

    const tools = [
      "python_flask_web_server_security",
      "javascript_express_web_server_security",
      "golang_general_backend_security",
    ];
    const clients = await Promise.all(tools.map(() => connect(url)));

    try {
      const texts = await Promise.all(
        clients.map((client, i) => client.callTool({ name: tools[i], arguments: {} }))
      );

      for (const [i, result] of texts.entries()) {
        const text = textOf(result);
        assert.ok(text.length > 500, `${tools[i]} came back empty`);
        // The file's own name is in its frontmatter, so this distinguishes "answered
        // with the right file" from "answered with some file". Tool names are derived
        // from filenames by replacing hyphens with underscores, so the served text
        // carries the hyphenated form - that derivation is what is being inverted here.
        const ownName = tools[i].replace(/_/g, "-");
        assert.ok(
          text.includes(`name: ${ownName}`),
          `${tools[i]} was answered with another request's file`
        );
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  });
});

test(
  "no worker outlives a primary that was killed outright",
  // The failure this catches does not show up in this run. A worker whose primary is
  // gone keeps the port and keeps answering, so the suite passes, and then the *next*
  // run fails on EADDRINUSE against a process nobody remembers starting. `after()`
  // kills the primary with SIGKILL on every failing run, so without the `disconnect`
  // handler this file would leak two processes per failed run.
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    const { child, port, url, waitForCount } = await startServer({
      env: { MCP_CLUSTER_WORKERS: "2" },
    });

    try {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));

      // SIGKILL cannot be caught, handled, or forwarded. The primary leaves instantly
      // and the workers are told only through the IPC channel that closes with it.
      child.kill("SIGKILL");
      await exited;

      // A worker takes a moment to notice the disconnect and exit. The generous
      // window is the point: a check that ran immediately would pass even when the
      // handler is missing, because the orphan has not finished dying yet.
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));

      // The proof, in two parts. The port stops answering...
      await assert.rejects(
        fetch(`${url}/healthz`),
        `the port is still served after the primary died - port ${port} has an orphan`
      );
      // ...and it is genuinely free, which a request that merely timed out would not
      // show: something else can bind it again.
      const rebound = createNetServer();
      try {
        await new Promise((resolveBind, rejectBind) => {
          rebound.on("error", rejectBind);
          rebound.listen(port, "127.0.0.1", resolveBind);
        });
      } finally {
        await new Promise((resolveClose) => rebound.close(resolveClose));
      }
    } finally {
      child.kill("SIGKILL");
    }
  }
);

test(
  "the cluster drains on SIGINT and exits 0",
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer({ env: { MCP_CLUSTER_WORKERS: "2" } }, async ({ child, output, waitForCount }) => {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const exited = new Promise((resolveExit) =>
        child.once("exit", (code, signal) => resolveExit({ code, signal }))
      );
      child.kill("SIGINT");
      const { code, signal } = await exited;

      assert.equal(code, 0, `the primary did not exit cleanly: signal ${signal}`);
      // The primary says it is draining its workers, and each worker says it is
      // draining itself. Both lines, because the primary relays the signal rather
      // than killing its workers outright - a worker killed mid-request would drop a
      // response the client is still reading.
      assert.match(output(), /SIGINT, draining 2 worker\(s\)/);
      assert.equal(
        output().split("SIGINT, draining\n").length - 1,
        2,
        "both workers should report their own drain"
      );
    });
  }
);

test(
  "a second signal stops the wait rather than queueing behind the first",
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer({ env: { MCP_CLUSTER_WORKERS: "2" } }, async ({ child, output, waitForCount }) => {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const exited = new Promise((resolveExit) =>
        child.once("exit", (code) => resolveExit({ code }))
      );

      child.kill("SIGINT");
      child.kill("SIGINT");

      const { code } = await exited;
      assert.equal(code, 0);

      // What is asserted is the *observable* half of the early-exit path: the drain
      // line is written once. A second signal that fell through to the full drain
      // would print it again, and the guarded flag in `startPrimary` is what stops
      // that. The suite cannot force a worker to be slow enough to make the second
      // signal land mid-drain, so the timing the branch exists for - an operator who
      // has stopped waiting - is not exercised here.
      assert.equal(output().split("SIGINT, draining ").length - 1, 1);
    });
  }
);

test("stdio forks nothing, because a worker's stdout would corrupt the stream", async () => {
  // Not observable through `startServer`, which waits for an HTTP startup line that
  // stdio never prints. Driven through the SDK's own stdio client instead, so this is
  // the real entry point over a real pipe - the assertion is that the tool list comes
  // back intact, not that a log happens to be quiet.
  const client = new Client({ name: "stdio-cluster-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"],
    cwd: ROOT,
    env: { ...process.env, MCP_TRANSPORT: "stdio" },
    stderr: "pipe",
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.equal(tools.length, 11, "one tool per file in the set");
    assert.ok(textOf(await client.callTool({ name: "skill", arguments: {} })).length > 0);

    // The fork is the thing being ruled out, so it is asserted rather than assumed.
    // The handshake above already implies it - a forked worker writing its startup
    // line to the inherited stdout would have corrupted the stream before the
    // initialize response arrived.
    assert.match(stderr, /serving over stdio/);
    assert.doesNotMatch(stderr, /forking \d+ HTTP workers/);
  } finally {
    await client.close();
  }
});

test(
  "a worker that dies is replaced, and the server keeps serving",
  // The suite knows the primary's pid — it spawned it — but not its workers' pids: the
  // startup line is pinned by other tests and adding a pid to it, or to the health
  // check, would change a surface this task was not asked to change. So the pids are
  // read from the kernel instead, which is the one source that knows them and is Linux
  // only. Elsewhere this stays unchecked rather than being asserted by a weaker proxy.
  { skip: process.platform === "linux" ? false : "worker pids are read from /proc" },
  async () => {
    const { readFile } = await import("node:fs/promises");

    /**
     * The direct children of `pid`, from `/proc`.
     *
     * `children` lives under the thread directory rather than the process one, which
     * is the shape the kernel has and the shape every tool on Linux expects.
     */
    const childrenOf = async (pid) => {
      const listed = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
      return listed.split(/\s+/).filter(Boolean).map(Number);
    };

    await withServer({ env: { MCP_CLUSTER_WORKERS: "2" } }, async ({ child, output, waitForCount, waitForOutput, url }) => {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const workers = await childrenOf(child.pid);
      assert.equal(workers.length, 2, `expected two workers, found ${workers.join(", ")}`);

      // `process.kill`, not `child.kill`: the latter takes a signal and nothing else,
      // so passing a pid as a second argument silently kills the *primary* instead —
      // which looks like a server that ignores its workers dying.
      process.kill(workers[0], "SIGKILL");

      // The replacement is a new pid, not the old one coming back, and the primary
      // says so out loud rather than silently refilling the pool.
      assert.ok(
        await waitForOutput(`worker ${workers[0]} exited`),
        `the primary did not report the death\n--- output ---\n${output()}`
      );

      assert.ok(
        await waitForCount("serving over http", 3),
        "the replacement did not bind the port"
      );

      const after = await childrenOf(child.pid);
      assert.equal(after.length, 2, "the pool is back to two");
      assert.ok(!after.includes(workers[0]), "a dead pid is not back");
      assert.ok(after.includes(workers[1]), "the surviving worker was left alone");

      // And the server is still answering, on the pool it has now.
      assert.equal((await fetch(`${url}/healthz`)).status, 200);
    });
  }
);
