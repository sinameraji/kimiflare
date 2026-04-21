import type { ToolSpec, ToolContext } from "./registry.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./web-fetch.js";
import { tasksSetTool } from "./tasks.js";

export const ALL_TOOLS: ToolSpec[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
  webFetchTool,
  tasksSetTool,
];

export type PermissionDecision = "allow" | "allow_session" | "deny";

export interface PermissionRequest {
  tool: ToolSpec;
  args: Record<string, unknown>;
  sessionKey: string;
}

export type PermissionAsker = (req: PermissionRequest) => Promise<PermissionDecision>;

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  ok: boolean;
}

export class ToolExecutor {
  private sessionAllowed = new Set<string>();
  private tools: Map<string, ToolSpec>;

  constructor(tools: ToolSpec[] = ALL_TOOLS) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  clearSessionPermissions(): void {
    this.sessionAllowed.clear();
  }

  async run(
    call: ToolInvocation,
    askPermission: PermissionAsker,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        tool_call_id: call.id,
        name: call.name,
        content: `Error: unknown tool "${call.name}". Valid tools: ${[...this.tools.keys()].join(", ")}.`,
        ok: false,
      };
    }

    let args: Record<string, unknown>;
    try {
      args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch (e) {
      return {
        tool_call_id: call.id,
        name: call.name,
        content: `Error: invalid JSON arguments for ${call.name}: ${(e as Error).message}. Arguments received: ${truncateForError(call.arguments)}`,
        ok: false,
      };
    }

    if (tool.needsPermission) {
      const sessionKey = this.permissionKey(tool, args);
      if (!this.sessionAllowed.has(sessionKey)) {
        const decision = await askPermission({ tool, args, sessionKey });
        if (decision === "deny") {
          return {
            tool_call_id: call.id,
            name: call.name,
            content: `Permission denied by user. Do not retry this exact call; ask the user what they want to do differently.`,
            ok: false,
          };
        }
        if (decision === "allow_session") this.sessionAllowed.add(sessionKey);
      }
    }

    try {
      const content = await tool.run(args as never, ctx);
      return { tool_call_id: call.id, name: call.name, content, ok: true };
    } catch (e) {
      return {
        tool_call_id: call.id,
        name: call.name,
        content: `Error running ${call.name}: ${(e as Error).message ?? String(e)}`,
        ok: false,
      };
    }
  }

  private permissionKey(tool: ToolSpec, args: Record<string, unknown>): string {
    if (tool.name === "bash" && typeof args.command === "string") {
      const firstToken = args.command.trim().split(/\s+/)[0] ?? "";
      return `bash:${firstToken}`;
    }
    return tool.name;
  }
}

function truncateForError(s: string): string {
  return s.length <= 200 ? s : `${s.slice(0, 200)}... [${s.length - 200} more chars]`;
}
