interface ProgressEvent {
  type: string;
  [key: string]: unknown;
}

const PROGRESS_URL = process.env.PROGRESS_URL ?? "";
const FINALIZE_URL = process.env.FINALIZE_URL ?? "";

export async function reportProgress(event: ProgressEvent): Promise<void> {
  if (!PROGRESS_URL) return;
  try {
    await fetch(PROGRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Best-effort progress reporting
  }
}

export async function postFinalize(opts: {
  exitCode: number;
  hasChanges: boolean;
  errorLog?: string;
}): Promise<void> {
  if (!FINALIZE_URL) return;
  try {
    await fetch(FINALIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch {
    // Best-effort finalization
  }
}

export function createProgressReporter() {
  let turn = 0;

  return {
    onTurnStart: async () => {
      turn++;
      await reportProgress({ type: "turn_start", turn });
    },
    onToolCall: async (toolName: string, args: Record<string, unknown>) => {
      await reportProgress({ type: "tool_call", tool: toolName, args });
    },
    onToolResult: async (toolName: string, result: unknown) => {
      await reportProgress({ type: "tool_result", tool: toolName, result });
    },
    onUsage: async (promptTokens: number, completionTokens: number) => {
      await reportProgress({ type: "usage", promptTokens, completionTokens });
    },
    onError: async (message: string) => {
      await reportProgress({ type: "error", message });
    },
    onDone: async () => {
      await reportProgress({ type: "done" });
    },
  };
}
