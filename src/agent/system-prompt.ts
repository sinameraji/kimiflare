import { platform, release, homedir } from "node:os";
import { basename, join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import type { ToolSpec } from "../tools/registry.js";
import { systemPromptForMode, type Mode } from "../mode.js";

export interface SystemPromptOpts {
  cwd: string;
  tools: ToolSpec[];
  model: string;
  now?: Date;
  mode?: Mode;
}

const CONTEXT_FILENAMES = ["KIMI.md", "KIMIFLARE.md", "AGENT.md"];
const MAX_CONTEXT_BYTES = 20 * 1024;

export interface ContextFile {
  name: string;
  path: string;
  content: string;
  lineCount: number;
}

export function loadContextFile(cwd: string): ContextFile | null {
  for (const name of CONTEXT_FILENAMES) {
    const path = join(cwd, name);
    try {
      const s = statSync(path);
      if (!s.isFile() || s.size > MAX_CONTEXT_BYTES) continue;
      const content = readFileSync(path, "utf8");
      return { name, path, content, lineCount: content.split("\n").length };
    } catch {
      /* not present */
    }
  }
  return null;
}

export function buildSystemPrompt(opts: SystemPromptOpts): string {
  const now = opts.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const shell = process.env.SHELL ? basename(process.env.SHELL) : "sh";
  const toolsBlock = opts.tools
    .map((t) => {
      const perm = t.needsPermission ? " [needs user permission]" : "";
      return `- \`${t.name}\`${perm}: ${t.description.split("\n")[0]}`;
    })
    .join("\n");

  const base = `You are kimiflare, an interactive coding assistant running in the user's terminal. You act on the user's local filesystem through the tools listed below. You are powered by the ${opts.model} model on Cloudflare Workers AI.

Environment:
- Working directory: ${opts.cwd}
- Platform: ${platform()} ${release()}
- Shell: ${shell}
- Home: ${homedir()}
- Today: ${date}

Tools available:
${toolsBlock}

How to work:
- Prefer calling tools over guessing. Read files before editing them. Use \`glob\` and \`grep\` to explore code before assuming structure.
- Before any mutating tool call (write, edit, bash), state in one short sentence what you're about to do, then call the tool. The user will be asked to approve each mutating call.
- When the user asks for a change, make the change. Do not paste code in chat that you could apply with \`edit\` or \`write\`.
- For multi-step work, call \`tasks_set\` at the start with a short task list (one task "in_progress", the rest "pending"), then call it again after each step completes (flip that one to "completed" and the next to "in_progress"). Skip it for trivial single-step requests.
- Keep responses terse. The user sees tool calls and their results inline — do not re-summarize them unless asked.
- If a tool returns an error, read it carefully and adjust; do not retry the same call blindly.
- You have a 262k-token context window. Read as much of a file as needed rather than guessing.
- If a request is ambiguous, ask one focused question instead of making large assumptions.
- When you finish a task, stop. Do not add a closing summary.
- When creating git commits, you must include \`Co-authored-by: kimiflare <kimiflare@proton.me>\` in the commit message so kimiflare is credited as a contributor. The bash tool will also auto-append this trailer when it detects git commit-creating commands.`;

  const ctx = loadContextFile(opts.cwd);
  const contextBlock = ctx
    ? `\n\nProject context from ${ctx.name} (${ctx.lineCount} lines, treat as authoritative):\n${ctx.content.trim()}`
    : "";
  const modeBlock = opts.mode ? systemPromptForMode(opts.mode) : "";

  return base + contextBlock + modeBlock;
}
