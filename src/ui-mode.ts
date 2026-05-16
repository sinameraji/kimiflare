/**
 * Camouflage UI mode.
 *
 * Like `--emit-events --multi-turn` but instead of writing NDJSON to stdout
 * for some external consumer to pipe, this mode spawns the Camouflage
 * renderer as a child process via the `camouflage` Node SDK. The renderer
 * draws directly to the user's terminal — single command, single process
 * tree, no plumbing visible to the user.
 *
 * Invocation:
 *     kimiflare --ui camouflage -p "do X"
 *
 * Bidirectional out of the box: typing into the renderer's input box →
 * the binding fires "userInput" → we run another turn. Permission widget
 * choices fire "permissionResponse" → we resolve the pending askPermission.
 *
 * This is the path that paves Option B (the eventual Ink replacement):
 * everything `app.tsx`'s React tree currently sends to Ink can be
 * incrementally redirected to `cam.send(...)`. Once nothing reads from
 * React state, app.tsx + react + ink come out.
 */

import { execSync } from "node:child_process";
import { mount } from "camouflage";
import type { CamouflageHandle } from "camouflage";
import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { KimiApiError, isKillSwitchError, humanizeCloudflareError } from "./util/errors.js";

export interface UiModeOpts {
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
  /** Optional path to the camouflage-tui binary. Defaults to PATH lookup. */
  camouflageBin?: string;
}

function gatewayFromOpts(opts: UiModeOpts): AiGatewayOptions | undefined {
  if (!opts.aiGatewayId) return undefined;
  return { id: opts.aiGatewayId };
}

export async function runUiMode(opts: UiModeOpts): Promise<void> {
  // Spawn the renderer as a child. renderToTerminal=true means: TUI
  // draws to the user's terminal; outbound NDJSON arrives on fd 3.
  let cam: CamouflageHandle;
  try {
    cam = await mount({
      bin: opts.camouflageBin,
      renderToTerminal: true,
    });
  } catch (err) {
    console.error(`kimiflare: failed to launch Camouflage renderer.\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 2;
    return;
  }

  // Seed status segments + session start.
  const sessionStartMs = Date.now();
  let promptTokens = 0;
  let cachedTokens = 0;
  let currentPhase: "idle" | "thinking" | "streaming" | "tool" = "idle";
  const branch = tryGitBranch();

  cam.send("SessionStarted", {});
  cam.send("StatusUpdate", {
    segments: { mode: "edit", phase: currentPhase, elapsed: "0s", branch },
  });

  const setPhase = (next: typeof currentPhase): void => {
    if (next === currentPhase) return;
    currentPhase = next;
    cam.send("StatusUpdate", { segments: { phase: next } });
  };

  const setTokens = (prompt: number, cached: number): void => {
    if (prompt === promptTokens && cached === cachedTokens) return;
    promptTokens = prompt;
    cachedTokens = cached;
    const txt = cached > 0
      ? `in ${formatK(prompt)} (${formatK(cached)} cached)`
      : `in ${formatK(prompt)}`;
    cam.send("StatusUpdate", { segments: { tokens: txt } });
  };

  const elapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - sessionStartMs) / 1000);
    cam.send("StatusUpdate", { segments: { elapsed: formatElapsed(secs) } });
  }, 1000);

  // Bidirectional permission flow. Each ask gets a request_id; the
  // resolver waits for cam's "permissionResponse" to fire with the
  // matching id (or for the renderer to exit, in which case we deny).
  const pendingPermissions = new Map<string, (choice: "allow" | "allow_session" | "deny") => void>();
  cam.on("permissionResponse", ({ request_id, choice }) => {
    const resolver = pendingPermissions.get(request_id);
    if (!resolver) return;
    pendingPermissions.delete(request_id);
    if (choice === "allow_once") resolver("allow");
    else if (choice === "allow_session") resolver("allow_session");
    else resolver("deny");
  });

  // Multi-turn follow-up queue. cam fires "userInput" whenever the user
  // hits Enter in the renderer; we drain that into the agent loop.
  const followUpQueue: string[] = [];
  let followUpResolver: ((text: string | null) => void) | null = null;
  let aborted = false;
  let exitCode = 0;

  cam.on("userInput", (text: string) => {
    if (followUpResolver) {
      const r = followUpResolver;
      followUpResolver = null;
      r(text);
    } else {
      followUpQueue.push(text);
    }
  });

  cam.on("exit", ({ code }) => {
    aborted = true;
    // Wake up any pending askPermission with deny.
    for (const [id, r] of pendingPermissions) {
      pendingPermissions.delete(id);
      r("deny");
    }
    // Wake the follow-up loop so it can exit.
    if (followUpResolver) {
      const r = followUpResolver;
      followUpResolver = null;
      r(null);
    }
    if (code != null && code !== 0) exitCode = code;
  });

  const controller = new AbortController();
  const sigintHandler = () => { aborted = true; controller.abort(); };
  process.on("SIGINT", sigintHandler);

  const cwd = process.cwd();
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model: opts.model }) },
  ];

  let streamCounter = 0;
  let currentStreamId: string | null = null;

  async function runTurn(text: string): Promise<void> {
    cam.send("UserMessageCreated", { text });
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
            setPhase("thinking");
            cam.send("AssistantStreamStarted", { stream_id: currentStreamId });
          },
          onTextDelta: (delta) => {
            if (!currentStreamId) {
              streamCounter += 1;
              currentStreamId = `s${streamCounter}`;
              cam.send("AssistantStreamStarted", { stream_id: currentStreamId });
            }
            setPhase("streaming");
            cam.send("AssistantTokenDelta", { stream_id: currentStreamId, token: delta });
          },
          onAssistantFinal: () => {
            if (currentStreamId) {
              cam.send("AssistantMessageCompleted", { stream_id: currentStreamId });
              currentStreamId = null;
            }
            setPhase("idle");
          },
          onToolCallFinalized: (call) => {
            setPhase("tool");
            cam.send("ToolExecutionStarted", {
              tool_id: call.id,
              tool: call.function.name,
              command: call.function.arguments,
            });
          },
          onToolResult: (result) => {
            if (result.content && result.content.length > 0) {
              cam.send(result.ok ? "ToolExecutionStdout" : "ToolExecutionStderr", {
                tool_id: result.tool_call_id,
                chunk: result.content,
              });
            }
            cam.send("ToolExecutionFinished", {
              tool_id: result.tool_call_id,
              exit_code: result.ok ? 0 : 1,
            });
            setPhase("thinking");
          },
          onUsage: (usage) => {
            setTokens(usage.prompt_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
          },
          onUsageFinal: (usage) => {
            setTokens(usage.prompt_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
          },
          onTasks: (tasks) => {
            for (const t of tasks) {
              const state = t.status === "completed" ? "done" : "running";
              cam.send("BackgroundTaskUpdate", { task_id: t.id, label: t.title, state });
            }
          },
          onSkillsSelected: (result) => {
            const n = (result as any)?.selected?.length ?? 0;
            if (n > 0) {
              cam.send("BackgroundTaskUpdate", {
                task_id: "skills",
                label: `selected ${n} skill${n === 1 ? "" : "s"}`,
                state: "done",
              });
            }
          },
          onMemoryRecalled: (count) => {
            if (count > 0) {
              cam.send("BackgroundTaskUpdate", {
                task_id: "memory",
                label: `recalled ${count} ${count === 1 ? "memory" : "memories"}`,
                state: "done",
              });
            }
          },
          onWarning: (msg) => {
            cam.send("RuntimeError", { message: msg, kind: "generic", severity: "warn" });
          },
          askPermission: async ({ tool, args }) => {
            const reqId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            cam.send("PermissionRequested", {
              request_id: reqId,
              tool: tool.name,
              action: JSON.stringify(args),
            });
            if (opts.allowAll) {
              cam.send("PermissionGranted", { request_id: reqId });
              return "allow";
            }
            // Wait for the renderer's PermissionResponse via the
            // "permissionResponse" event subscribed above.
            const choice = await new Promise<"allow" | "allow_session" | "deny">((resolve) => {
              pendingPermissions.set(reqId, resolve);
            });
            cam.send(
              choice === "deny" ? "PermissionDenied" : "PermissionGranted",
              { request_id: reqId },
            );
            return choice;
          },
        },
      });
    } catch (err) {
      if (err instanceof BudgetExhaustedError) {
        cam.send("RuntimeError", { message: "cumulative input token budget exhausted", kind: "quota_exhausted", severity: "error" });
        exitCode = 42; aborted = true;
      } else if (err instanceof AgentLoopError) {
        cam.send("RuntimeError", { message: "agent loop detected (repeated tool calls)", kind: "generic", severity: "error" });
        exitCode = 43; aborted = true;
      } else if (isKillSwitchError(err)) {
        cam.send("RuntimeError", {
          message: "KimiFlare Cloud budget exhausted across all users",
          kind: "quota_exhausted", severity: "fatal",
          cta: { label: "switch to BYOK: kimiflare config set-key", action_id: "byok" },
        });
        aborted = true;
      } else if (err instanceof KimiApiError) {
        cam.send("RuntimeError", { message: humanizeCloudflareError(err), source: "cloudflare", kind: "api_error", severity: "error" });
      } else {
        cam.send("RuntimeError", { message: err instanceof Error ? err.message : String(err), kind: "generic", severity: "error" });
      }
    }
  }

  async function nextFollowUp(): Promise<string | null> {
    if (followUpQueue.length > 0) return followUpQueue.shift()!;
    if (aborted) return null;
    return new Promise<string | null>((resolve) => { followUpResolver = resolve; });
  }

  try {
    await runTurn(opts.prompt);
    while (!aborted) {
      const text = await nextFollowUp();
      if (text === null) break;
      await runTurn(text);
    }
  } finally {
    clearInterval(elapsedTimer);
    process.off("SIGINT", sigintHandler);
    cam.send("StatusUpdate", { segments: { phase: "idle", elapsed: formatElapsed(Math.floor((Date.now() - sessionStartMs) / 1000)) } });
    cam.send("SessionEnded", {});
    await cam.close().catch(() => {});
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
      encoding: "utf8", timeout: 200,
    }).trim();
    return out || "—";
  } catch {
    return "—";
  }
}
