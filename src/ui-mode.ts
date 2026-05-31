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
 *     kimiflare --ui camouflage -p "do X"   (opt-in; default is --ui ink)
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

import { execSync, spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { platform } from "node:os";
/** File logger gated by KIMIFLARE_EVENT_LOG. One JSON object per line. */
const KIMI_LOG_PATH = process.env.KIMIFLARE_EVENT_LOG ?? null;
if (KIMI_LOG_PATH) {
  try { openSync(KIMI_LOG_PATH, "a"); } catch { /* best-effort */ }
}
function kimiLog(payload: Record<string, unknown>): void {
  if (!KIMI_LOG_PATH) return;
  try {
    const line = JSON.stringify({ ts: Date.now() / 1000, ...payload }) + "\n";
    appendFileSync(KIMI_LOG_PATH, line);
  } catch { /* swallow — diagnostic only */ }
}
import type { CamouflageHandle } from "camouflage-tui";
import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import { TurnSupervisor } from "./agent/supervisor.js";
import { classifyIntent } from "./intent/classify.js";
import { deployCommute, teardownCommute, findExistingCommuteWorkers } from "./remote/deploy-commute.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { KimiApiError, humanizeCloudflareError } from "./util/errors.js";
import { BUILTIN_COMMANDS } from "./commands/builtins.js";

async function requireCamouflage(): Promise<typeof import("camouflage-tui")> {
  try {
    return await import("camouflage-tui");
  } catch {
    console.error(
      "kimiflare: the 'camouflage-tui' package is required for the Camouflage UI.\n" +
        "Install it with:\n" +
        "  npm install -g camouflage-tui\n" +
        "Or switch to the default Ink UI:\n" +
        "  kimiflare --ui ink",
    );
    process.exit(2);
  }
}

let _loaded = false;
let mount: Awaited<ReturnType<typeof requireCamouflage>>["mount"];
let selectList: Awaited<ReturnType<typeof requireCamouflage>>["selectList"];
let form: Awaited<ReturnType<typeof requireCamouflage>>["form"];
let confirm: Awaited<ReturnType<typeof requireCamouflage>>["confirm"];

async function loadCamouflage() {
  if (_loaded) return;
  const mod = await requireCamouflage();
  mount = mod.mount;
  selectList = mod.selectList;
  form = mod.form;
  confirm = mod.confirm;
  _loaded = true;
}
import { listSessions, loadSession, addCheckpoint, loadSessionFromCheckpoint } from "./sessions.js";
import { summarizeMessagesViaLlm } from "./agent/llm-summarize.js";
import { buildWelcome } from "./ui/greetings.js";
import { themeList, resolveTheme } from "./ui/theme.js";
import { checkForUpdate } from "./util/update-check.js";
import { calculateCost } from "./pricing.js";
import { loadConfig, saveConfig, DEFAULT_MODEL } from "./config.js";
import type { KimiConfig } from "./config.js";
import { listGateways, createGateway, AiGatewayError } from "./cloud/ai-gateway-api.js";
import { listAllSkills, setSkillEnabled, deleteSkill } from "./skills/manager.js";
import { loadCustomCommands } from "./commands/loader.js";
import { saveCustomCommand, deleteCustomCommand } from "./commands/save.js";
import { listRemoteSessions } from "./remote/session-store.js";
import { getRemoteStatus, cancelRemoteSession } from "./remote/worker-client.js";
import { BUILTIN_COMMAND_NAMES } from "./commands/builtins.js";
import type { CustomCommand } from "./commands/types.js";
import type { LspServerConfig } from "./config.js";
import { loadHooksSettings, globalSettingsPath, projectSettingsPath, setHookEnabled } from "./hooks/settings.js";
import { HOOK_EVENTS } from "./hooks/types.js";
import { buildInitPrompt } from "./init/context-generator.js";
import { isBlockedInPlanMode, isReadOnlyBash } from "./mode.js";

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
  aiGatewayId?: string;
  /** Optional path to the camouflage-tui binary. Defaults to PATH lookup. */
  camouflageBin?: string;
  /** Optional multi-line ANSI text (e.g. the CLI logo) to pin above the
   *  transcript until the user submits their first prompt. Sent as a
   *  `Splash` event right after the renderer mounts. */
  splash?: string;
}

/** Slash commands registered with the Camouflage renderer's slash picker.
 *  We expose KimiFlare's full 31-command catalog (from src/commands/builtins.ts)
 *  so the `/` picker shows everything the user expects. The dispatcher
 *  below handles the ones that work today; the rest toast back
 *  "not yet wired" until their handlers land (tracked in PR #474). */
/** Builtin slash commands. Custom commands (project/global) are merged
 *  in at startup via registerSlashCommands() so the picker shows
 *  shadowing badges. */
const BUILTIN_SLASH_COMMANDS = BUILTIN_COMMANDS.map((c) => ({
  name: c.name,
  description: c.description,
  args_hint: c.argHint,
  source: "builtin" as const,
}));

/** Mode names KimiFlare supports + the order /mode and Shift+Tab cycle through.
 *  `multi-agent-experimental` only appears in the cycle when enabled via
 *  config (`multiAgentEnabled`) or the KIMIFLARE_MULTI_AGENT_ENABLED env var. */
const MODES = ["edit", "plan", "auto", "multi-agent-experimental"] as const;
type Mode = typeof MODES[number];

/** Short status-bar label for a mode (the experimental name is long). */
function modeLabel(m: Mode): string {
  return m === "multi-agent-experimental" ? "multi-agent" : m;
}

function gatewayFromOpts(opts: UiModeOpts): AiGatewayOptions | undefined {
  if (!opts.aiGatewayId) return undefined;
  return { id: opts.aiGatewayId };
}

export async function runUiMode(opts: UiModeOpts): Promise<void> {
  await loadCamouflage();
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

  // Wrap cam.send so every outbound event lands in the log too. Useful
  // for debugging "I didn't see X" — we can confirm whether kimiflare
  // actually emitted it and what the payload looked like.
  if (KIMI_LOG_PATH) {
    const origSend = cam.send.bind(cam);
    cam.send = ((event_type: Parameters<typeof origSend>[0], payload?: Parameters<typeof origSend>[1]) => {
      try {
        kimiLog({
          dir: "out",
          event_type: event_type as unknown as string,
          payload_preview: JSON.stringify(payload ?? {}).slice(0, 160),
        });
      } catch { /* swallow */ }
      return origSend(event_type, payload as never);
    }) as typeof cam.send;
  }
  kimiLog({ dir: "boot", note: "ui-mode mounted" });

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

  // Multi-agent (experimental): the mode is hidden from the cycle unless
  // explicitly enabled. We honor the env var directly in addition to the
  // loaded config, since loadConfig() ignores the env var when a persisted
  // config file exists.
  const startupCfg = await loadConfig().catch(() => null);
  let multiAgentEnabled =
    (startupCfg?.multiAgentEnabled ?? false) ||
    /^(1|true|yes|on)$/i.test(process.env.KIMIFLARE_MULTI_AGENT_ENABLED ?? "");
  const multiAgentSupervisor = new TurnSupervisor();
  const availableModes = (): Mode[] =>
    multiAgentEnabled ? [...MODES] : MODES.filter((m) => m !== "multi-agent-experimental");

  if (opts.splash && opts.splash.length > 0) {
    cam.send("Splash", { text: opts.splash });
  }
  cam.send("SessionStarted", {});
  cam.send("StatusUpdate", {
    segments: { mode: currentMode, phase: currentPhase, branch, cost: "$0.00" },
  });
  // Register slash commands (builtin + project + global) with the renderer
  // so the `/` picker lights up. Custom commands carry a source badge
  // that surfaces in the picker so the user can tell a override apart.
  await registerSlashCommands();
  async function registerSlashCommands(): Promise<void> {
    let customs: { name: string; description?: string; source?: string }[] = [];
    try {
      const { commands } = await loadCustomCommands(process.cwd());
      customs = commands;
    } catch { /* swallow — picker still works with builtins */ }
    const combined = [
      ...BUILTIN_SLASH_COMMANDS,
      ...customs.map((c) => ({
        name: c.name,
        description: c.description ?? "",
        args_hint: undefined,
        source: c.source ?? "project",
      })),
    ];
    cam.send("SlashCommandsRegistered", { commands: combined });
  }

  // Background update check (mirrors Ink's persistent "update available"
  // banner). Cached result is fine — no extra network on warm starts.
  void (async () => {
    try {
      const r = await checkForUpdate();
      if (r.hasUpdate && r.latestVersion) {
        cam.send("ShowToast", {
          text: `update available: ${r.localVersion} → ${r.latestVersion}  ·  run /update`,
          kind: "info",
          ttl_ms: 6000,
        });
      }
    } catch {
      /* offline / DNS / 503 — silent, retried next startup */
    }
  })();

  // Experimental-UI warning — mirrors the stderr notice in index.tsx so the
  // user still sees it after Camouflage takes the alt-screen and the
  // scrollback warning becomes invisible. Long TTL so it hangs around long
  // enough to read; user can dismiss with Esc.
  cam.send("ShowToast", {
    text: "EXPERIMENTAL — switch back any time with `kimiflare --ui ink`",
    kind: "warn",
    ttl_ms: 10000,
  });
  // Welcome banner — mirrors src/ui/welcome.tsx. Shown once at startup
  // as a non-blocking toast (NOT a modal — modals require Esc to
  // dismiss, which is the wrong first impression).
  {
    const now = new Date();
    const { headline } = buildWelcome({ hour: now.getHours(), day: now.getDay() });
    cam.send("ShowToast", {
      text: `${headline}  Type / for commands, @ for files, Shift+Tab for modes.`,
      kind: "info",
      ttl_ms: 5000,
    });
  }
  // @-mention candidates from cwd. Recent files (the ones the user has
  // referenced this session) get a "recent" flag and bubble to the top
  // of the picker — mirrors Ink's FilePicker recentFilesRef.
  const recentMentions = new Set<string>();
  void registerMentions(cam, recentMentions).catch(() => { /* best-effort */ });

  const setPhase = (next: typeof currentPhase): void => {
    if (next === currentPhase) return;
    currentPhase = next;
    cam.send("StatusUpdate", { segments: { phase: next } });
  };

  const setMode = (next: Mode): void => {
    if (next === currentMode) return;
    currentMode = next;
    cam.send("StatusUpdate", { segments: { mode: modeLabel(next) } });
    cam.send("ShowToast", { text: `mode: ${modeLabel(next)}`, kind: "info", ttl_ms: 1200 });
    // Auto-open the /multi-agent settings menu when the user switches to
    // multi-agent without an endpoint configured (same fallback chain the
    // supervisor uses). Otherwise they'd Shift-Tab in, send a heavy prompt,
    // and only discover the missing config when the spawn errors out.
    if (next === "multi-agent-experimental") {
      void loadConfig().then((c) => {
        const hasEndpoint = !!(c?.workerEndpoint || c?.remoteWorkerUrl);
        if (!hasEndpoint) {
          cam.send("ShowToast", {
            text: "multi-agent needs setup — opening settings…",
            kind: "info",
            ttl_ms: 1500,
          });
          void handleMultiAgentCommand(undefined);
        }
      }).catch(() => {});
    }
  };

  /** /multi-agent — proper settings TUI.
   *  Looping menu: each option shows its current value; selecting one drills
   *  in (toggle picker for booleans, text/password form for strings); ESC at
   *  any point exits. */
  async function handleMultiAgentCommand(_args: string | undefined): Promise<void> {
    while (true) {
      const cfg = (await loadConfig().catch(() => null)) ?? {
        accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model,
      };
      const fmtBool = (v: boolean | undefined) => (v ? "✓ on" : "✗ off");
      const fmtAutoStr = (v: string | undefined) => (v && v.length > 0 ? v : "(auto-managed by Set up)");
      const fmtAutoSecret = (v: string | undefined) => (v && v.length > 0 ? "(set)" : "(auto-managed by Set up)");
      // Same Commute worker hosts both /remote sessions and /multi-agent; if
      // the user already ran /remote setup we reuse those values so they
      // don't have to enter the endpoint twice.
      const effectiveEndpoint = cfg.workerEndpoint ?? cfg.remoteWorkerUrl;
      const effectiveApiKey = cfg.workerApiKey ?? cfg.remoteAuthSecret;
      const endpointFromRemote = !cfg.workerEndpoint && !!cfg.remoteWorkerUrl;
      const apiKeyFromRemote = !cfg.workerApiKey && !!cfg.remoteAuthSecret;

      const main = await selectList(cam, {
        id: `ma-main-${Date.now()}`,
        prompt: "Multi-agent settings  ·  ↑↓ pick · Enter edit · Esc done",
        options: [
          { value: "enabled",     label: `Multi-agent mode               ${fmtBool(cfg.multiAgentEnabled)}` },
          { value: "endpoint",    label: `Endpoint                       ${fmtAutoStr(effectiveEndpoint)}${endpointFromRemote ? "  (from /remote)" : ""}` },
          { value: "workerSecret",label: `Worker secret                  ${fmtAutoSecret(effectiveApiKey)}${apiKeyFromRemote ? " (from /remote)" : ""}` },
          { value: "autoExecute", label: `Auto-implement after research  ${fmtBool(cfg.autoExecute)}` },
          { value: "deploy",      label: `→ Set up (deploys to your Cloudflare account, one-time)` },
          ...(effectiveEndpoint
            ? [{ value: "teardown", label: `→ Tear down (delete from your Cloudflare account)` }]
            : []),
          { value: "done",        label: "Done" },
        ],
        allow_cancel: true,
      });
      if (main.cancelled || main.value === "done") return;

      if (main.value === "teardown") {
        const confirm = await selectList(cam, {
          id: `ma-teardown-${Date.now()}`,
          prompt: "Tear down multi-agent? Deletes the Worker + KV namespace from your Cloudflare account.",
          options: [
            { value: "no",  label: "Cancel" },
            { value: "yes", label: "Yes, tear down" },
          ],
          default: "no",
          allow_cancel: true,
        });
        if (confirm.cancelled || confirm.value !== "yes") continue;
        const sid = `s${++streamCounter}`;
        cam.send("AssistantStreamStarted", { stream_id: sid });
        cam.send("AssistantTokenDelta", { stream_id: sid, token: "# Tearing down multi-agent\n\n" });
        try {
          for await (const step of teardownCommute()) {
            const prefix = step.error ? "✗ " : (step.done || step.ok) ? "✓ " : "· ";
            cam.send("AssistantTokenDelta", { stream_id: sid, token: `${prefix}${step.message}\n` });
            if (step.error) break;
          }
        } catch (err) {
          cam.send("AssistantTokenDelta", { stream_id: sid, token: `\n✗ tear-down aborted: ${err instanceof Error ? err.message : String(err)}\n` });
        }
        cam.send("AssistantTokenDelta", { stream_id: sid, token: "\n_Re-open with /multi-agent if you'd like to set up again._\n" });
        cam.send("AssistantMessageCompleted", { stream_id: sid });
        // If we tore down, mode should drop back to edit since multi-agent
        // is now disabled in cfg.
        if (currentMode === "multi-agent-experimental") setMode("edit");
        multiAgentEnabled = false;
        // Exit the menu so the streamed log is visible in the transcript.
        return;
      }

      if (main.value === "deploy") {
        // Before we deploy, look for existing kimiflare-* Workers on the
        // user's account. If we find any, ask whether to reuse one or
        // create the fresh kimiflare-multi-agent default — avoids silently
        // overwriting a Worker that belongs to a different project.
        cam.send("ShowToast", { text: "scanning your Cloudflare account…", kind: "info", ttl_ms: 1500 });
        let chosenName: string | undefined;
        const existing = await findExistingCommuteWorkers().catch(() => [] as string[]);
        if (existing.length > 0) {
          const pick = await selectList(cam, {
            id: `ma-pick-${Date.now()}`,
            prompt: `Found existing Worker${existing.length === 1 ? "" : "s"} on your account. Which one to deploy to?`,
            options: [
              ...existing.map((n) => ({
                value: n,
                label: `Use existing: ${n}${n === "kimiflare-commute" ? "  (⚠  overwrites /remote infra)" : ""}`,
              })),
              { value: "__new__", label: "Create new: kimiflare-multi-agent  (recommended — isolated)" },
            ],
            default: "__new__",
            allow_cancel: true,
          });
          if (pick.cancelled) continue;
          chosenName = pick.value === "__new__" ? undefined : pick.value;
        }

        cam.send("ShowToast", { text: "deploying… see progress in the transcript", kind: "info", ttl_ms: 2000 });
        const sid = `s${++streamCounter}`;
        cam.send("AssistantStreamStarted", { stream_id: sid });
        cam.send("AssistantTokenDelta", { stream_id: sid, token: `# Setting up multi-agent on ${chosenName ?? "kimiflare-multi-agent"}\n\n` });
        try {
          for await (const step of deployCommute({ workerName: chosenName })) {
            const prefix = step.error ? "✗ " : (step.done || step.ok) ? "✓ " : "· ";
            cam.send("AssistantTokenDelta", { stream_id: sid, token: `${prefix}${step.message}\n` });
            if (step.error) break;
          }
        } catch (err) {
          cam.send("AssistantTokenDelta", { stream_id: sid, token: `\n✗ deploy aborted: ${err instanceof Error ? err.message : String(err)}\n` });
        }
        cam.send("AssistantTokenDelta", { stream_id: sid, token: "\n_Re-open with /multi-agent when ready._\n" });
        cam.send("AssistantMessageCompleted", { stream_id: sid });
        // Exit the menu so the streamed log is visible in the transcript
        // (the next selectList would otherwise cover it).
        return;
      }

      if (main.value === "enabled") {
        const pick = await selectList(cam, {
          id: `ma-enabled-${Date.now()}`,
          prompt: "Enable multi-agent in the Shift-Tab cycle?",
          options: [
            { value: "on",  label: "✓ Enable" },
            { value: "off", label: "✗ Disable" },
          ],
          default: cfg.multiAgentEnabled ? "on" : "off",
          allow_cancel: true,
        });
        if (pick.cancelled) continue;
        const next = { ...cfg, multiAgentEnabled: pick.value === "on" };
        await saveConfig(next);
        multiAgentEnabled = !!next.multiAgentEnabled;
        if (!next.multiAgentEnabled && currentMode === "multi-agent-experimental") setMode("edit");
        cam.send("ShowToast", { text: `multi-agent ${next.multiAgentEnabled ? "enabled" : "disabled"}`, kind: "success", ttl_ms: 1500 });
        if (next.multiAgentEnabled && !cfg.workerEndpoint) {
          cam.send("ShowToast", { text: "tip: set an endpoint next (pick Set up to deploy one)", kind: "info", ttl_ms: 2500 });
        }
        continue;
      }

      if (main.value === "autoExecute") {
        const pick = await selectList(cam, {
          id: `ma-autoexec-${Date.now()}`,
          prompt: "After research, auto-spawn an executor that implements + opens a PR?",
          options: [
            { value: "on",  label: "✓ On  — auto-execute (creates real PRs!)" },
            { value: "off", label: "✗ Off — research only" },
          ],
          default: cfg.autoExecute ? "on" : "off",
          allow_cancel: true,
        });
        if (pick.cancelled) continue;
        await saveConfig({ ...cfg, autoExecute: pick.value === "on" });
        cam.send("ShowToast", { text: `auto-execute ${pick.value === "on" ? "on" : "off"}`, kind: "success", ttl_ms: 1500 });
        continue;
      }

      // String fields: open a single-field form with the current value pre-filled.
      type StringFieldKey = "endpoint" | "workerSecret";
      const stringField = ((): { key: keyof KimiConfig; label: string; placeholder?: string; kind?: "password"; current: string } | null => {
        const k = main.value as StringFieldKey;
        if (k === "endpoint")     return { key: "workerEndpoint", label: "Endpoint URL",                              placeholder: "https://<your-worker>.workers.dev",  current: cfg.workerEndpoint ?? "" };
        if (k === "workerSecret") return { key: "workerApiKey",   label: "Worker secret (blank to clear)",            kind: "password",                                  current: cfg.workerApiKey  ?? "" };
        return null;
      })();
      if (!stringField) continue;
      const f = await form(cam, {
        id: `ma-${main.value}-${Date.now()}`,
        title: stringField.label,
        fields: [
          { name: "value", label: stringField.label, default: stringField.current, placeholder: stringField.placeholder, kind: stringField.kind },
        ],
        allow_cancel: true,
      });
      if (f.cancelled || !f.values) continue;
      const raw = (f.values.value ?? "").trim();
      const next: KimiConfig = { ...cfg, [stringField.key]: raw || undefined };
      await saveConfig(next);
      cam.send("ShowToast", { text: `${main.value} ${raw ? "updated" : "cleared"}`, kind: "success", ttl_ms: 1500 });
    }
  }

  // Default context-window heuristic for the /compact recommended banner.
  // Override via opts.maxInputTokens; otherwise fall back to a Kimi-default
  // ~200k window. Matches Ink's app.tsx which uses prompt / contextLimit.
  const CTX_LIMIT = opts.maxInputTokens && opts.maxInputTokens > 0 ? opts.maxInputTokens : 200_000;
  let lastCompactWarn = false;
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
    const segments: Record<string, string> = {
      tokens: txt,
      cost: formatUsd(sessionCostUsd),
    };
    // Surface the /compact recommended hint as a warn segment when the
    // prompt has eaten more than 80% of the context window. Toggles back
    // to empty (cleared by the renderer) when the user compacts.
    const ratio = prompt / CTX_LIMIT;
    const shouldWarn = ratio >= 0.8;
    if (shouldWarn !== lastCompactWarn) {
      segments.warn = shouldWarn ? "/compact recommended" : "";
      lastCompactWarn = shouldWarn;
    }
    cam.send("StatusUpdate", { segments });
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
    kimiLog({
      dir: "in",
      event_type: "userInput",
      text_len: text.length,
      text_preview: text.slice(0, 80),
      followUpResolver_set: followUpResolver !== null,
      queue_depth: followUpQueue.length,
    });
    // Echo the user's message into the transcript immediately, no
    // matter whether we'll run it now or queue it behind an in-flight
    // turn. Previously runTurn was the only place that sent
    // UserMessageCreated, so queued messages were invisible until the
    // previous turn finished — users typed something, hit Enter, and
    // saw nothing.
    cam.send("UserMessageCreated", { text });
    if (followUpResolver) {
      const r = followUpResolver;
      followUpResolver = null;
      r(text);
    } else {
      followUpQueue.push(text);
      cam.send("ShowToast", {
        text: `queued (${followUpQueue.length} pending) — will run after current turn`,
        kind: "info",
        ttl_ms: 1800,
      });
    }
  });

  // Shift+Tab / Tab cycles edit → plan → auto (→ multi-agent when enabled).
  cam.on("modeChangeRequested", ({ direction }: { direction: "next" | "prev" }) => {
    const modes = availableModes();
    const idx = Math.max(0, modes.indexOf(currentMode));
    const len = modes.length;
    const nextIdx = direction === "prev"
      ? (idx - 1 + len) % len
      : (idx + 1) % len;
    setMode(modes[nextIdx] ?? "edit");
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
    const debug = !!process.env.CAMOUFLAGE_DEBUG_ESC;
    if (debug) process.stderr.write(`[adapter:esc] cancelRequested received, currentController=${currentController ? "set" : "null"}\n`);
    if (currentController) {
      currentController.abort();
      if (debug) process.stderr.write(`[adapter:esc] currentController.abort() called\n`);
      cam.send("ShowToast", { text: "turn interrupted", kind: "info", ttl_ms: 1500 });
    } else if (debug) {
      process.stderr.write(`[adapter:esc] WARN: no controller to abort — Esc had no effect on the turn\n`);
    }
  });

  const cwd = process.cwd();
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model: opts.model }) },
  ];

  let streamCounter = 0;
  let currentStreamId: string | null = null;

  // Per-turn tool-call signature counts for the "[warn] repeated" marker.
  // Cleared at the top of every runTurn so the warning resets across turns.
  const repeatedToolSignatures = new Map<string, number>();

  async function runTurn(text: string): Promise<void> {
    kimiLog({ dir: "turn", phase: "start", text_preview: text.slice(0, 80) });
    // UserMessageCreated is sent in the `userInput` handler now —
    // sending it here too would render the prompt twice for queued
    // turns. Harvest @-mentions from the submitted text into the recent set, so
    // the next time the user types @ they see those files at the top of
    // the picker (Ink parity: recentFilesRef). Cheap regex over the
    // already-validated user input.
    const before = recentMentions.size;
    for (const m of text.matchAll(/@([\w./\-]+)/g)) {
      const tok = m[1];
      if (tok && tok.length <= 200) recentMentions.add(tok);
    }
    if (recentMentions.size !== before) {
      void registerMentions(cam, recentMentions).catch(() => {});
    }
    messages.push({ role: "user", content: text });
    repeatedToolSignatures.clear();
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
      // Multi-agent (experimental) two-gate: when the mode is active AND the
      // prompt classifies as a heavy task, spawn parallel research workers
      // instead of running a normal local turn. Light/medium tasks fall
      // through to the normal turn below.
      if (currentMode === "multi-agent-experimental") {
        const classification = classifyIntent(text);
        if (classification.tier !== "heavy") {
          cam.send("ShowToast", {
            text: `multi-agent mode active, but task is ${classification.tier} — running locally`,
            kind: "info",
            ttl_ms: 2500,
          });
        } else {
          setPhase("thinking");
          cam.send("ShowToast", { text: "multi-agent mode: spawning parallel research workers…", kind: "info", ttl_ms: 2500 });
          try {
            let lastDone = -1;
            const { plan, conflicts, recommendations, prUrl, executor } = await multiAgentSupervisor.autoSpawnWorkers(
              text,
              `Current project: ${cwd}`,
              (workers) => {
                const done = workers.filter((w) => w.status === "completed" || w.status === "failed").length;
                const running = workers.filter((w) => w.status === "running").length;
                if (done !== lastDone) {
                  lastDone = done;
                  cam.send("ShowToast", { text: `workers: ${running} running · ${done}/${workers.length} done`, kind: "info", ttl_ms: 1500 });
                }
              },
            );
            // Render the synthesized plan as an assistant message so the user
            // sees the research output, and keep it in history for follow-ups.
            const sid = `s${++streamCounter}`;
            cam.send("AssistantStreamStarted", { stream_id: sid });
            cam.send("AssistantTokenDelta", { stream_id: sid, token: prUrl ? `${plan}\n\n---\nExecutor opened PR: ${prUrl}` : plan });
            cam.send("AssistantMessageCompleted", { stream_id: sid });
            messages.push({ role: "assistant", content: plan });
            if (conflicts.length > 0) {
              cam.send("ShowToast", { text: `${conflicts.length} conflict(s) resolved`, kind: "warn", ttl_ms: 3000 });
            }
            cam.send("ShowToast", { text: `synthesized ${recommendations.length} recommendation(s)`, kind: "success", ttl_ms: 3000 });
            if (executor) {
              if (executor.status === "completed" && prUrl) {
                cam.send("ShowToast", { text: `executor opened PR: ${prUrl}`, kind: "success", ttl_ms: 5000 });
              } else if (executor.status === "completed") {
                cam.send("ShowToast", { text: "executor completed (no file changes to commit)", kind: "info", ttl_ms: 3000 });
              } else {
                cam.send("ShowToast", { text: `executor failed: ${executor.error ?? "unknown"}`, kind: "error", ttl_ms: 5000 });
              }
            }
          } catch (err) {
            if (!(err instanceof Error && err.name === "AbortError")) {
              cam.send("ShowToast", { text: `multi-agent spawn failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 4000 });
            }
          }
          return;
        }
      }

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
            // Repeated-call detection (Ink ToolView "[warn] repeated"): we
            // count identical tool signatures in the current turn and
            // flag the third+ invocation. Cheap O(1) lookup; map reset
            // at the top of runTurn().
            const sig = `${call.function.name}::${call.function.arguments}`;
            const prev = repeatedToolSignatures.get(sig) ?? 0;
            repeatedToolSignatures.set(sig, prev + 1);
            cam.send("ToolExecutionStarted", {
              tool_id: call.id,
              tool: call.function.name,
              command: call.function.arguments,
              ...(prev >= 2 ? { repeated: true } : {}),
            });
          },
          onToolResult: (result) => {
            if (result.content && result.content.length > 0) {
              cam.send(result.ok ? "ToolExecutionStdout" : "ToolExecutionStderr", {
                tool_id: result.tool_call_id,
                chunk: result.content,
              });
            }
            // Map KimiFlare's ToolResult to Camouflage's ToolStatus glyph
            // set so the row prefix matches Ink: ✓/✗/■/!.
            const status =
              result.ok ? "done"
              : result.errorCode === "permission_denied"
                ? "rejected"
              : result.errorCode === "aborted"
                ? "cancelled"
              : "error";
            cam.send("ToolExecutionFinished", {
              tool_id: result.tool_call_id,
              exit_code: result.ok ? 0 : 1,
              status,
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
          // Ports LimitModal — when the agent hits its per-turn tool
          // call ceiling, show a Confirm dialog and let the user keep
          // going or stop the turn.
          onToolLimitReached: async () => {
            const r = await confirm(cam, {
              id: `lim-${Date.now()}`,
              prompt: "Tool-call limit reached (50). Continue running?",
              yes_label: "Continue",
              no_label: "Stop turn",
              default: "no",
              allow_cancel: false,
            });
            return r.value ? "continue" : "stop";
          },
          // Ports LimitModal's loop variant — agent detected repeated
          // tool calls and asks the user how to recover. Three options
          // surface via SelectList instead of Confirm to keep the
          // "synthesize" verb visible.
          onLoopDetected: async () => {
            const r = await selectList(cam, {
              id: `loop-${Date.now()}`,
              prompt: "Tool-call loop detected — pick a recovery",
              options: [
                { value: "continue",   label: "Continue",   description: "let the agent keep going" },
                { value: "synthesize", label: "Synthesize", description: "ask the model to summarize and answer with what it has" },
                { value: "stop",       label: "Stop",       description: "end this turn" },
              ],
              default: "synthesize",
              allow_cancel: false,
            });
            return (r.value as "continue" | "synthesize" | "stop") ?? "stop";
          },
          // KIMI.md drift detector — surface as the same warn segment
          // the /compact threshold uses, so the status bar lights up
          // until the user runs /init.
          onKimiMdStale: () => {
            cam.send("StatusUpdate", { segments: { warn: "⚠ KIMI.md stale · run /init" } });
            cam.send("ShowToast", {
              text: "Project context may be stale. Run /init to refresh KIMI.md.",
              kind: "warn", ttl_ms: 4500,
            });
          },
          askPermission: async ({ tool, args }) => {
            // Auto mode is "trust the agent" — Ink parity: never prompt
            // for permissions in auto. We check `currentMode` at the
            // moment the question is asked (not at turn start), so
            // mid-turn mode switches take effect on the very next tool
            // call.
            if (currentMode === "auto") {
              void args;
              return "allow";
            }
            // Plan mode: blocked tools never reach the user as a prompt.
            // Read-only bash (find, grep, ls …) auto-allows; anything else
            // mutating auto-denies with an info row so the user sees what
            // got blocked instead of being interrogated for it.
            if (currentMode === "plan" && isBlockedInPlanMode(tool.name)) {
              if (
                tool.name === "bash" &&
                typeof (args as { command?: unknown }).command === "string" &&
                isReadOnlyBash((args as { command: string }).command)
              ) {
                return "allow";
              }
              cam.send("ShowToast", {
                text: `plan mode blocked ${tool.name}`,
                kind: "warn",
                ttl_ms: 3500,
              });
              return "deny";
            }
            void args;
            const reqId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Mirror Ink's PermissionModal: prefer tool.render's title for
            // human-readable action, and pass diff if available so the
            // renderer can paint a colored ± preview.
            let title: string | undefined;
            let diff: { path: string; before: string; after: string } | undefined;
            try {
              const rendered = tool.render?.(args as Record<string, unknown>);
              if (rendered) {
                title = rendered.title;
                if (rendered.diff) {
                  diff = {
                    path: rendered.diff.path,
                    before: rendered.diff.before ?? "",
                    after: rendered.diff.after ?? "",
                  };
                }
              }
            } catch {
              // Malformed args from the model can crash typed render functions;
              // fall back to JSON action — same recovery Ink uses.
            }
            const payload: Record<string, unknown> = {
              request_id: reqId,
              tool: tool.name,
              action: title ?? JSON.stringify(args),
            };
            if (diff) payload.diff = diff;
            cam.send("PermissionRequested", payload);
            if (opts.allowAll) {
              cam.send("PermissionGranted", { request_id: reqId });
              return "allow";
            }
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
      // Esc / Ctrl+C aborts surface as DOMException AbortError. Swallow
      // it cleanly — the cancelRequested handler already showed a
      // "turn interrupted" toast; surfacing a duplicate RuntimeError
      // row is noise.
      if (err instanceof Error && err.name === "AbortError") {
        // Nothing to surface; the multi-turn loop continues so the user
        // can immediately submit a new prompt.
      } else if (err instanceof BudgetExhaustedError) {
        cam.send("RuntimeError", { message: "cumulative input token budget exhausted", kind: "quota_exhausted", severity: "error" });
        exitCode = 42; aborted = true;
      } else if (err instanceof AgentLoopError) {
        cam.send("RuntimeError", { message: "agent loop detected (repeated tool calls)", kind: "generic", severity: "error" });
        exitCode = 43; aborted = true;
      } else if (err instanceof KimiApiError) {
        cam.send("RuntimeError", { message: humanizeCloudflareError(err), source: "cloudflare", kind: "api_error", severity: "error" });
      } else {
        cam.send("RuntimeError", { message: err instanceof Error ? err.message : String(err), kind: "generic", severity: "error" });
      }
    } finally {
      // Stop the elapsed timer + spinner the moment the turn ends, by
      // any path (success / error / abort). Without this the timer
      // ticks forever between turns and the spinner glyph keeps
      // animating with no actual work happening — what users
      // (correctly) read as "stuck". Empty-string segment values
      // remove the segment in the renderer.
      turnStartMs = null;
      setPhase("idle");
      cam.send("StatusUpdate", { segments: { elapsed: "" } });
      kimiLog({ dir: "turn", phase: "end" });
    }
  }

  async function nextFollowUp(): Promise<string | null> {
    if (followUpQueue.length > 0) return followUpQueue.shift()!;
    if (aborted) return null;
    return new Promise<string | null>((resolve) => { followUpResolver = resolve; });
  }

  /** Ports InboxModal. Ink renders two sequential prompts (handle then
   *  secret); we collapse to a single Form so the user fills both at
   *  once. After fetch we either toast the error or open a SelectList
   *  for the user to pick a message → openBrowser. */
  async function openInboxModal(): Promise<void> {
    const URL = "https://hello.kimiflare.com";
    const f = await form(cam, {
      id: `inbox-${Date.now()}`,
      title: "/inbox  ·  check for a voice reply",
      fields: [
        { name: "handle", label: "Twitter handle", placeholder: "your @ (no leading @)", required: true },
        { name: "secret", label: "Secret",        kind: "password", required: true },
      ],
      allow_cancel: true,
    });
    if (f.cancelled || !f.values) return;
    const handle = (f.values.handle ?? "").trim();
    const secret = (f.values.secret ?? "").trim();
    if (!handle || !secret) return;
    cam.send("ShowToast", { text: "checking inbox…", kind: "info", ttl_ms: 1500 });
    let data: { messages?: { id: string; createdAt: number; seen: boolean }[] };
    try {
      const res = await fetch(
        `${URL}/inbox/check?u=${encodeURIComponent(handle)}&s=${encodeURIComponent(secret)}`,
      );
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      data = await res.json();
    } catch (err) {
      cam.send("ShowToast", { text: `inbox check failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3500 });
      return;
    }
    const msgs = (data.messages ?? []).sort((a, b) => b.createdAt - a.createdAt);
    if (msgs.length === 0) {
      cam.send("ShowToast", { text: `no messages yet for @${handle}`, kind: "info", ttl_ms: 2500 });
      return;
    }
    const pick = await selectList(cam, {
      id: `inbox-msgs-${Date.now()}`,
      prompt: `Inbox (${msgs.length} message${msgs.length === 1 ? "" : "s"}${msgs.some((m) => !m.seen) ? ", new!" : ""})  ·  Enter opens in browser`,
      options: msgs.map((m) => ({
        value: m.id,
        label: `${m.seen ? "  " : "● "}${new Date(m.createdAt).toLocaleString()}`,
        description: m.seen ? "played" : "new",
      })),
      allow_cancel: true,
    });
    if (pick.cancelled || !pick.value) return;
    openBrowser(
      `${URL}/inbox?u=${encodeURIComponent(handle)}&s=${encodeURIComponent(secret)}&m=${encodeURIComponent(pick.value)}`,
    );
    cam.send("ShowToast", { text: "opened in browser", kind: "success", ttl_ms: 1500 });
  }

  /** Ports LspWizard. State machine: main → {add|edit|delete|list}. add →
   *  preset → confirm-install (toast-only — installation lives outside
   *  the TUI) → scope → save. edit toggles enabled flag. delete removes.
   *  Persists via saveConfig so all changes survive across runs. */
  async function openLspWizard(): Promise<void> {
    while (true) {
      const cfg = (await loadConfig()) ?? null;
      const servers: Record<string, LspServerConfig> = { ...(cfg?.lspServers ?? {}) };
      const main = await selectList(cam, {
        id: `lsp-main-${Date.now()}`,
        prompt: `LSP Servers  ·  ${Object.keys(servers).length} configured`,
        options: [
          { value: "add",    label: "Add server",    description: "configure a new language server" },
          { value: "edit",   label: "Edit server",   description: "toggle enabled/disabled" },
          { value: "delete", label: "Delete server", description: "remove from config" },
          { value: "list",   label: "List servers",  description: "show current configuration" },
        ],
        allow_cancel: true,
      });
      if (main.cancelled || !main.value) return;
      if (main.value === "list") {
        const keys = Object.keys(servers);
        cam.send("ShowKeyValueView", {
          id: `lsp-list-${Date.now()}`,
          title: `LSP servers (${keys.length})`,
          items: keys.length > 0
            ? keys.map((k) => ({
                label: `${servers[k]!.enabled === false ? "○" : "●"} ${k}`,
                value: servers[k]!.command.join(" "),
              }))
            : [{ label: "(none)", value: "configure with /lsp" }],
        });
        continue;
      }
      if (main.value === "add") {
        const pick = await selectList(cam, {
          id: `lsp-presets-${Date.now()}`,
          prompt: "Pick a preset (or Custom)",
          options: [...LSP_PRESETS, { id: "custom", name: "Custom", description: "enter your own command", command: [] as string[], installCommand: "", installHint: "" }]
            .map((p) => ({
              value: p.id,
              label: p.name,
              description: `${p.description}${p.id !== "custom" && p.id in servers ? "  · configured" : ""}`,
            })),
          allow_cancel: true,
        });
        if (pick.cancelled || !pick.value) continue;
        let name = pick.value;
        let command: string[];
        if (pick.value === "custom") {
          const cust = await form(cam, {
            id: `lsp-custom-${Date.now()}`,
            title: "Custom LSP server",
            fields: [
              { name: "name", label: "Name (e.g. my-server)", required: true },
              { name: "command", label: "Command (space-separated)", required: true, placeholder: "my-langserver --stdio" },
            ],
            allow_cancel: true,
          });
          if (cust.cancelled || !cust.values) continue;
          name = (cust.values.name ?? "").trim();
          const cmd = (cust.values.command ?? "").trim();
          if (!name || !cmd) continue;
          command = cmd.split(/\s+/);
        } else {
          const preset = LSP_PRESETS.find((p) => p.id === pick.value);
          if (!preset) continue;
          command = preset.command;
          if (preset.installCommand) {
            cam.send("ShowToast", {
              text: `if not installed: ${preset.installCommand}  (${preset.installHint})`,
              kind: "info",
              ttl_ms: 5000,
            });
          }
        }
        const scope = await selectList(cam, {
          id: `lsp-scope-${Date.now()}`,
          prompt: "Where to save this configuration?",
          options: [
            { value: "project", label: "This project only" },
            { value: "global",  label: "Global config (~/.config/kimiflare)" },
          ],
          allow_cancel: true,
        });
        if (scope.cancelled || !scope.value) continue;
        // Persist. NB: scope: "project" still goes into the main config
        // file today — KimiFlare doesn't yet split LSP config per scope
        // in saveConfig. We mark the field but write the merged map.
        servers[name] = { command, enabled: true };
        const nextCfg = (await loadConfig()) ?? { accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model };
        nextCfg.lspServers = servers;
        nextCfg.lspEnabled = true;
        await saveConfig(nextCfg);
        cam.send("ShowToast", { text: `LSP saved: ${name}  ·  run /lsp reload to start it`, kind: "success", ttl_ms: 3500 });
        continue;
      }
      if (main.value === "edit" || main.value === "delete") {
        const keys = Object.keys(servers);
        if (keys.length === 0) {
          cam.send("ShowToast", { text: "no servers configured", kind: "info", ttl_ms: 2000 });
          continue;
        }
        const pick = await selectList(cam, {
          id: `lsp-${main.value}-${Date.now()}`,
          prompt: main.value === "edit" ? "Toggle which server?" : "Delete which server?",
          options: keys.map((k) => ({
            value: k,
            label: `${servers[k]!.enabled === false ? "○" : "●"} ${k}`,
            description: servers[k]!.command.join(" "),
          })),
          allow_cancel: true,
        });
        if (pick.cancelled || !pick.value) continue;
        if (main.value === "edit") {
          servers[pick.value] = { ...servers[pick.value]!, enabled: servers[pick.value]!.enabled === false };
        } else {
          delete servers[pick.value];
        }
        const nextCfg = (await loadConfig()) ?? { accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model };
        nextCfg.lspServers = servers;
        await saveConfig(nextCfg);
        cam.send("ShowToast", {
          text: main.value === "edit"
            ? `${pick.value}: ${servers[pick.value]?.enabled === false ? "disabled" : "enabled"}`
            : `${pick.value}: removed`,
          kind: "success", ttl_ms: 2000,
        });
        continue;
      }
    }
  }

  /** Ports CommandWizard. Linear chain of Form / SelectList screens.
   *  Branching (advanced "set" vs "skip") is host-side. Persists via
   *  saveCustomCommand. Delete uses deleteCustomCommand. */
  async function openCommandWizard(action: "create" | "edit" | "delete"): Promise<void> {
    const { commands: existing } = await loadCustomCommands(process.cwd());
    if (action === "delete") {
      if (existing.length === 0) {
        cam.send("ShowToast", { text: "no custom commands to delete", kind: "info", ttl_ms: 2000 });
        return;
      }
      const pick = await selectList(cam, {
        id: `cmd-del-${Date.now()}`,
        prompt: "Delete which custom command?",
        options: existing.map((c: CustomCommand) => ({
          value: c.name,
          label: `/${c.name}`,
          description: c.description ?? "",
        })),
        allow_cancel: true,
      });
      if (pick.cancelled || !pick.value) return;
      const target = existing.find((c: CustomCommand) => c.name === pick.value);
      if (!target) return;
      try {
        await deleteCustomCommand(target);
        cam.send("ShowToast", { text: `deleted /${target.name}`, kind: "success", ttl_ms: 2500 });
      } catch (err) {
        cam.send("ShowToast", { text: `delete failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
      }
      return;
    }
    let initial: CustomCommand | undefined;
    if (action === "edit") {
      if (existing.length === 0) {
        cam.send("ShowToast", { text: "no custom commands to edit", kind: "info", ttl_ms: 2000 });
        return;
      }
      const pick = await selectList(cam, {
        id: `cmd-pick-${Date.now()}`,
        prompt: "Edit which custom command?",
        options: existing.map((c: CustomCommand) => ({
          value: c.name,
          label: `/${c.name}`,
          description: c.description ?? "",
        })),
        allow_cancel: true,
      });
      if (pick.cancelled || !pick.value) return;
      initial = existing.find((c: CustomCommand) => c.name === pick.value);
    }
    // Step 1: name + description + template (single form).
    const basics = await form(cam, {
      id: `cmd-basics-${Date.now()}`,
      title: action === "edit" ? `Edit /${initial?.name}` : "New custom command",
      fields: [
        { name: "name", label: "Name (no slash; letters/numbers/_/- allowed)", default: initial?.name ?? "", required: true },
        { name: "description", label: "One-line description", default: initial?.description ?? "" },
        { name: "template", label: "Template (prompt sent to model)", default: initial?.template ?? "", required: true, placeholder: "Use $ARGS for the user's args" },
      ],
      allow_cancel: true,
    });
    if (basics.cancelled || !basics.values) return;
    const name = (basics.values.name ?? "").trim();
    const description = (basics.values.description ?? "").trim();
    const template = (basics.values.template ?? "").trim();
    const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_\-/]*$/;
    if (!NAME_RE.test(name)) {
      cam.send("ShowToast", { text: "invalid name: letters/numbers/_/-, must start with a letter", kind: "error", ttl_ms: 3000 });
      return;
    }
    if (BUILTIN_COMMAND_NAMES.has(name.toLowerCase())) {
      cam.send("ShowToast", { text: `/${name} is a built-in command`, kind: "error", ttl_ms: 3000 });
      return;
    }
    if (existing.some((c: CustomCommand) => c.name === name) && name !== initial?.name) {
      cam.send("ShowToast", { text: `/${name} already exists`, kind: "error", ttl_ms: 3000 });
      return;
    }
    if (!template) {
      cam.send("ShowToast", { text: "template cannot be empty", kind: "error", ttl_ms: 3000 });
      return;
    }
    // Step 2: advanced — set or skip?
    const adv = await selectList(cam, {
      id: `cmd-adv-${Date.now()}`,
      prompt: "Advanced options (mode / effort / model)?",
      options: [
        { value: "skip", label: "Skip — use defaults" },
        { value: "set",  label: "Set advanced options" },
      ],
      allow_cancel: true,
    });
    if (adv.cancelled) return;
    let cmdMode: Mode | undefined =
      initial?.mode === "multi-agent-experimental" ? undefined : initial?.mode;
    let cmdEffort: "low" | "medium" | "high" | undefined = initial?.effort;
    let cmdModel: string | undefined = initial?.model;
    if (adv.value === "set") {
      const modePick = await selectList(cam, {
        id: `cmd-mode-${Date.now()}`,
        prompt: "Default mode for this command?",
        options: [
          { value: "none", label: "None (use session mode)" },
          { value: "edit", label: "edit" },
          { value: "plan", label: "plan" },
          { value: "auto", label: "auto" },
        ],
        default: cmdMode ?? "none",
        allow_cancel: true,
      });
      if (modePick.cancelled) return;
      cmdMode = modePick.value === "none" ? undefined : (modePick.value as "edit" | "plan" | "auto");
      const effortPick = await selectList(cam, {
        id: `cmd-effort-${Date.now()}`,
        prompt: "Reasoning effort?",
        options: [
          { value: "none",   label: "None (use default)" },
          { value: "low",    label: "low" },
          { value: "medium", label: "medium" },
          { value: "high",   label: "high" },
        ],
        default: cmdEffort ?? "none",
        allow_cancel: true,
      });
      if (effortPick.cancelled) return;
      cmdEffort = effortPick.value === "none" ? undefined : (effortPick.value as "low" | "medium" | "high");
      const modelForm = await form(cam, {
        id: `cmd-model-${Date.now()}`,
        title: "Override model?",
        fields: [{ name: "model", label: "Model (blank = session default)", default: cmdModel ?? "" }],
        allow_cancel: true,
      });
      if (modelForm.cancelled) return;
      const m = (modelForm.values?.model ?? "").trim();
      cmdModel = m || undefined;
    }
    // Step 3: location (skip on edit — keep current source).
    let source: "project" | "global" = initial?.source ?? "project";
    if (action === "create") {
      const loc = await selectList(cam, {
        id: `cmd-loc-${Date.now()}`,
        prompt: "Where to save?",
        options: [
          { value: "project", label: "This project (.kimiflare/commands/)" },
          { value: "global",  label: "Global (~/.config/kimiflare/commands/)" },
        ],
        allow_cancel: true,
      });
      if (loc.cancelled || !loc.value) return;
      source = loc.value as "project" | "global";
    }
    // Save.
    try {
      const r = await saveCustomCommand({
        name, description, template, source, mode: cmdMode, model: cmdModel, effort: cmdEffort, cwd: process.cwd(),
      });
      cam.send("ShowToast", { text: `saved /${name} → ${r.filepath}`, kind: "success", ttl_ms: 3500 });
    } catch (err) {
      cam.send("ShowToast", { text: `save failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
    }
  }

  /** Ports RemoteDashboard. SelectList over saved remote sessions with
   *  worker-side status refresh for running/pending ones. "Refresh" is
   *  surfaced as a list item (the SelectList primitive doesn't expose
   *  R-to-refresh today). Picking a session opens a detail KV view with
   *  optional "Cancel session" action when it's still running. */
  async function openRemoteDashboard(): Promise<void> {
    while (true) {
      cam.send("ShowToast", { text: "loading remote sessions…", kind: "info", ttl_ms: 1500 });
      let sessions;
      try {
        sessions = await listRemoteSessions();
        // Refresh worker-side status for running/pending in parallel.
        sessions = await Promise.all(
          sessions.map(async (s) => {
            if (s.status !== "running" && s.status !== "pending") return s;
            try {
              const st = await getRemoteStatus(s.workerUrl, s.sessionId);
              return {
                ...s,
                status: st.status,
                prUrl: st.prUrl ?? s.prUrl,
                tokensUsed: st.tokensUsed ?? s.tokensUsed,
                tokensBudget: st.tokensBudget ?? s.tokensBudget,
              };
            } catch {
              return s;
            }
          }),
        );
        sessions.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      } catch (err) {
        cam.send("ShowToast", { text: `remote list failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        return;
      }
      if (sessions.length === 0) {
        cam.send("ShowToast", { text: "no remote sessions yet  ·  start with `kimiflare remote <prompt>`", kind: "info", ttl_ms: 3500 });
        return;
      }
      const options = sessions.map((s) => ({
        value: s.sessionId,
        label: formatRemoteLine(s),
      }));
      options.push({ value: "__refresh__", label: "↻ refresh" });
      const pick = await selectList(cam, {
        id: `remote-${Date.now()}`,
        prompt: `Recent remote tasks (${sessions.length})`,
        options,
        allow_cancel: true,
      });
      if (pick.cancelled || !pick.value) return;
      if (pick.value === "__refresh__") continue;
      const s = sessions.find((x) => x.sessionId === pick.value);
      if (!s) continue;
      // Detail view.
      const items: { label: string; value: string }[] = [
        { label: "id", value: s.sessionId },
        { label: "repo", value: s.repo },
        { label: "status", value: s.status },
        { label: "prompt", value: s.prompt },
      ];
      if (s.prUrl) items.push({ label: "PR", value: s.prUrl });
      if (s.errorMessage) items.push({ label: "error", value: s.errorMessage });
      if (s.tokensUsed != null) items.push({ label: "tokens", value: `${formatRemoteTokens(s.tokensUsed)}${s.tokensBudget ? ` / ${formatRemoteTokens(s.tokensBudget)}` : ""}` });
      items.push({ label: "created", value: new Date(s.createdAt).toLocaleString() });
      if (s.finishedAt) items.push({ label: "finished", value: new Date(s.finishedAt).toLocaleString() });
      cam.send("ShowKeyValueView", {
        id: `remote-${s.sessionId}-${Date.now()}`,
        title: `Remote session  ·  ${s.status}`,
        items,
      });
      // Optionally offer cancel.
      if (s.status === "running" || s.status === "pending") {
        const conf = await selectList(cam, {
          id: `remote-actions-${Date.now()}`,
          prompt: "Action?",
          options: [
            { value: "back",   label: "← back to list" },
            { value: "cancel", label: "Cancel this session" },
          ],
          allow_cancel: true,
        });
        if (!conf.cancelled && conf.value === "cancel") {
          try {
            await cancelRemoteSession(s.workerUrl, s.sessionId);
            cam.send("ShowToast", { text: `cancel requested for ${s.sessionId.slice(0, 8)}…`, kind: "success", ttl_ms: 2500 });
          } catch (err) {
            cam.send("ShowToast", { text: `cancel failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
          }
        }
      }
      // Loop back to list.
    }
  }

  /** Ports CheckpointPicker. ↑↓ Enter Esc; first option always "resume
   *  from beginning". On pick, truncate messages to the checkpoint's
   *  turnIndex and wipe the visible transcript. */
  async function openCheckpointPicker(): Promise<void> {
    if (!currentSessionFilePath) return;
    let file;
    try {
      file = await loadSession(currentSessionFilePath);
    } catch (err) {
      cam.send("ShowToast", { text: `load failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
      return;
    }
    const cps = file.checkpoints ?? [];
    const options = [
      {
        value: "__start__",
        label: `Resume from beginning (${file.messages.filter((m) => m.role !== "system").length} msgs)`,
      },
      ...cps.map((c) => ({
        value: c.id,
        label: `Resume from: "${c.label}" — turn ${c.turnIndex} · ${formatShortDate(c.timestamp)}`,
      })),
    ];
    const choice = await selectList(cam, {
      id: `cp-${Date.now()}`,
      prompt: `${(file.title ?? file.id).slice(0, 50)}  (${cps.length} checkpoint${cps.length === 1 ? "" : "s"})`,
      options,
      allow_cancel: true,
    });
    if (choice.cancelled || !choice.value) return;
    try {
      if (choice.value === "__start__") {
        messages.length = 0;
        messages.push(...file.messages);
        cam.send("TranscriptCleared", {});
        cam.send("ShowToast", { text: `restored to beginning (${file.messages.length} msgs)`, kind: "success", ttl_ms: 2500 });
      } else {
        const { file: restored, checkpoint } = await loadSessionFromCheckpoint(currentSessionFilePath, choice.value);
        messages.length = 0;
        messages.push(...restored.messages);
        cam.send("TranscriptCleared", {});
        cam.send("ShowToast", {
          text: `restored to "${checkpoint.label}" (turn ${checkpoint.turnIndex})`,
          kind: "success", ttl_ms: 3000,
        });
      }
    } catch (err) {
      cam.send("ShowToast", { text: `restore failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
    }
  }

  /** Ports HelpMenu. Two-level drill-down: main category list → category
   *  command list → executes the selected slash-command. Esc on the
   *  child returns to main (re-open); Esc on main closes the menu.
   *  Cloud mode hides the Gateway category. Trailing single-commands
   *  and key hints are concatenated into the main prompt since the
   *  underlying SelectList has only one description line per item. */
  async function openHelpMenu(): Promise<void> {
    // Stay on main until the user selects (close) or picks a command.
    while (true) {
      const mainOptions = HELP_CATEGORIES
        .filter((c) => c.key !== "__none__")
        .map((c) => ({ value: c.key, label: c.label, description: c.tagline }));
      mainOptions.push({ value: "__keys__", label: "Keys & shortcuts", description: "global keybinds" });
      const choice = await selectList(cam, {
        id: `help-main-${Date.now()}`,
        prompt: "Help  ·  ↑↓ select  ·  Enter drill in  ·  Esc close",
        options: mainOptions,
        allow_cancel: true,
      });
      if (choice.cancelled || !choice.value || choice.value === "__close__") return;
      if (choice.value === "__keys__") {
        await selectList(cam, {
          id: `help-keys-${Date.now()}`,
          prompt: "Keys & shortcuts  (Esc to go back)",
          options: HELP_KEYS.map((k) => ({ value: k.key, label: k.key, description: k.desc })),
          allow_cancel: true,
        });
        continue;
      }
      const cat = HELP_CATEGORIES.find((c) => c.key === choice.value);
      if (!cat) continue;
      const subChoice = await selectList(cam, {
        id: `help-${cat.key}-${Date.now()}`,
        prompt: `${cat.label}  ·  Enter execute  ·  Esc back`,
        options: cat.commands.map((c) => ({
          value: c.command,
          label: c.command,
          description: c.description,
        })),
        allow_cancel: true,
      });
      if (subChoice.cancelled || !subChoice.value) {
        // back to main
        continue;
      }
      // Execute the selected command (recurse into handleSlashCommand).
      await handleSlashCommand(subChoice.value);
      return;
    }
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
        await openHelpMenu();
        return true;
      case "edit":
      case "plan":
      case "auto":
        setMode(name as Mode);
        return true;
      case "mode": {
        const modes = availableModes();
        if (args && (modes as readonly string[]).includes(args)) {
          setMode(args as Mode);
        } else if (args === "multi-agent-experimental" && !multiAgentEnabled) {
          cam.send("ShowToast", { text: "multi-agent mode is disabled — run /multi-agent enable", kind: "error", ttl_ms: 3500 });
        } else {
          const idx = Math.max(0, modes.indexOf(currentMode));
          const next = modes[(idx + 1) % modes.length] ?? "edit";
          setMode(next);
        }
        return true;
      }
      case "multi-agent": {
        await handleMultiAgentCommand(args);
        return true;
      }
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
        // Ports ResumePicker: list saved sessions for this cwd, fuzzy
        // filter by typing, ↑↓ navigate, Enter resume, Esc cancel.
        // Format mirrors Ink: "Mon DD, HH:MM  ·  N msgs  ·  title".
        const sessions = await listSessions(30, process.cwd());
        if (sessions.length === 0) {
          cam.send("ShowToast", { text: "no saved sessions yet for this cwd", kind: "info", ttl_ms: 2500 });
          return true;
        }
        const choice = await selectList(cam, {
          id: `resume-${Date.now()}`,
          prompt: `Resume a session  (${sessions.length} total)`,
          options: sessions.map((s) => ({
            value: s.filePath,
            label: `${formatShortDate(s.updatedAt)}  ·  ${String(s.messageCount).padStart(3)} msgs  ·  ${s.title ?? s.firstPrompt}`,
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
            text: `resumed: ${file.title ?? file.id} (${file.messages.length} msgs restored)`,
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
        // Two-mode like Ink: with args → save; no args + active session
        // → open CheckpointPicker to restore.
        if (args) {
          if (!currentSessionFilePath) {
            cam.send("ShowToast", { text: "no active saved session — type at least one message first", kind: "warn", ttl_ms: 2800 });
            return true;
          }
          try {
            await addCheckpoint(currentSessionFilePath, {
              id: `cp-${Date.now()}`,
              label: args,
              turnIndex: messages.length,
              timestamp: new Date().toISOString(),
            });
            cam.send("ShowToast", { text: `checkpoint saved: ${args}`, kind: "success", ttl_ms: 2500 });
          } catch (err) {
            cam.send("ShowToast", { text: `checkpoint failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
          }
          return true;
        }
        if (!currentSessionFilePath) {
          cam.send("ShowToast", { text: "/checkpoint <label> to save; no saved session loaded so no picker", kind: "info", ttl_ms: 3000 });
          return true;
        }
        await openCheckpointPicker();
        return true;
      }
      case "checkpoints": {
        // Ink behavior: opens the same CheckpointPicker as /checkpoint
        // with no args. We need a loaded session, otherwise nothing to
        // pick from.
        if (!currentSessionFilePath) {
          cam.send("ShowToast", { text: "no saved session loaded", kind: "warn", ttl_ms: 2500 });
          return true;
        }
        await openCheckpointPicker();
        return true;
      }
      case "ui": {
        // No-arg form opens an arrow-key picker (matches `/theme`,
        // `/resume`, etc.). Direct-arg form is still supported for
        // muscle-memory and scripts.
        let nextUi: "ink" | "camouflage";
        if (!args) {
          const existing = (await loadConfig().catch(() => null)) ?? null;
          const current = existing?.uiEngine ?? "ink";
          const choice = await selectList(cam, {
            id: `ui-${Date.now()}`,
            prompt: "Pick UI engine (takes effect on next launch)",
            options: [
              {
                value: "ink",
                label: "React Ink",
                description: "stable — current default",
              },
              {
                value: "camouflage",
                label: "Camouflage",
                description: "experimental Rust TUI — bail with `kimiflare --ui ink`",
              },
            ],
            default: current,
            allow_filter: false,
            allow_cancel: true,
          });
          if (choice.cancelled || !choice.value) return true;
          if (choice.value !== "ink" && choice.value !== "camouflage") return true;
          nextUi = choice.value as "ink" | "camouflage";
        } else if (args === "ink" || args === "camouflage") {
          nextUi = args as "ink" | "camouflage";
        } else {
          cam.send("ShowToast", {
            text: `unknown UI engine "${args}" — choose "ink" or "camouflage"`,
            kind: "warn",
            ttl_ms: 3000,
          });
          return true;
        }
        try {
          const existing = (await loadConfig()) ?? null;
          if (existing) {
            await saveConfig({ ...existing, uiEngine: nextUi });
          }
        } catch (e) {
          cam.send("ShowToast", {
            text: `failed to persist UI choice: ${(e as Error).message}`,
            kind: "error",
            ttl_ms: 6000,
          });
          return true;
        }
        // Loud error-kind toast (rendered red) with a long TTL so the user
        // can't miss it. Also reminds them of the env-var escape hatch.
        cam.send("ShowToast", {
          text:
            `UI engine set to "${nextUi}". RESTART kimiflare for it to take effect.` +
            (nextUi === "ink"
              ? "  (or `unset KIMIFLARE_UI` if you previously exported it)"
              : "  (Camouflage is EXPERIMENTAL — `kimiflare --ui ink` to bail.)"),
          kind: "error",
          ttl_ms: 12000,
        });
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
      case "cost": {
        // Sub-actions: on / off toggle costAttribution. Bare /cost
        // shows the KV report.
        const sub = args.split(/\s+/)[0] ?? "";
        if (sub === "on" || sub === "off") {
          const cfg2 = (await loadConfig()) ?? { accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model };
          cfg2.costAttribution = sub === "on";
          try {
            await saveConfig(cfg2);
            cam.send("ShowToast", { text: `cost attribution ${sub === "on" ? "enabled" : "disabled"}`, kind: "success", ttl_ms: 2500 });
          } catch (err) {
            cam.send("ShowToast", { text: `save failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
          }
          return true;
        }
        cam.send("ShowKeyValueView", {
          id: `cost-${Date.now()}`,
          title: "session cost",
          items: [
            { label: "model", value: opts.model },
            { label: "prompt tokens", value: String(promptTokens) },
            { label: "cached prompt", value: String(cachedTokens) },
            { label: "completion tokens", value: String(completionTokens) },
            { label: "total $", value: formatUsd(sessionCostUsd) },
          ],
        });
        return true;
      }
      case "reasoning":
        reasoningShown = !reasoningShown;
        cam.send("ShowToast", {
          text: `reasoning: ${reasoningShown ? "shown" : "hidden"} (display-only in Camouflage TUI)`,
          kind: "info", ttl_ms: 2000,
        });
        return true;
      case "shell": {
        if (!args) {
          const cfg = await loadConfig();
          cam.send("ShowToast", { text: `shell: ${cfg?.shell ?? "auto"}`, kind: "info", ttl_ms: 2500 });
          return true;
        }
        try {
          const cfg = (await loadConfig()) ?? {
            accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model,
          };
          cfg.shell = args;
          await saveConfig(cfg);
          cam.send("ShowToast", { text: `shell saved: ${args}`, kind: "success", ttl_ms: 2500 });
        } catch (err) {
          cam.send("ShowToast", { text: `shell save failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
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
      case "init": {
        // /init in the Ink UI runs a guided turn that asks the model to
        // scan the repo and write KIMI.md. We just feed buildInitPrompt's
        // generated prompt straight into the agent loop.
        const initPrompt = buildInitPrompt(process.cwd());
        cam.send("ShowToast", {
          text: initPrompt.isRefresh
            ? `refreshing ${initPrompt.targetFilename}…`
            : `generating ${initPrompt.targetFilename}…`,
          kind: "info", ttl_ms: 2000,
        });
        await runTurn(initPrompt.prompt);
        return true;
      }
      case "memory": {
        // Sub-actions match Ink: on / off / clear / search <query>.
        // Bare /memory shows the stats KV view (recall stats requires
        // an initialised MemoryManager which the Camouflage path
        // doesn't construct — we surface the persisted config + a hint
        // instead).
        const sub = args.split(/\s+/)[0] ?? "";
        if (sub === "on" || sub === "off") {
          const cfg2 = (await loadConfig()) ?? { accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model };
          cfg2.memoryEnabled = sub === "on";
          try {
            await saveConfig(cfg2);
            cam.send("ShowToast", { text: `memory ${sub === "on" ? "enabled" : "disabled"} (restart to take effect)`, kind: "success", ttl_ms: 2500 });
          } catch (err) {
            cam.send("ShowToast", { text: `save failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
          }
          return true;
        }
        if (sub === "clear") {
          cam.send("ShowToast", { text: "memory clear requires Ink runtime; not yet wired in Camouflage UI", kind: "warn", ttl_ms: 3000 });
          return true;
        }
        if (sub === "search") {
          cam.send("ShowToast", { text: "memory search requires Ink runtime (MemoryManager); not yet wired", kind: "warn", ttl_ms: 3000 });
          return true;
        }
        const cfg = await loadConfig();
        cam.send("ShowKeyValueView", {
          id: `mem-${Date.now()}`,
          title: "memory",
          items: [
            { label: "enabled", value: cfg?.memoryEnabled ? "yes" : "no" },
            { label: "db path", value: cfg?.memoryDbPath ?? "(default)" },
            { label: "max age (days)", value: String(cfg?.memoryMaxAgeDays ?? 90) },
            { label: "max entries", value: String(cfg?.memoryMaxEntries ?? 1000) },
            { label: "embedding model", value: cfg?.memoryEmbeddingModel ?? "@cf/baai/bge-base-en-v1.5" },
            { label: "tip", value: "/memory on|off  ·  /memory search <q> (Ink only)" },
          ],
        });
        return true;
      }
      case "gateway": {
        // Sub-actions mirror Ink: status (no args) / off / <id> /
        // skip-cache true|false / collect-logs true|false /
        // cache-ttl <seconds> / metadata clear|<k>=<v>.
        const parts = args.split(/\s+/).filter(Boolean);
        const cfg = (await loadConfig()) ?? { accountId: opts.accountId, apiToken: opts.apiToken, model: opts.model };
        const save = async (next: typeof cfg, msg: string) => {
          try {
            await saveConfig(next);
            cam.send("ShowToast", { text: msg, kind: "success", ttl_ms: 2500 });
          } catch (err) {
            cam.send("ShowToast", { text: `save failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
          }
        };
        if (parts.length === 0 || parts[0] === "status") {
          const id = cfg.aiGatewayId ?? opts.aiGatewayId;
          cam.send("ShowKeyValueView", {
            id: `gw-${Date.now()}`,
            title: "ai gateway",
            items: [
              { label: "id", value: id ?? "(none — direct Workers AI)" },
              { label: "cache ttl (s)", value: cfg.aiGatewayCacheTtl != null ? String(cfg.aiGatewayCacheTtl) : "(default)" },
              { label: "skip cache", value: cfg.aiGatewaySkipCache ? "yes" : "no" },
              { label: "collect logs", value: cfg.aiGatewayCollectLogPayload ? "yes" : "no" },
              { label: "metadata", value: cfg.aiGatewayMetadata ? JSON.stringify(cfg.aiGatewayMetadata) : "(none)" },
            ],
          });
          return true;
        }
        if (parts[0] === "off") {
          cfg.aiGatewayId = undefined;
          await save(cfg, "gateway disabled — direct Workers AI");
          return true;
        }
        if (parts[0] === "skip-cache" && (parts[1] === "true" || parts[1] === "false")) {
          cfg.aiGatewaySkipCache = parts[1] === "true";
          await save(cfg, `skip-cache: ${parts[1]}`);
          return true;
        }
        if (parts[0] === "collect-logs" && (parts[1] === "true" || parts[1] === "false")) {
          cfg.aiGatewayCollectLogPayload = parts[1] === "true";
          await save(cfg, `collect-logs: ${parts[1]}`);
          return true;
        }
        if (parts[0] === "cache-ttl" && parts[1]) {
          const ttl = Number(parts[1]);
          if (!Number.isFinite(ttl) || ttl < 0) {
            cam.send("ShowToast", { text: "cache-ttl must be a non-negative number (seconds)", kind: "error", ttl_ms: 3000 });
            return true;
          }
          cfg.aiGatewayCacheTtl = ttl;
          await save(cfg, `cache-ttl: ${ttl}s`);
          return true;
        }
        if (parts[0] === "metadata") {
          if (parts[1] === "clear") {
            cfg.aiGatewayMetadata = undefined;
            await save(cfg, "metadata cleared");
            return true;
          }
          // metadata key=value form
          const kv = parts.slice(1).join(" ");
          const eq = kv.indexOf("=");
          if (eq < 0) {
            cam.send("ShowToast", { text: "usage: /gateway metadata <k>=<v> | clear", kind: "info", ttl_ms: 3000 });
            return true;
          }
          const k = kv.slice(0, eq).trim();
          const v = kv.slice(eq + 1).trim();
          cfg.aiGatewayMetadata = { ...(cfg.aiGatewayMetadata ?? {}), [k]: v };
          await save(cfg, `metadata: ${k}=${v}`);
          return true;
        }
        // Treat anything else as a gateway id to enable.
        cfg.aiGatewayId = parts[0];
        await save(cfg, `gateway: ${parts[0]}`);
        return true;
      }
      case "mcp": {
        const sub = args.split(/\s+/)[0] ?? "";
        if (sub === "reload") {
          cam.send("ShowToast", {
            text: "MCP reload requires a live manager (Ink runtime); restart kimiflare to pick up config changes",
            kind: "warn", ttl_ms: 4000,
          });
          return true;
        }
        const cfg = await loadConfig();
        const servers = cfg?.mcpServers ?? {};
        const names = Object.keys(servers);
        if (names.length === 0) {
          cam.send("ShowToast", { text: "no MCP servers configured", kind: "info", ttl_ms: 2500 });
          return true;
        }
        cam.send("ShowKeyValueView", {
          id: `mcp-${Date.now()}`,
          title: `mcp servers (${names.length})`,
          items: names.map((n) => {
            const s = (servers as Record<string, { command?: string; url?: string }>)[n]!;
            return { label: n, value: s.command ?? s.url ?? "(unspecified transport)" };
          }),
        });
        return true;
      }
      case "lsp": {
        // /lsp config → wizard; /lsp list → KV view; /lsp scope → toast.
        // Bare /lsp opens the wizard (Ink behaviour: bare /lsp shows status,
        // but the wizard's main menu already shows the same listing).
        const sub = args.split(/\s+/)[0] ?? "";
        if (sub === "" || sub === "config") {
          await openLspWizard();
          return true;
        }
        if (sub === "scope") {
          cam.send("ShowToast", { text: "LSP config persists to ~/.config/kimiflare/config.json (global)", kind: "info", ttl_ms: 3000 });
          return true;
        }
        const cfg = await loadConfig();
        const servers = cfg?.lspServers ?? {};
        const names = Object.keys(servers);
        if (sub === "list" || sub === "reload") {
          if (sub === "reload") {
            cam.send("ShowToast", { text: "LSP reload requires Ink runtime; restart kimiflare for now", kind: "warn", ttl_ms: 3000 });
            return true;
          }
        }
        if (names.length === 0) {
          cam.send("ShowToast", {
            text: cfg?.lspEnabled === false ? "LSP disabled in config" : "no LSP servers configured — try /lsp config",
            kind: "info", ttl_ms: 2500,
          });
          return true;
        }
        cam.send("ShowKeyValueView", {
          id: `lsp-${Date.now()}`,
          title: `lsp servers (${names.length})`,
          items: names.map((n) => {
            const s = (servers as Record<string, { command?: string[]; enabled?: boolean }>)[n]!;
            return { label: `${s.enabled === false ? "○" : "●"} ${n}`, value: (s.command ?? []).join(" ") };
          }),
        });
        return true;
      }
      case "hooks": {
        // Sub-actions: list (default) / path / enable <id> / disable <id> /
        // reload. Recommended catalog is Ink-only.
        const parts = args.split(/\s+/).filter(Boolean);
        const sub = parts[0] ?? "list";
        const id = parts.slice(1).join(" ");
        if (sub === "path") {
          cam.send("ShowKeyValueView", {
            id: `hooks-path-${Date.now()}`,
            title: "hooks settings paths",
            items: [
              { label: "global", value: globalSettingsPath() },
              { label: "project", value: projectSettingsPath(process.cwd()) },
            ],
          });
          return true;
        }
        if (sub === "reload") {
          cam.send("ShowToast", { text: "hooks reload requires Ink runtime; restart kimiflare to pick up settings", kind: "warn", ttl_ms: 3500 });
          return true;
        }
        if (sub === "enable" || sub === "disable") {
          if (!id) {
            cam.send("ShowToast", { text: `usage: /hooks ${sub} <id>`, kind: "info", ttl_ms: 2500 });
            return true;
          }
          const path = setHookEnabled(process.cwd(), id, sub === "enable");
          if (path) cam.send("ShowToast", { text: `${id}: ${sub}d in ${path}`, kind: "success", ttl_ms: 3000 });
          else cam.send("ShowToast", { text: `hook id "${id}" not found`, kind: "error", ttl_ms: 2500 });
          return true;
        }
        if (sub === "recommended") {
          cam.send("ShowToast", { text: "recommended catalog is Ink-only; see docs/hooks.md", kind: "warn", ttl_ms: 3000 });
          return true;
        }
        // list (default)
        const settings = loadHooksSettings(process.cwd());
        const items: { label: string; value: string }[] = [];
        for (const ev of HOOK_EVENTS) {
          const list = settings.hooks?.[ev] ?? [];
          if (list.length === 0) continue;
          items.push({ label: ev, value: `${list.length} hook${list.length === 1 ? "" : "s"}` });
        }
        items.push({ label: "(global settings)", value: globalSettingsPath() });
        items.push({ label: "(project settings)", value: projectSettingsPath(process.cwd()) });
        cam.send("ShowKeyValueView", {
          id: `hooks-${Date.now()}`,
          title: items.length > 2 ? "hooks" : "no hooks enabled",
          items,
        });
        return true;
      }
      case "skills": {
        // Sub-actions match Ink: list (default) / enable <n> / disable <n>
        // / delete <n>. "add" / "edit" need an editor flow we haven't
        // built yet — surface a hint instead of pretending.
        const parts = args.split(/\s+/).filter(Boolean);
        const sub = parts[0] ?? "list";
        const tail = parts.slice(1).join(" ");
        try {
          if (sub === "enable" || sub === "disable") {
            if (!tail) {
              cam.send("ShowToast", { text: `usage: /skills ${sub} <name>`, kind: "info", ttl_ms: 2500 });
              return true;
            }
            await setSkillEnabled(tail, sub === "enable", process.cwd());
            cam.send("ShowToast", { text: `${tail}: ${sub}d`, kind: "success", ttl_ms: 2500 });
            return true;
          }
          if (sub === "delete") {
            if (!tail) {
              cam.send("ShowToast", { text: "usage: /skills delete <name>", kind: "info", ttl_ms: 2500 });
              return true;
            }
            // Two-step confirmation so a typo doesn't nuke a skill.
            const conf = await confirm(cam, {
              id: `skills-del-${Date.now()}`,
              prompt: `Delete skill "${tail}"? This cannot be undone.`,
              yes_label: "Delete",
              no_label: "Cancel",
              default: "no",
              allow_cancel: true,
            });
            if (!conf.value) return true;
            const r = await deleteSkill(tail, process.cwd());
            cam.send("ShowToast", { text: `deleted ${tail} (${r.filepath})`, kind: "success", ttl_ms: 3000 });
            return true;
          }
          if (sub === "add" || sub === "edit") {
            cam.send("ShowToast", {
              text: `/skills ${sub} needs an inline editor — Ink only for now. Create the file under skills/ manually.`,
              kind: "warn", ttl_ms: 4000,
            });
            return true;
          }
          const result = await listAllSkills(process.cwd());
          const all = [...(result.project ?? []), ...(result.global ?? [])];
          if (all.length === 0) {
            cam.send("ShowToast", { text: "no skills found", kind: "info", ttl_ms: 2500 });
            return true;
          }
          cam.send("ShowKeyValueView", {
            id: `skills-${Date.now()}`,
            title: `skills (${all.length})`,
            items: all.slice(0, 30).map((s: { name: string; enabled?: boolean; description?: string }) => ({
              label: `${s.enabled === false ? "○" : "●"} ${s.name}`,
              value: s.description ?? "",
            })),
          });
        } catch (err) {
          cam.send("ShowToast", { text: `skills failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
      case "command": {
        // Sub-actions match Ink: create / edit / delete (wizard) and list.
        const sub = args.split(/\s+/)[0] ?? "";
        if (sub === "create") { await openCommandWizard("create"); return true; }
        if (sub === "edit")   { await openCommandWizard("edit");   return true; }
        if (sub === "delete") { await openCommandWizard("delete"); return true; }
        // list / bare → KV view
        try {
          const { commands: cmds } = await loadCustomCommands(process.cwd());
          if (cmds.length === 0) {
            cam.send("ShowToast", { text: "no custom commands; /command create to make one", kind: "info", ttl_ms: 3000 });
            return true;
          }
          cam.send("ShowKeyValueView", {
            id: `cmds-${Date.now()}`,
            title: `custom commands (${cmds.length})`,
            items: cmds.map((c: { name: string; description?: string; source?: string }) => ({
              label: `/${c.name}`,
              value: `${c.description ?? ""}${c.source ? `  (${c.source})` : ""}`,
            })),
          });
        } catch (err) {
          cam.send("ShowToast", { text: `command list failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error", ttl_ms: 3000 });
        }
        return true;
      }
      case "hello":
        openBrowser("https://hello.kimiflare.com");
        cam.send("ShowToast", { text: "opened hello.kimiflare.com — leave the creator a voice note", kind: "info", ttl_ms: 3500 });
        return true;
      case "inbox":
        await openInboxModal();
        return true;
      case "report":
        cam.send("ShowToast", {
          text: args
            ? `report queued (note: ${args.slice(0, 60)}). Full reporting flow lands with the next Cloud release.`
            : "/report: usage: /report <note>. Reports go to the creator via Cloud.",
          kind: "info", ttl_ms: 4000,
        });
        return true;
      case "logout": {
        cam.send("ShowToast", { text: "Cloud has been removed; nothing to log out of.", kind: "info", ttl_ms: 2500 });
        return true;
      }
      case "remote": {
        if (args) {
          // Starting a remote session needs the full deploy/auth dance —
          // route the user to the standalone subcommand for that.
          cam.send("ShowToast", {
            text: "to start a remote: `kimiflare remote <prompt>` from a separate shell",
            kind: "info", ttl_ms: 4000,
          });
          return true;
        }
        await openRemoteDashboard();
        return true;
      }
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
async function registerMentions(cam: CamouflageHandle, recents: Set<string>): Promise<void> {
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
    candidates: collected.map((p) => ({
      token: p,
      kind: "file",
      ...(recents.has(p) ? { recent: true } : {}),
    })),
  });
}

/** Ports RemoteDashboard's formatSessionLine — icon + prompt + outcome +
 *  age + tokens. Kept ASCII-safe so terminals without emoji don't get
 *  width-misaligned. */
function formatRemoteLine(s: {
  status: string; prompt: string; updatedAt: string; prUrl?: string;
  tokensUsed?: number; tokensBudget?: number;
}): string {
  const icon =
    s.status === "done" ? "✓" :
    s.status === "error" ? "✗" :
    s.status === "cancelled" ? "■" :
    s.status === "running" ? "…" : "·";
  const prompt = s.prompt.slice(0, 30) + (s.prompt.length > 30 ? "…" : "");
  const outcome = s.prUrl ? `PR ${s.prUrl.split("/").pop()}` : s.status;
  const cost = s.tokensUsed != null && s.tokensBudget
    ? ` (${formatRemoteTokens(s.tokensUsed)}/${formatRemoteTokens(s.tokensBudget)})`
    : s.tokensUsed != null ? ` (${formatRemoteTokens(s.tokensUsed)})` : "";
  return `${icon} ${prompt} → ${outcome}  ${formatRemoteAgo(new Date(s.updatedAt))}${cost}`;
}
function formatRemoteAgo(d: Date): string {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m >= 1440) return `${Math.floor(m / 1440)}d ago`;
  if (m >= 60) return `${Math.floor(m / 60)}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}
function formatRemoteTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Ports the date format used by ResumePicker + CheckpointPicker:
 *  "Mon DD, HH:MM" in the user's locale, with safe fallback. */
function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** HelpMenu category catalog. Mirrors src/ui/help-menu.tsx CATEGORIES
 *  array, lightly compressed so each entry fits on one SelectList line
 *  (the renderer shows label + one description per row). */
interface HelpCategory {
  key: string;
  label: string;
  tagline: string;
  commands: { command: string; description: string }[];
}
const HELP_CATEGORIES: HelpCategory[] = [
  { key: "mode", label: "Mode", tagline: "edit / plan / auto", commands: [
    { command: "/mode edit", description: "switch to edit mode" },
    { command: "/mode plan", description: "switch to plan mode (blocks mutating tools)" },
    { command: "/mode auto", description: "switch to auto mode (auto-approves)" },
  ]},
  { key: "session", label: "Session", tagline: "resume, compact, clear", commands: [
    { command: "/resume", description: "pick a past conversation" },
    { command: "/compact", description: "summarize old turns to free context" },
    { command: "/clear", description: "clear current conversation" },
    { command: "/checkpoint", description: "save a named restore point" },
    { command: "/checkpoints", description: "browse and restore checkpoints" },
  ]},
  { key: "memory", label: "Memory", tagline: "show / configure memory", commands: [
    { command: "/memory", description: "show memory stats" },
  ]},
  { key: "skills", label: "Skills", tagline: "list installed skills", commands: [
    { command: "/skills", description: "list all skills" },
  ]},
  { key: "cost", label: "Cost", tagline: "tokens & USD", commands: [
    { command: "/cost", description: "show cost report" },
  ]},
  { key: "mcp", label: "MCP", tagline: "configured MCP servers", commands: [
    { command: "/mcp", description: "list configured MCP servers" },
  ]},
  { key: "lsp", label: "LSP", tagline: "configured language servers", commands: [
    { command: "/lsp", description: "list configured LSP servers" },
  ]},
  { key: "gateway", label: "Gateway", tagline: "AI Gateway status", commands: [
    { command: "/gateway", description: "show gateway status" },
  ]},
  { key: "info", label: "Info", tagline: "model / update / hello", commands: [
    { command: "/model", description: "show current model" },
    { command: "/update", description: "check for updates" },
    { command: "/hello", description: "send a voice note to the creator" },
    { command: "/inbox", description: "check for a voice reply from the creator" },
  ]},
  { key: "commands", label: "Commands", tagline: "custom slash-commands", commands: [
    { command: "/command", description: "list custom slash-commands" },
  ]},
  { key: "config", label: "Config", tagline: "init / logout / shell", commands: [
    { command: "/init", description: "scan this repo and write a KIMI.md" },
    { command: "/logout", description: "clear cloud credentials" },
    { command: "/shell", description: "show current shell setting" },
    { command: "/theme", description: "pick a theme" },
    { command: "/reasoning", description: "toggle reasoning visibility" },
  ]},
];
/** Mirrors LspWizard's PRESETS array. install commands surface as a toast
 *  because we don't run installers from the TUI (Ink did; we keep the
 *  decision in the user's hands instead). */
const LSP_PRESETS = [
  { id: "typescript", name: "TypeScript",         description: "TS + JS",                 command: ["typescript-language-server", "--stdio"], installCommand: "npm i -g typescript-language-server typescript", installHint: "Node + npm" },
  { id: "python",     name: "Python (Pyright)",   description: "Python type checking",    command: ["pyright-langserver", "--stdio"],         installCommand: "npm i -g pyright",                              installHint: "Node + npm (or pip install pyright)" },
  { id: "rust",       name: "Rust",               description: "rust-analyzer",           command: ["rust-analyzer"],                          installCommand: "rustup component add rust-analyzer",            installHint: "Rust toolchain" },
  { id: "go",         name: "Go",                 description: "gopls",                   command: ["gopls"],                                  installCommand: "go install golang.org/x/tools/gopls@latest",    installHint: "Go toolchain" },
  { id: "json",       name: "JSON",               description: "JSON LSP",                command: ["vscode-json-language-server", "--stdio"], installCommand: "npm i -g vscode-langservers-extracted",         installHint: "Node + npm" },
  { id: "css",        name: "CSS",                description: "CSS / SCSS / Less",       command: ["vscode-css-language-server", "--stdio"],  installCommand: "npm i -g vscode-langservers-extracted",         installHint: "Node + npm" },
  { id: "html",       name: "HTML",               description: "HTML LSP",                command: ["vscode-html-language-server", "--stdio"], installCommand: "npm i -g vscode-langservers-extracted",         installHint: "Node + npm" },
  { id: "eslint",     name: "ESLint",             description: "JS / TS linting",         command: ["vscode-eslint-language-server", "--stdio"], installCommand: "npm i -g vscode-langservers-extracted",       installHint: "Node + npm" },
  { id: "yaml",       name: "YAML",               description: "YAML LSP",                command: ["yaml-language-server", "--stdio"],        installCommand: "npm i -g yaml-language-server",                 installHint: "Node + npm" },
  { id: "bash",       name: "Bash",               description: "shell scripts",           command: ["bash-language-server", "start"],          installCommand: "npm i -g bash-language-server",                 installHint: "Node + npm" },
  { id: "lua",        name: "Lua",                description: "Lua LSP",                 command: ["lua-language-server"],                    installCommand: "brew install lua-language-server",              installHint: "varies — see https://luals.github.io" },
  { id: "docker",     name: "Dockerfile",         description: "Dockerfile LSP",          command: ["docker-langserver", "--stdio"],           installCommand: "npm i -g dockerfile-language-server-nodejs",    installHint: "Node + npm" },
];

const HELP_KEYS = [
  { key: "Ctrl+C", desc: "interrupt current turn (or exit if idle)" },
  { key: "Esc", desc: "interrupt current turn / dismiss modal" },
  { key: "Tab / Shift+Tab", desc: "cycle modes (edit → plan → auto)" },
  { key: "↑ / ↓", desc: "scroll transcript / browse input history" },
  { key: "Home / End", desc: "scroll to top / jump to latest" },
  { key: "PageUp / PageDown", desc: "scroll by 10 rows" },
  { key: "Ctrl+A / Ctrl+E", desc: "cursor to line start / end" },
  { key: "Ctrl+W / Ctrl+U", desc: "delete word / line before cursor" },
  { key: "Option+← / →", desc: "jump word left / right" },
  { key: "/", desc: "open slash-command picker" },
  { key: "@", desc: "open @-mention file picker" },
  { key: "Ctrl+F", desc: "search transcript" },
  { key: "?", desc: "toggle help overlay (when input empty)" },
  { key: "M", desc: "toggle metrics overlay (when input empty)" },
  { key: "T", desc: "cycle theme (when input empty)" },
];

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
  child.unref();
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

/**
 * Ports the Onboarding component to the Camouflage TUI.
 *
 * Runs in three steps using composed Form + SelectList primitives:
 *   1) Form: accountId + apiToken
 *   2) SelectList: pick existing gateway, create a new one, or skip
 *      (with a fallback Form for the gateway name)
 *   3) Form: model (with DEFAULT_MODEL prefilled)
 *
 * On success, persists to disk via saveConfig and returns the saved
 * config so the caller can hand it directly to runUiMode. Returns null
 * if the user cancels at any step.
 *
 * Mounts its own Camouflage handle and closes it before returning so
 * the caller can spawn a fresh handle for runUiMode (the renderer
 * resets its terminal state cleanly on shutdown).
 */
export async function runCamouflageOnboarding(opts: {
  camouflageBin?: string;
}): Promise<KimiConfig | null> {
  await loadCamouflage();
  const cam = await mount({ bin: opts.camouflageBin, renderToTerminal: true });
  cam.send("SessionStarted", {});
  cam.send("StatusUpdate", { segments: { mode: "setup", phase: "onboarding" } });
  cam.send("ShowToast", {
    text: "Welcome to kimiflare — let's get you set up.",
    kind: "info", ttl_ms: 4000,
  });
  try {
    // Step 1: credentials.
    const creds = await form(cam, {
      id: "onb-creds",
      title: "Cloudflare credentials",
      fields: [
        { name: "accountId", label: "Cloudflare account ID", required: true },
        { name: "apiToken",  label: "Cloudflare API token", kind: "password", required: true },
      ],
      allow_cancel: true,
    });
    if (creds.cancelled || !creds.values) return null;
    const accountId = (creds.values.accountId ?? "").trim();
    const apiToken  = (creds.values.apiToken ?? "").trim();
    if (!accountId || !apiToken) return null;

    // Step 2: gateway. List first; fall back to skip/create on errors.
    cam.send("ShowToast", { text: "checking AI Gateway…", kind: "info", ttl_ms: 1500 });
    let aiGatewayId: string | undefined;
    let gws: { id: string }[] = [];
    let listErr: string | null = null;
    try {
      gws = await listGateways(accountId, apiToken);
    } catch (err) {
      listErr = err instanceof AiGatewayError ? err.message
              : err instanceof Error ? err.message : String(err);
    }
    if (listErr) {
      cam.send("ShowToast", { text: `gateway list failed: ${listErr}  ·  continuing without gateway`, kind: "warn", ttl_ms: 4000 });
    } else {
      const opts2 = gws.map((g) => ({ value: g.id, label: g.id }));
      opts2.push({ value: "__create__", label: "Create a new gateway" });
      opts2.push({ value: "__skip__",   label: "Skip — direct Workers AI" });
      const pick = await selectList(cam, {
        id: "onb-gw",
        prompt: gws.length > 0 ? `Pick a gateway (${gws.length} available)` : "No gateways yet",
        options: opts2,
        allow_cancel: true,
      });
      if (pick.cancelled) return null;
      if (pick.value === "__create__") {
        const nameForm = await form(cam, {
          id: "onb-gwname",
          title: "Create new AI Gateway",
          fields: [{ name: "name", label: "Gateway name", default: "kimiflare", required: true }],
          allow_cancel: true,
        });
        if (nameForm.cancelled || !nameForm.values) return null;
        const name = (nameForm.values.name ?? "kimiflare").trim();
        try {
          const created = await createGateway(accountId, apiToken, name);
          aiGatewayId = created.id;
          cam.send("ShowToast", { text: `created gateway: ${created.id}`, kind: "success", ttl_ms: 2500 });
        } catch (err) {
          cam.send("ShowToast", {
            text: `create failed: ${err instanceof Error ? err.message : String(err)}  ·  continuing without gateway`,
            kind: "warn", ttl_ms: 4000,
          });
        }
      } else if (pick.value && pick.value !== "__skip__") {
        aiGatewayId = pick.value;
      }
    }

    // Step 3: model.
    const modelForm = await form(cam, {
      id: "onb-model",
      title: "Default model",
      fields: [{ name: "model", label: "Model", default: DEFAULT_MODEL, required: true }],
      allow_cancel: true,
    });
    if (modelForm.cancelled || !modelForm.values) return null;
    const model = (modelForm.values.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    const cfg: KimiConfig = { accountId, apiToken, model, aiGatewayId };
    await saveConfig(cfg);
    cam.send("ShowToast", { text: "configuration saved — welcome!", kind: "success", ttl_ms: 2500 });
    return cfg;
  } finally {
    await cam.close().catch(() => {});
  }
}
