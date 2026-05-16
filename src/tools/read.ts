import { readFile, stat } from "node:fs/promises";
import type { ToolSpec } from "./registry.js";
import { resolvePath, collapsePath } from "../util/paths.js";

const MAX_BYTES = 2 * 1024 * 1024;

interface Args {
  path: string;
  offset?: number;
  limit?: number;
}

export const readTool: ToolSpec<Args> = {
  name: "read",
  description:
    "Read a text file from the local filesystem. Supports optional line offset/limit. Refuses files larger than 2MB. Returns contents with 1-indexed line numbers prefixed, cat -n style. When reading a full file without offset/limit, the output is reduced to a compact outline (imports, exports, signatures, preview) by default; use expand_artifact to retrieve the full content or specify offset/limit for a targeted slice.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file. Absolute or relative to cwd." },
      offset: { type: "integer", description: "1-indexed line number to start reading from.", minimum: 1 },
      limit: { type: "integer", description: "Maximum number of lines to return.", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  needsPermission: false,
  render: ({ path }) => ({ title: `read ${collapsePath(path, process.cwd())}` }),
  async run(args, ctx) {
    if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const abs = resolvePath(ctx.cwd, args.path);
    const st = await stat(abs);
    if (st.size > MAX_BYTES) throw new Error(`file too large: ${st.size} bytes (max ${MAX_BYTES})`);
    if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const text = await readFile(abs, { encoding: "utf8", signal: ctx.signal });
    if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const lines = text.split("\n");
    const start = Math.max(0, (args.offset ?? 1) - 1);
    const end = args.limit ? Math.min(lines.length, start + args.limit) : lines.length;
    const width = String(end).length;
    return lines
      .slice(start, end)
      .map((l, i) => `${String(start + i + 1).padStart(width, " ")}\t${l}`)
      .join("\n");
  },
};
