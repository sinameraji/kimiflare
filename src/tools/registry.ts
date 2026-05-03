import type { ToolDef } from "../agent/messages.js";
import type { Task } from "../tasks-state.js";

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
  onTasks?: (tasks: Task[]) => void;
  coauthor?: { name: string; email: string };
  memoryManager?: import("../memory/manager.js").MemoryManager | null;
  sessionId?: string;
  /** Agent role for multi-agent context (plan, build, general). */
  agentRole?: string;
  /** Full tool list for specialist delegation. */
  allTools?: ToolSpec[];
  /** Account credentials for specialist LLM calls. */
  accountId?: string;
  apiToken?: string;
  /** Model and gateway for specialist LLM calls. */
  model?: string;
  gateway?: import("../agent/client.js").AiGatewayOptions;
  /** Executor for specialist tool calls. */
  executor?: import("./executor.js").ToolExecutor;
  /** Code mode flag for coding specialist. */
  codeMode?: boolean;
  /** File change callback for LSP sync. */
  onFileChange?: (path: string, content: string) => void;
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
