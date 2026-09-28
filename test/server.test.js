import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SERVER_ID, createServer, listTools } from "../src/server.js";

/**
 * Connect an in-memory client to a fresh server and hand both to `run`,
 * closing them afterwards whether or not `run` throws.
 */
async function withClient(run) {
  const server = createServer({ version: "0.0.0" });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return await run({ client, server });
  } finally {
    await client.close();
    await server.close();
  }
}

/** The text of a single-content tool result. */
function textOf(result) {
  assert.notEqual(result.isError, true, "expected a successful result");
  assert.equal(result.content.length, 1, "expected exactly one content block");
  return result.content[0].text;
}

test("the CLI list and the MCP tool list agree", async () => {
  await withClient(async ({ client }) => {
    assert.equal(client.getServerVersion().name, SERVER_ID);

    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      listTools().map((tool) => tool.name).sort()
    );

    const described = new Map(listTools().map((tool) => [tool.name, tool.description]));
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} needs a description`);
      assert.equal(tool.description, described.get(tool.name));
    }
  });
});

test("security_instruction is the only tool", async () => {
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    assert.deepEqual(tools.map((tool) => tool.name), ["security_instruction"]);
  });
});

test("security_instruction advertises the path it takes", async () => {
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();
    const tool = tools[0];

    assert.deepEqual(Object.keys(tool.inputSchema.properties), ["path"]);
    assert.equal(tool.inputSchema.properties.path.type, "string");
    assert.deepEqual(tool.inputSchema.required, ["path"]);
  });
});

test("security_instruction returns a guide from the set", async () => {
  await withClient(async ({ client }) => {
    const text = textOf(
      await client.callTool({
        name: "security_instruction",
        arguments: { path: "references/python-flask-web-server-security.md" },
      })
    );

    // \r? because a checkout on Windows serves CRLF, and the bytes are served
    // as they are on disk.
    assert.match(text, /^---\r?\n/, "frontmatter is part of the served text");
    assert.ok(text.includes("name:"), "frontmatter is not stripped");
  });
});

test("SKILL.md is reachable and routes to the references", async () => {
  await withClient(async ({ client }) => {
    const text = textOf(
      await client.callTool({
        name: "security_instruction",
        arguments: { path: "SKILL.md" },
      })
    );

    assert.match(text, /references directory/);
  });
});

test("all ten language and framework guides are served", async () => {
  const guides = [
    "golang-general-backend-security.md",
    "javascript-express-web-server-security.md",
    "javascript-general-web-frontend-security.md",
    "javascript-jquery-web-frontend-security.md",
    "javascript-typescript-nextjs-web-server-security.md",
    "javascript-typescript-react-web-frontend-security.md",
    "javascript-typescript-vue-web-frontend-security.md",
    "python-django-web-server-security.md",
    "python-fastapi-web-server-security.md",
    "python-flask-web-server-security.md",
  ];

  await withClient(async ({ client }) => {
    for (const guide of guides) {
      const text = textOf(
        await client.callTool({
          name: "security_instruction",
          arguments: { path: `references/${guide}` },
        })
      );
      assert.ok(text.length > 1000, `${guide} came back empty or truncated`);
    }
  });
});

test("a traversal attempt reports not found and leaks nothing", async () => {
  await withClient(async ({ client }) => {
    for (const path of [
      "../../package.json",
      "../../../.git/config",
      "references/../../package.json",
      "/etc/passwd",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
    ]) {
      const text = textOf(
        await client.callTool({ name: "security_instruction", arguments: { path } })
      );

      assert.match(text, /^not found:/, `${path} must be refused`);
      assert.doesNotMatch(text, /"name":/, `${path} must leak nothing`);
      assert.doesNotMatch(text, /\[core\]/, `${path} must leak nothing`);
    }
  });
});

test("an unknown path inside the set reports not found", async () => {
  await withClient(async ({ client }) => {
    const text = textOf(
      await client.callTool({
        name: "security_instruction",
        arguments: { path: "references/rust-axum-web-server-security.md" },
      })
    );

    assert.match(text, /^not found: references\/rust-axum-web-server-security\.md/);
  });
});

test("the set root itself is not a file", async () => {
  await withClient(async ({ client }) => {
    const text = textOf(
      await client.callTool({ name: "security_instruction", arguments: { path: "." } })
    );

    assert.match(text, /^not found:/);
  });
});

test("no tool accepts a write verb", async () => {
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const name of ["action", "verb", "operation", "command", "body", "content"]) {
        assert.equal(
          properties.includes(name),
          false,
          `${tool.name} must not accept ${name}`
        );
      }
    }
  });
});

test("no tool accepts a credential", async () => {
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const name of ["apiKey", "api_key", "token", "secret", "password"]) {
        assert.equal(
          properties.includes(name),
          false,
          `${tool.name} must not accept ${name}`
        );
      }
    }
  });
});

test("the server reads no credential and needs no key to answer", async () => {
  delete process.env.API_KEY;

  await withClient(async ({ client }) => {
    const text = textOf(
      await client.callTool({
        name: "security_instruction",
        arguments: { path: "references/golang-general-backend-security.md" },
      })
    );

    assert.ok(text.length > 1000, "the set is served without a key");
  });
});
