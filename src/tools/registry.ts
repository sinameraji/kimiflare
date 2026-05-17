import type { ToolDef } from "../agent/messages.js";

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
  onTasks?: (tasks: Task[]) => void;
  coauthor?: { name: string; email: string };
  memoryManager?: import("../memory/manager.js").MemoryManager | null;
  sessionId?: string;
  githubToken?: string;
  /** Shell override for the bash tool. If omitted, the tool auto-detects based on platform. */
  shell?: string;
  /** Spawn a subagent. Injected by the loop when the parent turn has
   *  subagent capability enabled (heavy/medium tier). The `Agent` tool
   *  calls this; depth and fanout caps are enforced inside the runner.
   *  Returns `{ summary }` plus telemetry the tool can render to the
   *  parent context. See `src/agent/subagent.ts`. */
  runSubagent?: (args: {
    description: string;
    prompt: string;
    subagent_type: "general" | "explore" | "plan";
    task_id?: string;
  }) => Promise<{
    summary: string;
    transcript: import("../agent/messages.js").ChatMessage[];
    childSessionId: string;
    toolCallCount: number;
    durationMs: number;
  }>;
}

export interface ToolRender {
  title: string;
  body?: string;
  diff?: { path: string; before: string; after: string };
}

export interface ToolOutput {
  content: string;
  rawBytes: number;
  reducedBytes: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec<Args = any> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  needsPermission: boolean;
  render?: (args: Args) => ToolRender;
  run: (args: Args, ctx: ToolContext) => Promise<string | ToolOutput>;
}

export function toOpenAIToolDefs(tools: ToolSpec[]): ToolDef[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export function isValidStatus(s: unknown): s is TaskStatus {
  return s === "pending" || s === "in_progress" || s === "completed";
}

export function validateTasks(input: unknown): Task[] {
  if (!Array.isArray(input)) throw new Error("tasks must be an array");
  return input.map((t, i) => {
    if (!t || typeof t !== "object") throw new Error(`tasks[${i}] must be an object`);
    const rec = t as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : String(i + 1);
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) throw new Error(`tasks[${i}].title is required`);
    const status: TaskStatus = isValidStatus(rec.status) ? rec.status : "pending";
    return { id, title, status };
  });
}
