/**
 * Camouflage adapter (emit mode).
 *
 * Runs a single agent turn headlessly and emits NDJSON to stdout in the
 * Camouflage event-protocol shape (see ~/camouflage/crates/protocol/src/lib.rs).
 * The intended pipeline is:
 *
 *     kimiflare --emit-events -p "do X" | camouflage-tui --stdin-events
 *
 * For the v0 adapter this is a one-shot mode that mirrors `runPrintMode` but
 * routes every callback through an NDJSON sink. Multi-turn (stdin-driven
 * follow-ups) and bidirectional permission responses are deferred to follow-up
 * commits; for now we resolve permissions inline via --dangerously-allow-all or
 * auto-deny, and still emit the corresponding PermissionRequested/Granted/Denied
 * events so the renderer's permission widget can be observed end-to-end.
 */

import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { KimiApiError, isKillSwitchError, humanizeCloudflareError } from "./util/errors.js";

export interface EmitModeOpts {
  accountId: string;
  apiToken: string;
  model: string;
  prompt: string;
  allowAll: boolean;
  codeMode?: boolean;
  continueOnLimit?: boolean;
  maxInputTokens?: number;
  cloudMode?: boolean;
  cloudToken?: string;
  cloudDeviceId?: string;
  aiGatewayId?: string;
}

function gatewayFromOpts(opts: EmitModeOpts): AiGatewayOptions | undefined {
  if (!opts.aiGatewayId) return undefined;
  return { id: opts.aiGatewayId };
}

export async function runEmitMode(opts: EmitModeOpts): Promise<void> {
  // In emit mode stdout is reserved for NDJSON. Funnel any stray writes (logger
  // bring-up banners, libraries that console.log) to stderr so they don't
  // corrupt the event stream.
  const origLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);

  const stdout = process.stdout;
  const emit = (event_type: string, payload: Record<string, unknown> = {}): void => {
    stdout.write(JSON.stringify({ event_type, payload }) + "\n");
  };

  emit("SessionStarted", {});
  emit("UserMessageCreated", { text: opts.prompt });

  let streamCounter = 0;
  let currentStreamId: string | null = null;

  const cwd = process.cwd();
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model: opts.model }) },
    { role: "user", content: opts.prompt },
  ];

  const controller = new AbortController();
  const sigintHandler = () => controller.abort();
  process.on("SIGINT", sigintHandler);

  try {
    await runAgentTurn({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      gateway: gatewayFromOpts(opts),
      messages,
      tools: ALL_TOOLS,
      executor,
      cwd,
      signal: controller.signal,
      codeMode: opts.codeMode,
      continueOnLimit: opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      cloudMode: opts.cloudMode,
      cloudToken: opts.cloudToken,
      cloudDeviceId: opts.cloudDeviceId,
      callbacks: {
        onAssistantStart: () => {
          streamCounter += 1;
          currentStreamId = `s${streamCounter}`;
          emit("AssistantStreamStarted", { stream_id: currentStreamId });
        },
        onTextDelta: (delta) => {
          if (!currentStreamId) {
            streamCounter += 1;
            currentStreamId = `s${streamCounter}`;
            emit("AssistantStreamStarted", { stream_id: currentStreamId });
          }
          emit("AssistantTokenDelta", { stream_id: currentStreamId, token: delta });
        },
        onAssistantFinal: () => {
          if (currentStreamId) {
            emit("AssistantMessageCompleted", { stream_id: currentStreamId });
            currentStreamId = null;
          }
        },
        onToolCallFinalized: (call) => {
          emit("ToolExecutionStarted", {
            tool_id: call.id,
            tool: call.function.name,
            command: call.function.arguments,
          });
        },
        onToolResult: (result) => {
          emit("ToolExecutionFinished", {
            tool_id: result.tool_call_id,
            exit_code: result.ok ? 0 : 1,
          });
        },
        onWarning: (msg) => {
          emit("RuntimeError", { message: msg, kind: "generic", severity: "warn" });
        },
        askPermission: async ({ tool, args }) => {
          const reqId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          emit("PermissionRequested", {
            request_id: reqId,
            tool: tool.name,
            action: JSON.stringify(args),
          });
          if (opts.allowAll) {
            emit("PermissionGranted", { request_id: reqId });
            return "allow";
          }
          emit("PermissionDenied", { request_id: reqId });
          return "deny";
        },
      },
    });
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      emit("RuntimeError", {
        message: "cumulative input token budget exhausted",
        kind: "quota_exhausted",
        severity: "error",
      });
      process.exitCode = 42;
    } else if (err instanceof AgentLoopError) {
      emit("RuntimeError", {
        message: "agent loop detected (repeated tool calls)",
        kind: "generic",
        severity: "error",
      });
      process.exitCode = 43;
    } else if (isKillSwitchError(err)) {
      emit("RuntimeError", {
        message: "KimiFlare Cloud budget exhausted across all users",
        kind: "quota_exhausted",
        severity: "fatal",
        cta: { label: "switch to BYOK: kimiflare config set-key", action_id: "byok" },
      });
    } else if (err instanceof KimiApiError) {
      emit("RuntimeError", {
        message: humanizeCloudflareError(err),
        source: "cloudflare",
        kind: "api_error",
        severity: "error",
      });
      process.exitCode = 1;
    } else {
      emit("RuntimeError", {
        message: err instanceof Error ? err.message : String(err),
        kind: "generic",
        severity: "error",
      });
      process.exitCode = 1;
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    emit("SessionEnded", {});
    console.log = origLog;
  }
}
