import { z } from "zod";
import { readSetFile } from "../content.js";

/*
 * The one tool. It serves the global security set and reaches nothing else -
 * no network, no key, no external service.
 */

export const config = {
  name: "security_instruction",
  description:
    "Read one security guide from the global security set by path, e.g. 'references/python-flask-web-server-security.md'. Covers python, javascript/typescript, and go. Read-only - this tool cannot write.",
  schema: {
    path: z
      .string()
      .describe(
        "Path inside the set, e.g. 'references/python-django-web-server-security.md' or 'SKILL.md'. Never a leading slash, never '..'.",
      ),
  },
};

export async function handler({ path }) {
  const text = await readSetFile(path);

  if (text === null) {
    // A lookup miss, not a server fault, so it is ordinary content rather than a
    // thrown error. A caller cannot tell a returned error apart from a real
    // answer, and this is not a real answer.
    return {
      content: [
        {
          type: "text",
          text: `not found: ${path}\n\nPaths are relative to the set root. Read 'SKILL.md' first - it names the language and framework workflow, and routes to the ten reference files under 'references/'.`,
        },
      ],
    };
  }

  return { content: [{ type: "text", text }] };
}

export default { config, handler };
