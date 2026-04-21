import { readFile, writeFile } from "node:fs/promises";
import type { ToolSpec } from "./registry.js";
import { resolvePath, collapsePath } from "../util/paths.js";

interface Args {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const editTool: ToolSpec<Args> = {
  name: "edit",
  description:
    "Replace an exact string in a file. If replace_all is false (default), the old_string must appear exactly once or the call fails. Prompts the user for permission first and shows a diff preview.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "Exact text to replace." },
      new_string: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean", default: false },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  needsPermission: true,
  render: (args) => ({
    title: `edit ${collapsePath(args.path, process.cwd())}${args.replace_all ? " (replace_all)" : ""}`,
    diff: { path: args.path, before: args.old_string, after: args.new_string },
  }),
  async run(args, ctx) {
    const abs = resolvePath(ctx.cwd, args.path);
    const orig = await readFile(abs, "utf8");
    const occurrences = countOccurrences(orig, args.old_string);
    if (occurrences === 0) throw new Error(`old_string not found in ${args.path}`);
    if (occurrences > 1 && !args.replace_all) {
      throw new Error(
        `old_string appears ${occurrences} times in ${args.path}; pass replace_all=true or include more surrounding context`,
      );
    }
    const next = args.replace_all
      ? orig.split(args.old_string).join(args.new_string)
      : orig.replace(args.old_string, args.new_string);
    await writeFile(abs, next, "utf8");
    return `Replaced ${occurrences} occurrence(s) in ${args.path}.`;
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return count;
    count++;
    from = i + needle.length;
  }
}
