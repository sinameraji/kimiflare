import fg from "fast-glob";
import type { ToolSpec } from "./registry.js";
import { resolvePath, collapsePath } from "../util/paths.js";

interface Args {
  pattern: string;
  path?: string;
}

export const globTool: ToolSpec<Args> = {
  name: "glob",
  description:
    "Find files matching a glob pattern (e.g. `**/*.ts`). Returns up to 200 absolute paths, sorted by mtime descending.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, e.g. `src/**/*.ts`." },
      path: { type: "string", description: "Root directory. Defaults to cwd." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  needsPermission: false,
  render: (args) => ({ title: `glob ${args.pattern}${args.path ? ` in ${collapsePath(args.path, process.cwd())}` : ""}` }),
  async run(args, ctx) {
    const root = args.path ? resolvePath(ctx.cwd, args.path) : ctx.cwd;
    const entries = (await fg(args.pattern, {
      cwd: root,
      absolute: true,
      dot: false,
      onlyFiles: false,
      stats: true,
    })) as unknown as Array<{ path: string; stats?: { mtimeMs: number } }>;
    entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const paths = entries.slice(0, 200).map((e) => e.path);
    return paths.length ? paths.join("\n") : "(no matches)";
  },
};
