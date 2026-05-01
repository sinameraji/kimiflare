import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./web-fetch.js";
import { tasksSetTool } from "./tasks.js";
import { memoryRememberTool, memoryRecallTool, memoryForgetTool } from "./memory.js";
import { handOffTool } from "./hand-off.js";
import { ToolArtifactStore } from "./artifact-store.js";
import { reduceToolOutput, DEFAULT_REDUCER_CONFIG } from "./reducer.js";
import { makeExpandArtifactTool } from "./expand-artifact.js";

export const ALL_TOOLS: ToolSpec[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
  webFetchTool,
  tasksSetTool,
  memoryRememberTool,
  memoryRecallTool,
  memoryForgetTool,
  handOffTool,
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
  /** Raw output bytes before any truncation/capping. */
  rawBytes?: number;
  /** Final output bytes after truncation/capping. */
  reducedBytes?: number;
  /** Artifact ID if the raw output was stored for later expansion. */
  artifactId?: string;
}

export class ToolExecutor {
  private sessionAllowed = new Set<string>();
  private tools: Map<string, ToolSpec>;
  private artifactStore: ToolArtifactStore;

  constructor(tools: ToolSpec[] = ALL_TOOLS) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.artifactStore = new ToolArtifactStore();
    this.tools.set("expand_artifact", makeExpandArtifactTool(this.artifactStore));
  }

  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  register(tool: ToolSpec): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  clearSessionPermissions(): void {
    this.sessionAllowed.clear();
  }

  clearArtifacts(): void {
    this.artifactStore.clear();
  }

  async run(
    call: ToolInvocation,
    askPermission: PermissionAsker,
    ctx: ToolContext,
    onFileChange?: (path: string, content: string) => void,
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
      const result = await tool.run(args as never, ctx);
      const normalized = normalizeToolOutput(result);

      // Notify LSP document sync bridge on write/edit
      if (onFileChange) {
        if (call.name === "write" && typeof args.path === "string" && typeof args.content === "string") {
          onFileChange(args.path, args.content);
        } else if (call.name === "edit" && typeof args.path === "string") {
          // For edit, we don't have the new content readily available;
          // the LSP manager will need to read the file. Pass empty to signal change.
          onFileChange(args.path, "");
        }
      }

      // Diff-style git commands carry meaning per line; the bash reducer's
      // dedupeConsecutiveLines rule mangles them and traps the model in retry
      // loops on merge-conflict resolution. Archive the artifact so
      // expand_artifact still works, but hand the model the unreduced content.
      const cmd = call.name === "bash" && typeof args.command === "string" ? args.command : "";
      if (isDiffCommand(cmd)) {
        const artifactId = this.artifactStore.store(normalized.content);
        const bytes = Buffer.byteLength(normalized.content, "utf8");
        return {
          tool_call_id: call.id,
          name: call.name,
          content: normalized.content,
          ok: true,
          rawBytes: bytes,
          reducedBytes: bytes,
          artifactId,
        };
      }

      const reduced = reduceToolOutput(
        call.name,
        normalized.content,
        args,
        this.artifactStore,
        DEFAULT_REDUCER_CONFIG,
      );
      return {
        tool_call_id: call.id,
        name: call.name,
        content: reduced.content,
        ok: true,
        rawBytes: reduced.rawBytes,
        reducedBytes: reduced.reducedBytes,
        artifactId: reduced.artifactId,
      };
    } catch (e) {
      const msg = `Error running ${call.name}: ${(e as Error).message ?? String(e)}`;
      return {
        tool_call_id: call.id,
        name: call.name,
        content: msg,
        ok: false,
        rawBytes: msg.length,
        reducedBytes: msg.length,
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

/** True if the command is a diff-style git invocation whose output the bash
 *  reducer would mangle (dedupe of similar adjacent lines collapses real diff
 *  context). Conservative match: anchored at the start, requires `-p` /
 *  `--patch` for the cases where it's optional. */
export function isDiffCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (/^git\s+show(?:\s|$)/.test(trimmed)) return true;
  if (/^git\s+diff(?:\s|$)/.test(trimmed)) return true;
  if (/^git\s+format-patch(?:\s|$)/.test(trimmed)) return true;
  const hasPatchFlag = /(?:^|\s)(?:-p|--patch)(?:\s|$)/.test(trimmed);
  if (/^git\s+log(?:\s|$)/.test(trimmed) && hasPatchFlag) return true;
  if (/^git\s+stash\s+show(?:\s|$)/.test(trimmed) && hasPatchFlag) return true;
  return false;
}

function normalizeToolOutput(result: string | ToolOutput): ToolOutput {
  if (typeof result === "string") {
    const bytes = Buffer.byteLength(result, "utf8");
    return { content: result, rawBytes: bytes, reducedBytes: bytes };
  }
  return result;
}

function truncateForError(s: string): string {
  return s.length <= 200 ? s : `${s.slice(0, 200)}... [${s.length - 200} more chars]`;
}
