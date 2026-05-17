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
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { mount } from "camouflage";
import type { CamouflageHandle } from "camouflage";
import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { KimiApiError, isKillSwitchError, humanizeCloudflareError } from "./util/errors.js";
import { BUILTIN_COMMANDS } from "./commands/builtins.js";
import { selectList } from "camouflage";
import { listSessions, loadSession, addCheckpoint } from "./sessions.js";
import { summarizeMessagesViaLlm } from "./agent/llm-summarize.js";
import { buildWelcome } from "./ui/greetings.js";
import { themeList, resolveTheme } from "./ui/theme.js";
import { checkForUpdate } from "./util/update-check.js";
import { calculateCost } from "./pricing.js";

export interface UiModeOpts {
  accountId: string;
  apiToken: string;
  model: string;
  /** Initial prompt. When omitted, the renderer boots to an empty input
   *  box and the user's first keystroke starts the conversation. */
  prompt?: string;
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

/** Slash commands registered with the Camouflage renderer's slash picker.
 *  We expose KimiFlare's full 31-command catalog (from src/commands/builtins.ts)
 *  so the `/` picker shows everything the user expects. The dispatcher
 *  below handles the ones that work today; the rest toast back
 *  "not yet wired" until their handlers land (tracked in PR #474). */
const SLASH_COMMANDS = BUILTIN_COMMANDS.map((c) => ({
  name: c.name,
  description: c.description,
  args_hint: c.argHint,
}));

/** Mode names KimiFlare supports + the order /mode and Shift+Tab cycle through. */
const MODES = ["edit", "plan", "auto"] as const;
type Mode = typeof MODES[number];

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
  // `turnStartMs` is set to null until the user's first message; the
  // elapsed timer ticks only during an active turn. Previously the
  // timer started counting as soon as the renderer mounted, which made
  // the status bar lie ("idle 1m 23s" before the user has typed
  // anything).
  let turnStartMs: number | null = null;
  let promptTokens = 0;
  let cachedTokens = 0;
  let completionTokens = 0;
  let sessionCostUsd = 0;
  let currentPhase: "idle" | "thinking" | "streaming" | "tool" = "idle";
  let currentMode: Mode = "edit";
  let reasoningShown = true;
  let currentThemeName = "everforest-dark";
  const branch = tryGitBranch();
  let currentSessionFilePath: string | null = null;

  cam.send("SessionStarted", {});
  cam.send("StatusUpdate", {
    segments: { mode: currentMode, phase: currentPhase, branch, cost: "$0.00" },
  });
  // Register slash commands with the renderer so the `/` picker lights up.
  cam.send("SlashCommandsRegistered", { commands: SLASH_COMMANDS });

  // Welcome banner — mirrors src/ui/welcome.tsx. Shown once at startup so
  // the user gets the same "Good morning! Type / for commands" greeting
  // they had under the Ink TUI.
  {
    const now = new Date();
    const { headline } = buildWelcome({ hour: now.getHours(), day: now.getDay() });
    cam.send("ShowKeyValueView", {
      id: "welcome",
      title: headline,
      items: [{ label: "tip", value: "Type / for commands, @ to mention a file, Shift+Tab to cycle modes" }],
    });
  }
  // @-mention candidates from cwd (files only, max 200, skip dot dirs).
  void registerMentions(cam).catch(() => { /* best-effort */ });

  const setPhase = (next: typeof currentPhase): void => {
    if (next === currentPhase) return;
    currentPhase = next;
    cam.send("StatusUpdate", { segments: { phase: next } });
  };

  const setMode = (next: Mode): void => {
    if (next === currentMode) return;
    currentMode = next;
    cam.send("StatusUpdate", { segments: { mode: next } });
    cam.send("ShowToast", { text: `mode: ${next}`, kind: "info", ttl_ms: 1200 });
  };

  const setTokens = (prompt: number, cached: number, completion?: number): void => {
    const completionNext = completion ?? completionTokens;
    if (
      prompt === promptTokens
      && cached === cachedTokens
      && completionNext === completionTokens
    ) return;
    promptTokens = prompt;
    cachedTokens = cached;
    completionTokens = completionNext;
    const txt = cached > 0
      ? `in ${formatK(prompt)} (${formatK(cached)} cached)`
      : `in ${formatK(prompt)}`;
    // Re-derive cost. We treat the latest prompt/completion totals as the
    // turn's full usage — calculateCost is additive across turns via
    // sessionCostUsd which we bump at onUsageFinal time.
    cam.send("StatusUpdate", { segments: { tokens: txt, cost: formatUsd(sessionCostUsd) } });
  };

  const elapsedTimer = setInterval(() => {
    if (turnStartMs === null) return; // idle — no tick
    const secs = Math.floor((Date.now() - turnStartMs) / 1000);
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
      // Visible confirmation that the prompt was queued — otherwise it
      // looks like nothing happened while a turn is still in flight.
      cam.send("ShowToast", {
        text: `queued (${followUpQueue.length} pending) — will run after current turn`,
        kind: "info",
        ttl_ms: 1800,
      });
    }
  });

  // Shift+Tab / Tab cycles edit → plan → auto (and back).
  cam.on("modeChangeRequested", ({ direction }: { direction: "next" | "prev" }) => {
    const idx = MODES.indexOf(currentMode);
    const len = MODES.length;
    const nextIdx = direction === "prev"
      ? (idx - 1 + len) % len
      : (idx + 1) % len;
    setMode(MODES[nextIdx] ?? "edit");
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

  // Per-turn abort controller; recreated at the top of runTurn() so
  // cancelling one turn doesn't prevent the next from running. Also
  // referenced by the cancelRequested handler below + the SIGINT
  // handler (which still triggers a global abort + aborted flag for
  // shutdown).
  let currentController: AbortController | null = null;
  const sigintHandler = () => { aborted = true; currentController?.abort(); };
  process.on("SIGINT", sigintHandler);

  // Camouflage user pressed Ctrl+C or Esc → interrupt the current turn.
  // The TUI handles the keystroke and emits this; we abort the
  // controller. Doesn't set aborted=true so the multi-turn loop
  // continues — the user can submit a new prompt right after.
  cam.on("cancelRequested", () => {
    if (currentController) {
      currentController.abort();
      cam.send("ShowToast", { text: "turn interrupted", kind: "info", ttl_ms: 1500 });
    }
  });

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
    // Start the elapsed timer for this turn; reset at end (in the
    // outer finally for the last turn, or implicitly when the next
    // runTurn re-stamps it).
    turnStartMs = Date.now();
    cam.send("StatusUpdate", { segments: { elapsed: "0s" } });
    // Per-turn abort controller. The cancelRequested handler from the
    // renderer (Ctrl+C / Esc) calls currentController.abort(); each new
    // turn starts with a fresh controller so an interrupt of the
    // previous turn doesn't poison the next.
    currentController = new AbortController();

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
        signal: currentController.signal,
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
            const completion = usage.completion_tokens ?? 0;
            const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
            const cost = calculateCost(usage.prompt_tokens, completion, cached);
            sessionCostUsd += cost.total;
            setTokens(usage.prompt_tokens, cached, completion);
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

  /** Intercept slash-prefixed input. Returns true if handled (skip agent
   *  loop); false otherwise (forward to runTurn). Async so handlers that
   *  drive modal overlays (selectList → renderer → response) can await
   *  the user's pick before returning. */
  async function handleSlashCommand(text: string): Promise<boolean> {
    if (!text.startsWith("/")) return false;
    const raw = text.slice(1).trim();
    const [name, ...rest] = raw.split(/\s+/);
    const args = rest.join(" ").trim();
    switch (name) {
      case "quit":
      case "exit":
        cam.send("ShowToast", { text: "exiting…", kind: "info", ttl_ms: 600 });
        aborted = true;
        return true;
      case "help":
        cam.send("ShowKeyValueView", {
          id: `help-${Date.now()}`,
          title: "slash commands",
          items: SLASH_COMMANDS.map((c) => ({ label: `/${c.name}`, value: c.description })),
        });
        return true;
      case "edit":
      case "plan":
      case "auto":
        setMode(name as Mode);
        return true;
      case "mode":
        if (args && (MODES as readonly string[]).includes(args)) {
          setMode(args as Mode);
        } else {
          const idx = MODES.indexOf(currentMode);
          const next = MODES[(idx + 1) % MODES.length] ?? "edit";
          setMode(next);
        }
        return true;
      case "model":
        cam.send("ShowToast", { text: `model: ${opts.model}`, kind: "info", ttl_ms: 2500 });
        return true;
      case "clear": {
        // Reset conversation: keep only the leading system prompt(s),
        // drop everything else. Renderer wipes the visible transcript.
        const systemMessages = messages.filter((m) => m.role === "system");
        messages.length = 0;
        messages.push(...systemMessages);
        sessionCostUsd = 0;
        promptTokens = 0;
        cachedTokens = 0;
        completionTokens = 0;
        cam.send("TranscriptCleared", {});
        cam.send("StatusUpdate", {
          segments: { tokens: "in 0", cost: "$0.00", elapsed: "" },
        });
        return true;
      }
      case "compact": {
        if (currentPhase !== "idle") {
          cam.send("ShowToast", { text: "can't compact while model is running", kind: "warn", ttl_ms: 2500 });
          return true;
        }
        cam.send("ShowToast", { text: "compacting…", kind: "info", ttl_ms: 1500 });
        try {
          const result = await summarizeMessagesViaLlm({
            accountId: opts.accountId,
            apiToken: opts.apiToken,
            model: opts.model,
            messages,
            gateway: gatewayFromOpts(opts),
          });
          if (result.replacedCount === 0) {
            cam.send("ShowToast", { text: "nothing to compact yet", kind: "info", ttl_ms: 2000 });
          } else {
            messages.length = 0;
            messages.push(...result.newMessages);
            cam.send("SessionCompacted", {});
            cam.send("ShowToast", {
              text: `compacted ${result.replacedCount} messages`,
              kind: "success",
              ttl_ms: 2500,
            });
          }
        } catch (err) {
          cam.send("ShowToast", {
            text: `compact failed: ${err instanceof Error ? err.message : String(err)}`,
            kind: "error", ttl_ms: 3000,
          });
        }
        return true;
      }
      case "resume": {
        const sessions = await listSessions(30, process.cwd());
        if (sessions.length === 0) {
          cam.send("ShowToast", { text: "no saved sessions for this cwd", kind: "info", ttl_ms: 2500 });
          return true;
        }
        const choice = await selectList(cam, {
          id: `resume-${Date.now()}`,
          prompt: "Resume which session?",
          options: sessions.map((s) => ({
            value: s.filePath,
            label: `${s.title ?? s.firstPrompt} (${s.messageCount} msgs)`,
            description: s.updatedAt.slice(0, 19).replace("T", " "),
          })),
          allow_filter: true,
          allow_cancel: true,
        });
        if (choice.cancelled || !choice.value) return true;
        try {
          const file = await loadSession(choice.value);
          messages.length = 0;
          messages.push(...file.messages);
          currentSessionFilePath = choice.value;
          cam.send("TranscriptCleared", {});
          cam.send("ShowToast", {
            text: `resumed: ${file.title ?? file.id} (${file.messages.length} msgs restored, not replayed visually)`,
            kind: "success", ttl_ms: 3500,
          });
        } catch (err) {
          cam.send("ShowToast", {
            text: `resume failed: ${err instanceof Error ? err.message : String(err)}`,
            kind: "error", ttl_ms: 3000,
          });
        }
        return true;
      }
      case "checkpoint": {
        if (!currentSessionFilePath) {
          cam.send("ShowToast", { text: "no active saved session — type at least one message", kind: "warn", ttl_ms: 2800 });
          return true;
        }
        const label = args || `checkpoint at turn ${messages.length}`;
        try {
          await addCheckpoint(currentSessionFilePath, {
            id: `cp-${Date.now()}`,
            label,
            turnIndex: messages.length,
            timestamp: new Date().toISOString(),
          });
          cam.send("ShowToast", { text: `checkpoint saved: ${label}`, kind: "success", ttl_ms: 2500 });
        } catch (err) {
          cam.send("ShowToast", { text: `checkpoint failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
      case "checkpoints": {
        if (!currentSessionFilePath) {
          cam.send("ShowToast", { text: "no saved session loaded", kind: "warn", ttl_ms: 2500 });
          return true;
        }
        try {
          const file = await loadSession(currentSessionFilePath);
          const cps = file.checkpoints ?? [];
          if (cps.length === 0) {
            cam.send("ShowToast", { text: "no checkpoints in this session", kind: "info", ttl_ms: 2500 });
            return true;
          }
          cam.send("ShowKeyValueView", {
            id: `cps-${Date.now()}`,
            title: `checkpoints (${cps.length})`,
            items: cps.map((c) => ({
              label: c.label,
              value: `turn ${c.turnIndex} · ${c.timestamp.slice(0, 19).replace("T", " ")}`,
            })),
          });
        } catch (err) {
          cam.send("ShowToast", { text: `checkpoints failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
      case "theme": {
        const themes = themeList();
        if (themes.length === 0) {
          cam.send("ShowToast", { text: "no themes registered", kind: "warn", ttl_ms: 2000 });
          return true;
        }
        const choice = await selectList(cam, {
          id: `theme-${Date.now()}`,
          prompt: "Pick a theme (note: applied to Ink only; Camouflage TUI ignores)",
          options: themes.map((t) => ({
            value: t.name,
            label: t.name,
            description: "",
          })),
          default: currentThemeName,
          allow_filter: true,
          allow_cancel: true,
        });
        if (!choice.cancelled && choice.value) {
          currentThemeName = choice.value;
          resolveTheme(choice.value); // validate; throws if missing
          cam.send("ShowToast", { text: `theme: ${choice.value} (restart to apply globally)`, kind: "info", ttl_ms: 2500 });
        }
        return true;
      }
      case "cost":
        cam.send("ShowKeyValueView", {
          id: `cost-${Date.now()}`,
          title: "session cost",
          items: [
            { label: "model", value: opts.model },
            { label: "prompt tokens", value: String(promptTokens) },
            { label: "cached prompt", value: String(cachedTokens) },
            { label: "completion tokens", value: String(completionTokens) },
            { label: "total $", value: formatUsd(sessionCostUsd) },
            ...(opts.cloudMode ? [{ label: "billing", value: "Cloud mode (no out-of-pocket)" }] : []),
          ],
        });
        return true;
      case "reasoning":
        reasoningShown = !reasoningShown;
        cam.send("ShowToast", {
          text: `reasoning: ${reasoningShown ? "shown" : "hidden"} (display-only in Camouflage TUI)`,
          kind: "info", ttl_ms: 2000,
        });
        return true;
      case "shell":
        cam.send("ShowToast", {
          text: args ? `shell: ${args} (config write not yet wired in Camouflage UI)` : "shell: auto (default)",
          kind: "info", ttl_ms: 2500,
        });
        return true;
      case "update": {
        cam.send("ShowToast", { text: "checking for updates…", kind: "info", ttl_ms: 1500 });
        try {
          const r = await checkForUpdate(true);
          if (r.hasUpdate && r.latestVersion) {
            cam.send("ShowToast", {
              text: `update available: ${r.localVersion} → ${r.latestVersion}. Run: npm i -g kimiflare@latest`,
              kind: "success", ttl_ms: 5000,
            });
          } else {
            cam.send("ShowToast", { text: `up to date (${r.localVersion ?? "unknown"})`, kind: "info", ttl_ms: 2500 });
          }
        } catch (err) {
          cam.send("ShowToast", { text: `update check failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
      case "init":
      case "remote":
      case "memory":
      case "gateway":
      case "mcp":
      case "lsp":
      case "hooks":
      case "skills":
      case "command":
      case "hello":
      case "inbox":
      case "report":
      case "logout":
        // Not yet ported. Each of these is a sizeable subsystem with its
        // own React modal in the Ink UI; porting them properly needs a
        // Wizard/Form integration per command.
        cam.send("ShowToast", {
          text: `/${name}: not yet wired in Camouflage UI (use --ui ink for now)`,
          kind: "warn", ttl_ms: 2800,
        });
        return true;
      case "":
        return true;
      default:
        cam.send("ShowToast", { text: `unknown command: /${name}`, kind: "error", ttl_ms: 2500 });
        return true;
    }
  }

  try {
    // Initial turn: only run if a prompt was supplied via -p. Otherwise
    // boot to an empty input box and wait for the user's first input.
    if (opts.prompt && opts.prompt.length > 0) {
      if (!(await handleSlashCommand(opts.prompt))) {
        await runTurn(opts.prompt);
      }
    }
    while (!aborted) {
      const text = await nextFollowUp();
      if (text === null) break;
      if (await handleSlashCommand(text)) continue;
      await runTurn(text);
    }
  } finally {
    clearInterval(elapsedTimer);
    process.off("SIGINT", sigintHandler);
    // Final status sweep. cam.send() is forgiving (no-op after close)
    // so this is safe even if the user quit the renderer.
    cam.send("StatusUpdate", { segments: { phase: "idle" } });
    cam.send("SessionEnded", {});
    await cam.close().catch(() => {});
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

/** @-mention candidate registration. Walks cwd one level deep (skipping
 *  dot-prefixed entries + node_modules + common build dirs) and registers
 *  up to 200 file paths. Best-effort — failures are silent. */
async function registerMentions(cam: CamouflageHandle): Promise<void> {
  const SKIP = new Set(["node_modules", "dist", "build", "target", ".git", ".next", ".cache"]);
  const cwd = process.cwd();
  const collected: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3 || collected.length >= 200) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (collected.length >= 200) return;
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        collected.push(relative(cwd, full));
      }
    }
  }
  await walk(cwd, 0);
  if (collected.length === 0) return;
  cam.send("MentionCandidatesRegistered", {
    candidates: collected.map((p) => ({ token: p, kind: "file" })),
  });
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
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
