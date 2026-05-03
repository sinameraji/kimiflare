import type { AgentCallbacks, AgentTurnOpts } from "../../../src/agent/loop.js";
import type { ToolCall, Usage } from "../../../src/agent/messages.js";
import type { ToolResult } from "../../../src/tools/executor.js";
import type { Task } from "../../../src/tasks-state.js";

export type RemoteProgressEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_args"; index: number; delta: string }
  | { type: "tool_call_finalized"; call: ToolCall }
  | { type: "tool_result"; result: ToolResult }
  | { type: "usage"; usage: Usage }
  | { type: "tasks"; tasks: Task[] }
  | { type: "turn_end"; turn: number }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; message: string }
  | { type: "heartbeat" };

function emit(event: RemoteProgressEvent): void {
  console.log(JSON.stringify(event));
}

export function createProgressReporter(): AgentCallbacks {
  let currentTurn = 0;

  return {
    onAssistantStart: () => {
      currentTurn++;
      emit({ type: "turn_start", turn: currentTurn });
    },
    onReasoningDelta: (text: string) => {
      emit({ type: "reasoning_delta", text });
    },
    onTextDelta: (text: string) => {
      emit({ type: "text_delta", text });
    },
    onToolCallStart: (index: number, id: string, name: string) => {
      emit({ type: "tool_call_start", index, id, name });
    },
    onToolCallArgs: (index: number, delta: string) => {
      emit({ type: "tool_call_args", index, delta });
    },
    onToolCallFinalized: (call: ToolCall) => {
      emit({ type: "tool_call_finalized", call });
    },
    onToolResult: (result: ToolResult) => {
      emit({ type: "tool_result", result });
    },
    onUsage: (usage: Usage) => {
      emit({ type: "usage", usage });
    },
    onUsageFinal: (usage: Usage) => {
      emit({ type: "usage", usage });
    },
    onAssistantFinal: () => {
      emit({ type: "turn_end", turn: currentTurn });
    },
    onTasks: (tasks: Task[]) => {
      emit({ type: "tasks", tasks });
    },
    askPermission: async () => "allow",
  };
}

export async function postProgress(
  url: string,
  sessionId: string,
  events: RemoteProgressEvent[],
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, events }),
    });
  } catch {
    // Non-fatal: progress posting is best-effort
  }
}

export async function postFinalize(
  url: string,
  sessionId: string,
  summary: string,
  commitCount: number,
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, summary, commitCount }),
    });
  } catch {
    // Non-fatal
  }
}
