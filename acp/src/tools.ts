import type {
  ToolCall as AcpToolCall,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind,
  ToolCallLocation,
} from "@agentclientprotocol/sdk";
import type { ToolCall } from "#kimiflare/agent/messages.js";
import type { ToolResult } from "#kimiflare/tools/executor.js";
import type { ToolSpec } from "#kimiflare/tools/registry.js";

/**
 * Map a kimiflare tool name to an ACP ToolKind.
 */
function toolKind(name: string): ToolKind {
  switch (name) {
    case "read":
      return "read";
    case "write":
    case "edit":
      return "edit";
    case "bash":
      return "execute";
    case "glob":
    case "grep":
      return "search";
    case "web_fetch":
      return "fetch";
    case "tasks_set":
    case "expand_artifact":
      return "think";
    default:
      return "other";
  }
}

/**
 * Build a human-readable title for an ACP tool call from kimiflare's tool call.
 */
function toolTitle(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read": {
      const path = typeof args.path === "string" ? args.path : "file";
      let label = `Read ${path}`;
      if (typeof args.offset === "number" || typeof args.limit === "number") {
        const from = typeof args.offset === "number" ? args.offset : 1;
        const to =
          typeof args.limit === "number" ? from + args.limit - 1 : undefined;
        label += to !== undefined ? ` (${from}-${to})` : ` (from ${from})`;
      }
      return label;
    }
    case "write": {
      const path = typeof args.path === "string" ? args.path : "file";
      return `Write ${path}`;
    }
    case "edit": {
      const path = typeof args.path === "string" ? args.path : "file";
      return `Edit ${path}${args.replace_all ? " (replace_all)" : ""}`;
    }
    case "bash": {
      let cmd = typeof args.command === "string" ? args.command.trim() : "";
      // Strip leading cd + && to show the actual command
      const m = cmd.match(/^cd\s+[^\s&;]+\s*(?:&&|;)\s*(.*)$/);
      if (m) cmd = m[1]!.trim();
      return `$ ${cmd}`.slice(0, 120);
    }
    case "glob": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      return `Find ${pattern}`;
    }
    case "grep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      let label = "grep";
      if (args.case_insensitive) label += " -i";
      if (typeof args.glob === "string") label += ` --include="${args.glob}"`;
      label += ` "${pattern}"`;
      if (typeof args.path === "string") label += ` ${args.path}`;
      return label.slice(0, 120);
    }
    case "web_fetch": {
      const url = typeof args.url === "string" ? args.url : "";
      return `GET ${url}`.slice(0, 120);
    }
    case "tasks_set":
      return `Update tasks (${Array.isArray(args.tasks) ? args.tasks.length : 0} items)`;
    case "expand_artifact":
      return `Expand ${typeof args.artifact_id === "string" ? args.artifact_id : "artifact"}`;
    default:
      return name;
  }
}

/**
 * Extract file locations from a tool call's arguments for ACP "follow-along".
 */
function toolLocations(
  name: string,
  args: Record<string, unknown>,
): ToolCallLocation[] {
  const path = typeof args.path === "string" ? args.path : null;
  if (!path) return [];
  switch (name) {
    case "read":
      return [
        { path, line: typeof args.offset === "number" ? args.offset : 1 },
      ];
    case "write":
    case "edit":
      return [{ path }];
    case "glob":
    case "grep":
      return [{ path }];
    default:
      return [];
  }
}

/**
 * Build the initial ACP ToolCallContent from a kimiflare tool call.
 * For write/edit, we send diff content blocks. For everything else, empty.
 */
function toolContent(
  name: string,
  args: Record<string, unknown>,
): ToolCallContent[] {
  switch (name) {
    case "write": {
      const path = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      return [
        {
          type: "diff",
          path,
          oldText: null,
          newText: content,
        },
      ];
    }
    case "edit": {
      const path = typeof args.path === "string" ? args.path : "";
      const oldText =
        typeof args.old_string === "string" ? args.old_string : "";
      const newText =
        typeof args.new_string === "string" ? args.new_string : "";
      return [
        {
          type: "diff",
          path,
          oldText: oldText || null,
          newText,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Convert a finalized kimiflare ToolCall into an ACP tool_call SessionUpdate.
 */
export function toAcpToolCall(tc: ToolCall): AcpToolCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments || "{}");
  } catch {
    console.error(
      `Warning: malformed JSON arguments for tool "${tc.function.name}" (id: ${tc.id}), using empty args`,
    );
  }

  return {
    toolCallId: tc.id,
    title: toolTitle(tc.function.name, args),
    kind: toolKind(tc.function.name),
    status: "in_progress",
    content: toolContent(tc.function.name, args),
    locations: toolLocations(tc.function.name, args),
    rawInput: args,
  };
}

/**
 * Convert a kimiflare ToolResult into an ACP tool_call_update SessionUpdate.
 */
export function toAcpToolUpdate(result: ToolResult): ToolCallUpdate {
  const content: ToolCallContent[] = [];

  if (result.content) {
    content.push({
      type: "content",
      content: { type: "text", text: result.content },
    });
  }

  return {
    toolCallId: result.tool_call_id,
    status: result.ok ? "completed" : "failed",
    content: content.length > 0 ? content : undefined,
    rawOutput: result.content,
  };
}

/**
 * Map a kimiflare ToolSpec to an ACP PermissionOption set for requestPermission.
 */
export function permissionOptions(): Array<{
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}> {
  return [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    {
      optionId: "allow_session",
      name: "Allow for this session",
      kind: "allow_always",
    },
    { optionId: "deny", name: "Deny", kind: "reject_once" },
  ];
}

/**
 * Convert an ACP permission outcome to a kimiflare PermissionDecision.
 */
export function fromAcpPermissionOutcome(
  outcome: { outcome: "cancelled" } | { outcome: "selected"; optionId: string },
): "allow" | "allow_session" | "deny" {
  if (outcome.outcome === "cancelled") return "deny";
  switch (outcome.optionId) {
    case "allow_once":
      return "allow";
    case "allow_session":
      return "allow_session";
    case "deny":
    default:
      return "deny";
  }
}
