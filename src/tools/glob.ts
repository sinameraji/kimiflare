import type { ToolSpec } from "./registry.js";
import { resolvePath, collapsePath } from "../util/paths.js";
import { globStream } from "../util/glob.js";

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
  render: (args) => ({ title: `glob ${args.pattern ?? ""}${args.path ? ` in ${collapsePath(String(args.path), process.cwd())}` : ""}` }),
  async run(args, ctx) {
    if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const root = args.path ? resolvePath(ctx.cwd, args.path) : ctx.cwd;
    // Stream results so a Ctrl+C during a recursive walk over a large
    // monorepo can interrupt promptly.
    const stream = globStream(args.pattern, {
      cwd: root,
      absolute: true,
      dot: false,
      onlyFiles: false,
      stats: true,
    });
    const entries: Array<{ path: string; stats?: { mtimeMs: number } }> = [];
    const onAbort = () => {
      try {
        stream.destroy(new DOMException("aborted", "AbortError"));
      } catch {
        /* already destroyed */
      }
    };
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const entry of stream) {
        if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
        entries.push(entry);
      }
    } finally {
      ctx.signal?.removeEventListener("abort", onAbort);
    }
    entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const paths = entries.slice(0, 200).map((e) => e.path);
    return paths.length ? paths.join("\n") : "(no matches)";
  },
};
