import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolSpec } from "./registry.js";
import { resolvePath, collapsePath } from "../util/paths.js";

interface Args {
  path: string;
  content: string;
}

export const writeTool: ToolSpec<Args> = {
  name: "write",
  description:
    "Create a file or overwrite an existing one with the given contents. Prompts the user for permission first and shows a diff preview.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  needsPermission: true,
  render: (args) => ({
    title: `write ${collapsePath(args.path, process.cwd())} (${args.content.length} chars)`,
    diff: { path: args.path, before: "", after: args.content },
  }),
  async run(args, ctx) {
    const abs = resolvePath(ctx.cwd, args.path);
    let before = "";
    try {
      before = await readFile(abs, "utf8");
    } catch {
      /* new file */
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, args.content, "utf8");
    const verb = before ? "Overwrote" : "Created";
    return `${verb} ${args.path} (${args.content.length} chars).`;
  },
};
