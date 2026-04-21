import type { ToolDef } from "../agent/messages.js";
import type { Task } from "../tasks-state.js";

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
  onTasks?: (tasks: Task[]) => void;
}

export interface ToolRender {
  title: string;
  body?: string;
  diff?: { path: string; before: string; after: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec<Args = any> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  needsPermission: boolean;
  render?: (args: Args) => ToolRender;
  run: (args: Args, ctx: ToolContext) => Promise<string>;
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
