import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
    stdout: () => stdout,
    stderr: () => stderr,
    waitForOutput,
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
      textOf(
        await client.callTool({
          name: "security_instruction",
          arguments: { path: "SKILL.md" },
        })
      );
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

      assert.equal(viaHttp.length, 1, "one tool: security_instruction");
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

test("security_instruction advertises the path it takes over HTTP too", async () => {
  await withServer({}, async ({ url }) => {
    const client = await connect(url);

    try {
      const { tools } = await client.listTools();
      const tool = tools[0];

      assert.deepEqual(Object.keys(tool.inputSchema.properties), ["path"]);
      assert.equal(tool.inputSchema.properties.path.type, "string");
      assert.deepEqual(tool.inputSchema.required, ["path"]);
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
          name: "security_instruction",
          arguments: { path: "references/python-flask-web-server-security.md" },
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

test("a traversal attempt over HTTP reports not found and leaks nothing", async () => {
  // The first five are the paths test/server.test.js already pins. The last three are
  // the ones a *container* makes reachable: the image sets WORKDIR /srv and copies
  // src/ and content/ side by side, so the server's own source and manifest are the
  // nearest neighbours of the set. The defence in src/content.js has never been tested
  // against the filesystem it is deployed onto.
  const hostile = [
    "../../package.json",
    "../../../.git/config",
    "references/../../package.json",
    "/etc/passwd",
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
    "../../src/content.js",
    "../../src/server.js",
    "../../package-lock.json",
  ];

  await withServer({}, async ({ url }) => {
    const client = await connect(url);

    try {
      for (const path of hostile) {
        const text = textOf(
          await client.callTool({ name: "security_instruction", arguments: { path } })
        );

        assert.match(text, /^not found:/, `${path} must be refused`);
        assert.doesNotMatch(text, /"name":/, `${path} must leak nothing`);
        assert.doesNotMatch(text, /\[core\]/, `${path} must leak nothing`);
        assert.doesNotMatch(text, /CONTENT_DIR/, `${path} must leak no source`);
      }
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
    const paths = [
      "SKILL.md",
      "references/golang-general-backend-security.md",
      "references/javascript-express-web-server-security.md",
    ];

    // The transport builds a fresh McpServer per request, so three clients answering
    // three different files at once is the assertion that matters. Interleaved calls
    // on one client would pass against a shared server too.
    const clients = await Promise.all([connect(url), connect(url), connect(url)]);

    try {
      const texts = await Promise.all(
        clients.map((client, i) =>
          client.callTool({ name: "security_instruction", arguments: { path: paths[i] } })
        )
      );

      for (const [i, result] of texts.entries()) {
        assert.ok(
          textOf(result).length > 500,
          `${paths[i]} came back empty - a request answered with another's file`
        );
      }

      // The first client still works after the other two have been talking.
      assert.ok(textOf(
        await clients[0].callTool({ name: "security_instruction", arguments: { path: "SKILL.md" } })
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
