import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTENT_DIR } from "../src/version.js";
import { CONTENT_TOOLS, TOOL_FILES } from "../src/tools/from-content.js";
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

/** Every markdown file in the served set, as [path-relative-to-content, absolute]. */
async function markdownFiles(dir = CONTENT_DIR) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) {
      found.push([relative(CONTENT_DIR, full).split(sep).join("/"), full]);
    }
  }

  return found.sort(([a], [b]) => a.localeCompare(b));
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

test("the surface is the eleven tools the set derives", async () => {
  // Pinned by name, because the naming is a decision rather than an accident. The
  // long names are the honest consequence of naming a tool after the guide it
  // serves; a rename has to be made here on purpose, not inherited from a rule
  // change elsewhere.
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
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
    ]);
  });
});

test("the tool list and the files on disk are a bijection", async () => {
  // Both directions, because each catches a different mistake. Files-to-tools
  // catches a guide that was added and never surfaced; tools-to-files catches a
  // tool serving something that is no longer in the set. Together they are what
  // makes "add a guide, get a tool" a property rather than a hope.
  const files = (await markdownFiles()).map(([path]) => path);
  const served = [...TOOL_FILES.values()].sort((a, b) => a.localeCompare(b));

  assert.deepEqual(served, files);

  assert.equal(
    TOOL_FILES.size,
    files.length,
    "two files must not derive the same tool name"
  );
  assert.equal(files.length, 11, `expected the whole set, found ${files.length} files`);
});

test("every tool name is derived from its own filename", () => {
  // The derivation is the design: a guide's name is what a caller reads in the
  // tool list, so it has to survive the trip. Folder stripped, `.md` dropped,
  // kebab to snake.
  for (const [name, path] of TOOL_FILES) {
    const expected = path
      .split("/")
      .pop()
      .replace(/\.md$/, "")
      .toLowerCase()
      .replace(/-/g, "_");

    assert.equal(name, expected, `${path} derives ${name}, expected ${expected}`);
    assert.match(name, /^[a-z][a-z0-9_]{0,63}$/, `${name} is not a usable tool name`);
  }
});

test("every tool has a distinct name and a description to route on", () => {
  const names = CONTENT_TOOLS.map(({ config }) => config.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");

  for (const { config } of CONTENT_TOOLS) {
    assert.ok(
      config.description && config.description.length > 0,
      `${config.name} needs a description`
    );
  }
});

test("no tool takes an argument", async () => {
  // The structural claim, and the replacement for the traversal defence the old
  // path-taking tool needed. With no argument there is nothing to traverse with,
  // so this is not a weaker version of the old check - it is the check.
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.deepEqual(
        tool.inputSchema.properties ?? {},
        {},
        `${tool.name} must take no argument`
      );
      assert.deepEqual(
        tool.inputSchema.required ?? [],
        [],
        `${tool.name} must require nothing`
      );
    }
  });
});

test("every tool returns its own file, whole and with frontmatter", async () => {
  await withClient(async ({ client }) => {
    for (const [name, path] of TOOL_FILES) {
      const text = textOf(await client.callTool({ name, arguments: {} }));
      const onDisk = await readFile(join(CONTENT_DIR, path), "utf8");

      assert.equal(text, onDisk, `${name} must serve ${path} byte for byte`);

      // \r? because a checkout on Windows serves CRLF, and the bytes are served
      // as they are on disk.
      assert.match(text, /^---\r?\n/, `${name} must serve the frontmatter`);
      assert.ok(text.includes("name:"), `${name} must not strip the frontmatter`);
    }
  });
});

test("the whole set is served and nothing is served twice", async () => {
  // Served twice would mean a guide the set holds but a caller cannot reach by
  // name; served short would mean a guide silently dropped from the surface.
  await withClient(async ({ client }) => {
    let total = 0;
    for (const [name] of TOOL_FILES) {
      total += textOf(await client.callTool({ name, arguments: {} })).length;
    }

    let onDisk = 0;
    for (const [, full] of await markdownFiles()) {
      onDisk += (await readFile(full, "utf8")).length;
    }

    assert.equal(total, onDisk, "the tools must serve exactly the files on disk");
  });
});

test("the licence is not served as an instruction", async () => {
  // A licence is not a guide: it has no frontmatter to route on, and putting it in
  // the same list as the ten security guides would offer a caller a text it has no
  // reason to want. The old path-taking tool served it on request. The file stays
  // in the repository; only its serving is dropped, and this test is what stops a
  // later change quietly adding it back.
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.notEqual(TOOL_FILES.get(tool.name), "LICENSE.txt");
    }

    const names = tools.map((tool) => tool.name);
    assert.equal(names.includes("license"), false);
    assert.equal(names.includes("license_txt"), false);
  });
});

test("skill is the entry point and routes to the ten reference guides", async () => {
  // `skill` is the only document in the set that tells a caller how to find the
  // other ten, so its routing text is worth pinning rather than trusting.
  //
  // It routes by shape, not by name: it names the directory and the two filename
  // patterns the guides follow, and a caller matches a guide against them. The
  // routing property is therefore that every reference file matches a pattern
  // `skill` documents, which is asserted below. Note that `skill` does not
  // enumerate the ten filenames - see the task record for that and for why.
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();

    assert.ok(
      tools.map((tool) => tool.name).includes("skill"),
      "the entry point must be reachable by name"
    );

    const text = textOf(await client.callTool({ name: "skill", arguments: {} }));

    assert.match(text, /references directory/);
    assert.match(text, /`<language>-<framework>-<stack>-security\.md`/);
    assert.match(text, /`<language>-general-<stack>-security\.md`/);
    assert.match(text, /agnostic to the framework/);

    for (const [path] of await markdownFiles()) {
      if (path === "SKILL.md") continue;

      const base = path.split("/").pop();

      // `<language>-<framework>-<stack>-security.md`, or
      // `<language>-general-<stack>-security.md`. The stack is itself hyphenated,
      // so the shape is not a segment count - it is a documented suffix and a
      // documented leading language.
      assert.match(base, /^[a-z0-9]+(-[a-z0-9]+)*-security\.md$/, `${path} is not kebab-case`);
      assert.ok(
        ["python", "javascript", "golang"].includes(base.split("-")[0]),
        `${path} does not start with a language \`skill\` documents`
      );
    }
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
        name: "golang_general_backend_security",
        arguments: {},
      })
    );

    assert.ok(text.length > 1000, "the set is served without a key");
  });
});
