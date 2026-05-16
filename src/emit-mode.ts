/**
 * Camouflage adapter (emit mode).
 *
 * Runs agent turns headlessly and emits NDJSON to stdout in the Camouflage
 * event-protocol shape (see ~/camouflage/crates/protocol/src/lib.rs).
 *
 * Two modes:
 *
 *   One-shot:
 *     kimiflare --emit-events -p "do X" | camouflage-tui --stdin-events
 *
 *   Multi-turn (this commit):
 *     kimiflare --emit-events --multi-turn -p "first prompt"
 *     # then on stdin, one NDJSON line per follow-up:
 *     # {"event_type":"UserInputSubmitted","payload":{"text":"do Y next"}}
 *
 * The TUI emits UserInputSubmitted on stdout when the user hits Enter
 * (--emit-responses); piping that into a multi-turn adapter closes the
 * loop and gives you a real conversational session.
 *
 * Bidirectional permission responses are deferred to a follow-up; for now
 * we resolve permissions inline via --dangerously-allow-all or auto-deny.
 */

import * as readline from "node:readline";
import { execSync } from "node:child_process";
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
  /** When true, after the initial turn keep reading stdin for follow-up
   *  UserInputSubmitted events and run another turn per submission. */
  multiTurn?: boolean;
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
  // In emit mode stdout is reserved for NDJSON. Funnel any stray writes
  // (logger bring-up banners, libraries that console.log) to stderr.
  const origLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);

  const stdout = process.stdout;
  const emit = (event_type: string, payload: Record<string, unknown> = {}): void => {
    stdout.write(JSON.stringify({ event_type, payload }) + "\n");
  };

  emit("SessionStarted", {});

  // Seed status-bar segments the TUI will render at the bottom.
  // Mode is hardcoded to "edit" for now (emit-mode doesn't currently
  // surface KimiFlare's mode cycling). Branch is resolved once via
  // `git rev-parse`. Phase/elapsed/tokens update across the session.
  const sessionStartMs = Date.now();
  let promptTokens = 0;
  let cachedTokens = 0;
  let currentPhase: "idle" | "thinking" | "streaming" | "tool" = "idle";
  const branch = tryGitBranch();
  const initialSegments: Record<string, string> = {
    mode: "edit",
    phase: currentPhase,
    elapsed: "0s",
    branch,
  };
  emit("StatusUpdate", { segments: initialSegments });

  const setPhase = (next: typeof currentPhase): void => {
    if (next === currentPhase) return;
    currentPhase = next;
    emit("StatusUpdate", { segments: { phase: next } });
  };

  const setTokens = (prompt: number, cached: number): void => {
    if (prompt === promptTokens && cached === cachedTokens) return;
    promptTokens = prompt;
    cachedTokens = cached;
    const txt = cached > 0
      ? `in ${formatK(prompt)} (${formatK(cached)} cached)`
      : `in ${formatK(prompt)}`;
    emit("StatusUpdate", { segments: { tokens: txt } });
  };

  // Tick the elapsed segment once a second so the TUI status bar stays
  // live during long turns. Stopped in the finally block.
  const elapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - sessionStartMs) / 1000);
    emit("StatusUpdate", { segments: { elapsed: formatElapsed(secs) } });
  }, 1000);

  const cwd = process.cwd();
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model: opts.model }) },
  ];

  let streamCounter = 0;
  let currentStreamId: string | null = null;
  let exitCode = 0;
  let aborted = false;

  const controller = new AbortController();
  const sigintHandler = () => {
    aborted = true;
    controller.abort();
  };
  process.on("SIGINT", sigintHandler);

  /** Run one agent turn with the given user text. Emits the user message,
   *  then drives runAgentTurn with NDJSON-routed callbacks. Errors are
   *  captured per-turn so a single turn's failure doesn't kill a multi-
   *  turn session. */
  async function runTurn(text: string): Promise<void> {
    emit("UserMessageCreated", { text });
    messages.push({ role: "user", content: text });

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
            setPhase("thinking"); // before first token, we're still composing
            emit("AssistantStreamStarted", { stream_id: currentStreamId });
          },
          onTextDelta: (delta) => {
            if (!currentStreamId) {
              streamCounter += 1;
              currentStreamId = `s${streamCounter}`;
              emit("AssistantStreamStarted", { stream_id: currentStreamId });
            }
            setPhase("streaming"); // first delta flips phase
            emit("AssistantTokenDelta", { stream_id: currentStreamId, token: delta });
          },
          onAssistantFinal: () => {
            if (currentStreamId) {
              emit("AssistantMessageCompleted", { stream_id: currentStreamId });
              currentStreamId = null;
            }
            setPhase("idle");
          },
          onToolCallFinalized: (call) => {
            setPhase("tool");
            emit("ToolExecutionStarted", {
              tool_id: call.id,
              tool: call.function.name,
              command: call.function.arguments,
            });
          },
          onToolResult: (result) => {
            if (result.content && result.content.length > 0) {
              emit(result.ok ? "ToolExecutionStdout" : "ToolExecutionStderr", {
                tool_id: result.tool_call_id,
                chunk: result.content,
              });
            }
            emit("ToolExecutionFinished", {
              tool_id: result.tool_call_id,
              exit_code: result.ok ? 0 : 1,
            });
            // After a tool result we typically loop back to thinking
            // (next assistant turn) — flip phase optimistically; the next
            // onAssistantStart/onTextDelta will overwrite.
            setPhase("thinking");
          },
          onUsage: (usage) => {
            setTokens(usage.prompt_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
          },
          onUsageFinal: (usage) => {
            setTokens(usage.prompt_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
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
        exitCode = 42;
        aborted = true;
      } else if (err instanceof AgentLoopError) {
        emit("RuntimeError", {
          message: "agent loop detected (repeated tool calls)",
          kind: "generic",
          severity: "error",
        });
        exitCode = 43;
        aborted = true;
      } else if (isKillSwitchError(err)) {
        emit("RuntimeError", {
          message: "KimiFlare Cloud budget exhausted across all users",
          kind: "quota_exhausted",
          severity: "fatal",
          cta: { label: "switch to BYOK: kimiflare config set-key", action_id: "byok" },
        });
        aborted = true;
      } else if (err instanceof KimiApiError) {
        emit("RuntimeError", {
          message: humanizeCloudflareError(err),
          source: "cloudflare",
          kind: "api_error",
          severity: "error",
        });
        // Recoverable from the user's POV: don't abort multi-turn sessions
        // on a single bad API call; let them try a different prompt.
      } else {
        emit("RuntimeError", {
          message: err instanceof Error ? err.message : String(err),
          kind: "generic",
          severity: "error",
        });
      }
    }
  }

  try {
    // Initial turn from -p.
    await runTurn(opts.prompt);

    // Multi-turn loop: keep reading stdin for UserInputSubmitted lines.
    if (opts.multiTurn && !aborted) {
      const rl = readline.createInterface({ input: process.stdin });
      for await (const line of rl) {
        if (aborted) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: { event_type?: string; payload?: { text?: string } };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          emit("RuntimeError", {
            message: `multi-turn: invalid JSON on stdin: ${trimmed.slice(0, 80)}`,
            source: "emit-mode",
            kind: "generic",
            severity: "warn",
          });
          continue;
        }
        if (msg.event_type === "UserInputSubmitted" && typeof msg.payload?.text === "string") {
          await runTurn(msg.payload.text);
        }
        // PermissionResponse handling lands in Phase 1.4; for now we
        // silently drop unrecognised events so a TUI that emits both
        // UserInputSubmitted and PermissionResponse doesn't crash us.
      }
    }
  } finally {
    clearInterval(elapsedTimer);
    // Final status sweep so the TUI's last visible state is coherent
    // (phase=idle, final elapsed) before SessionEnded arrives.
    const finalSecs = Math.floor((Date.now() - sessionStartMs) / 1000);
    emit("StatusUpdate", { segments: { phase: "idle", elapsed: formatElapsed(finalSecs) } });
    process.off("SIGINT", sigintHandler);
    emit("SessionEnded", {});
    console.log = origLog;
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function tryGitBranch(): string {
  try {
    const out = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
      encoding: "utf8",
      timeout: 200,
    }).trim();
    return out || "—";
  } catch {
    return "—";
  }
}
