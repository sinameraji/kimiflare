/**
 * Slash-command dispatcher extracted from app.tsx.
 *
 * Each handler reads/writes app state through the `SlashContext` interface
 * — the same "deps bag" pattern used by `input-handlers.ts`. The dispatcher
 * matches the first whitespace-delimited token (lowercased) against the
 * registry. Behaviorally identical to the previous in-component
 * `handleSlash` callback.
 */
import React from "react";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import QRCode from "qrcode";

import type { Cfg } from "../app.js";
import { configPath, loadConfig, saveConfig } from "../config.js";
import type { ChatEvent } from "./chat.js";
import type { ChatMessage, Usage } from "../agent/messages.js";
import type { GatewayMeta } from "../agent/client.js";
import type { Mode } from "../mode.js";
import type { DailyUsage } from "../usage-tracker.js";
import {
  formatCostReport,
  formatFeatureBreakdown,
  formatGatewaySection,
  getCostReport,
  getSessionGatewayLogs,
} from "../usage-tracker.js";
import { resolveTheme, themeNames, DEFAULT_THEME_NAME } from "./theme.js";
import { listModels, getModelOrInfer, type ModelEntry } from "../models/registry.js";
import { decideNextStep } from "../models/next-step.js";
import { validateModelId } from "../agent/client.js";
import { getShellCommand } from "../tools/bash.js";
import {
  createSkill,
  deleteSkill,
  findSkillFile,
  listAllSkills,
  setSkillEnabled,
} from "../skills/manager.js";
import {
  addCheckpoint,
  loadSession,
  type Checkpoint,
} from "../sessions.js";
import {
  type ArtifactStore,
  serializeArtifactStore,
  type SessionState,
} from "../agent/session-state.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ToolSpec } from "../tools/registry.js";
import type { McpManager } from "../mcp/manager.js";
import type { LspManager } from "../lsp/manager.js";
import type { MemoryManager } from "../memory/manager.js";
import type { HooksManager } from "../hooks/manager.js";
import { RECOMMENDED_HOOKS, getRecommendedHook } from "../hooks/recommended.js";
import {
  appendHook,
  setHookEnabled,
  globalSettingsPath,
  projectSettingsPath,
} from "../hooks/settings.js";
import { HOOK_EVENTS } from "../hooks/types.js";
import type { AbortScope } from "../util/abort-scope.js";
import type { CustomCommand } from "../commands/types.js";
import { checkForUpdate } from "../util/update-check.js";
import { getAppVersion } from "../util/version.js";
import {
  detectGitHubRepo,
  FEEDBACK_WORKER_URL,
  formatTokens,
  openBrowser,
} from "./app-helpers.js";
import { startRemoteSession, streamRemoteProgress } from "../remote/worker-client.js";
import { saveRemoteSession, type RemoteSession } from "../remote/session-store.js";
import { deployForTui } from "../remote/deploy.js";
import { authGitHubForTui } from "../remote/tui-auth.js";

type SetEvents = React.Dispatch<React.SetStateAction<ChatEvent[]>>;

export interface SlashContext {
  // App-level
  exit: () => void;
  busy: boolean;
  mkKey: () => string;
  setEvents: SetEvents;

  // Config
  cfg: Cfg | null;
  setCfg: React.Dispatch<React.SetStateAction<Cfg | null>>;

  // Mode / reasoning
  mode: Mode;
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  setShowReasoning: React.Dispatch<React.SetStateAction<boolean>>;

  // Misc UI state setters
  setUsage: React.Dispatch<React.SetStateAction<Usage | null>>;
  setSessionUsage: React.Dispatch<React.SetStateAction<DailyUsage | null>>;
  setGatewayMeta: React.Dispatch<React.SetStateAction<GatewayMeta | null>>;
  setHasUpdate: React.Dispatch<React.SetStateAction<boolean>>;
  setLatestVersion: React.Dispatch<React.SetStateAction<string | null>>;

  // Modal setters
  setShowThemePicker: (v: boolean) => void;
  setShowUiPicker: (v: boolean) => void;
  setShowModelPicker: (v: boolean) => void;
  setShowModePicker: (v: boolean) => void;
  setKeyEntryFor: (v: ModelEntry | null) => void;
  setBillingChooserFor: (v: ModelEntry | null) => void;
  setUnifiedProbeFor: (v: ModelEntry | null) => void;
  setShowInboxModal: (v: boolean) => void;
  setShowMultiAgentModal: (v: boolean) => void;
  setShowLspWizard: (v: boolean) => void;
  setShowRemoteDashboard: (v: boolean) => void;
  setShowCommandList: (v: boolean) => void;
  setCommandWizard: (v: { mode: "create" | "edit"; command?: CustomCommand } | null) => void;
  setCommandPicker: (v: { mode: "edit" | "delete" } | null) => void;
  setShowHooksDashboard: (v: boolean) => void;
  setShowHelpMenu: (v: boolean) => void;
  setShowMemoryPicker: (v: boolean) => void;
  setShowGatewayPicker: (v: boolean) => void;
  setShowSkillsPicker: (v: boolean) => void;
  setShowShellPicker: (v: boolean) => void;

  // LSP scope (for /lsp scope)
  lspScope: "project" | "global";
  lspProjectPath: string | null;

  // Async actions exposed by useCallback hooks in App
  resetSession: () => void;
  clearTaskTracking: () => void;
  openResumePicker: () => void | Promise<void>;
  runCompact: () => Promise<void> | void;
  runInit: () => Promise<void> | void;
  initMcp: () => Promise<void> | void;
  initLsp: () => Promise<void> | void;
  ensureSessionId: () => unknown;

  // Refs
  lspManagerRef: React.MutableRefObject<LspManager>;
  mcpManagerRef: React.MutableRefObject<McpManager>;
  hooksManagerRef: React.MutableRefObject<HooksManager>;
  cacheStableRef: React.MutableRefObject<boolean>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  flushTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingTextRef: React.MutableRefObject<Map<number, { text: string; reasoning: string }>>;
  activeAsstIdRef: React.MutableRefObject<number | null>;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  usageRef: React.MutableRefObject<Usage | null>;
  turnCounterRef: React.MutableRefObject<number>;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  executorRef: React.MutableRefObject<ToolExecutor>;
  mcpToolsRef: React.MutableRefObject<ToolSpec[]>;
  mcpInitRef: React.MutableRefObject<boolean>;
  lspToolsRef: React.MutableRefObject<ToolSpec[]>;
  lspInitRef: React.MutableRefObject<boolean>;
  sessionIdRef: React.MutableRefObject<string | null>;
  compactSuggestedRef: React.MutableRefObject<boolean>;
  updateNudgedRef: React.MutableRefObject<boolean>;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  compiledContextRef: React.MutableRefObject<boolean>;
  lastApiErrorRef: React.MutableRefObject<{ httpStatus?: number; code?: number; message: string } | null>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
}

type Handler = (ctx: SlashContext, rest: string[], arg: string) => boolean;

// ── Handlers ─────────────────────────────────────────────────────────────

const handleExit: Handler = (ctx) => {
  void ctx.lspManagerRef.current.stopAll().finally(() => ctx.exit());
  return true;
};

const handleClear: Handler = (ctx) => {
  const { busy, mkKey, setEvents } = ctx;
  if (busy) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "can't /clear while model is running — press Esc to interrupt first" },
    ]);
    return true;
  }
  if (ctx.cacheStableRef.current && ctx.messagesRef.current.length >= 2) {
    ctx.messagesRef.current = [ctx.messagesRef.current[0]!, ctx.messagesRef.current[1]!];
  } else {
    ctx.messagesRef.current = [ctx.messagesRef.current[0]!];
  }
  ctx.resetSession();
  ctx.executorRef.current.clearArtifacts();
  if (ctx.flushTimeoutRef.current) {
    clearTimeout(ctx.flushTimeoutRef.current);
    ctx.flushTimeoutRef.current = null;
  }
  ctx.pendingTextRef.current.clear();
  ctx.activeAsstIdRef.current = null;
  ctx.pendingToolCallsRef.current.clear();
  ctx.usageRef.current = null;
  ctx.turnCounterRef.current = 0;
  setEvents([]);
  ctx.setUsage(null);
  ctx.setSessionUsage(null);
  ctx.gatewayMetaRef.current = null;
  ctx.setGatewayMeta(null);
  ctx.clearTaskTracking();
  ctx.compactSuggestedRef.current = false;
  ctx.updateNudgedRef.current = false;
  return true;
};

const handleReasoning: Handler = (ctx) => {
  ctx.setShowReasoning((s) => {
    const next = !s;
    ctx.setEvents((e) => [
      ...e,
      { kind: "info", key: ctx.mkKey(), text: `reasoning: ${next ? "shown" : "hidden"}` },
    ]);
    return next;
  });
  return true;
};

const handleCost: Handler = (ctx, _rest, arg) => {
  const { cfg, setCfg, setEvents, mkKey, sessionIdRef } = ctx;
  if (!cfg) return true;
  if (arg === "on") {
    const next = { ...cfg, costAttribution: true };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "cost attribution enabled" }]);
    return true;
  }
  if (arg === "off") {
    const next = { ...cfg, costAttribution: false };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "cost attribution disabled" }]);
    return true;
  }
  void getCostReport(sessionIdRef.current ?? undefined)
    .then(async (report) => {
      const lines = [formatCostReport(report)];
      if (cfg?.aiGatewayId && process.env.KIMIFLARE_DISABLE_AI_GATEWAY !== "1") {
        const sid = sessionIdRef.current;
        const logs = sid ? await getSessionGatewayLogs(sid).catch(() => []) : [];
        const gwSection = formatGatewaySection(report, cfg.accountId, cfg.aiGatewayId, logs);
        if (gwSection) lines.push("", gwSection);

        // Pull per-feature cost from the Gateway logs API (1-hour cache),
        // and surface drift status alongside the local total.
        try {
          const { reconcileWithCloudflare } = await import("../cost-attribution/reconcile.js");
          const today = new Date().toISOString().slice(0, 10);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
          const recon = await reconcileWithCloudflare({
            localCost: report.month.cost,
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            gatewayId: cfg.aiGatewayId,
            startDate: sevenDaysAgo,
            endDate: today,
          });
          const breakdown = formatFeatureBreakdown(recon.featureBreakdown);
          if (breakdown) lines.push("", breakdown);
        } catch {
          /* best-effort; /cost still renders without the breakdown */
        }
      }
      if (cfg?.costAttribution) {
        const { getCategoryReportText } = await import("../cost-attribution/tui-report.js");
        const catReport = await getCategoryReportText(sessionIdRef.current ?? undefined);
        if (catReport) {
          lines.push("", "─── Cost by task type ───", catReport);
        }
      }
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    })
    .catch((err) => {
      setEvents((e) => [
        ...e,
        { kind: "error", key: mkKey(), text: `cost report failed: ${(err as Error).message}` },
      ]);
    });
  return true;
};

const handleShell: Handler = (ctx, _rest, arg) => {
  const { cfg, setCfg, setEvents, mkKey } = ctx;
  if (!cfg) return true;
  if (!arg) {
    ctx.setShowShellPicker(true);
    return true;
  }
  if (arg === "auto" || arg === "bash" || arg === "cmd" || arg === "powershell") {
    const next = { ...cfg, shell: arg === "auto" ? undefined : arg };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `shell set to ${arg}` }]);
    return true;
  }
  if (arg) {
    // Allow absolute paths as custom shells
    const next = { ...cfg, shell: arg };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `shell set to ${arg}` }]);
    return true;
  }
  const detected = getShellCommand(cfg.shell);
  setEvents((e) => [
    ...e,
    {
      kind: "info",
      key: mkKey(),
      text: `shell: ${cfg.shell ?? "auto"} (${detected.shell} ${detected.args.join(" ")})`,
    },
  ]);
  return true;
};

const handleModel: Handler = (ctx, rest, arg) => {
  const { cfg, setCfg, setEvents, mkKey } = ctx;
  const sub = rest[0]?.toLowerCase() ?? "";

  // `/model` with no args → open the picker
  if (!arg) {
    ctx.setShowModelPicker(true);
    return true;
  }

  // `/model list` → textual list grouped by provider
  if (sub === "list") {
    const all = listModels();
    const byProvider = new Map<string, ModelEntry[]>();
    for (const m of all) {
      const arr = byProvider.get(m.provider) ?? [];
      arr.push(m);
      byProvider.set(m.provider, arr);
    }
    const lines: string[] = [`available models (current: ${cfg?.model ?? "unknown"}):`];
    for (const [provider, list] of byProvider) {
      lines.push(`  ${provider}:`);
      for (const m of list) {
        const marker = m.id === cfg?.model ? "●" : " ";
        const ctxStr = m.contextWindow >= 1_000_000
          ? `${(m.contextWindow / 1_000_000).toFixed(1)}M`
          : `${Math.round(m.contextWindow / 1_000)}k`;
        const price = m.pricing.inputPerMtok === 0 && m.pricing.outputPerMtok === 0
          ? "price n/a"
          : `$${m.pricing.inputPerMtok}/$${m.pricing.outputPerMtok}`;
        lines.push(`    ${marker} ${m.id}  (${ctxStr} ctx, ${price}, ${m.billingMode})`);
      }
    }
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    return true;
  }

  // `/model <id>` → set directly, then route through the same decision table
  // as the picker (Workers-AI → ready; Unified-eligible → chooser; BYOK-only → key entry).
  try {
    validateModelId(arg);
  } catch {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `invalid model id: ${arg}` },
    ]);
    return true;
  }
  const entry = getModelOrInfer(arg);
  setCfg((prev) => {
    if (!prev) return prev;
    const updated = { ...prev, model: arg };
    void saveConfig(updated).catch(() => {});
    return updated;
  });
  setEvents((e) => [
    ...e,
    {
      kind: "info",
      key: mkKey(),
      text: `model: ${arg} · ${entry.contextWindow.toLocaleString()} ctx`,
    },
  ]);

  const next = decideNextStep(cfg, entry);
  if (next.kind === "needs-gateway") {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `⚠ no AI Gateway configured — run /gateway <id>` },
    ]);
  } else if (next.kind === "billing-choice") {
    ctx.setBillingChooserFor(entry);
  } else if (next.kind === "needs-key") {
    ctx.setKeyEntryFor(entry);
  }
  return true;
};

const handleGateway: Handler = (ctx, rest) => {
  const { cfg, setCfg, setEvents, mkKey, sessionIdRef } = ctx;
  if (!cfg) {
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no config loaded" }]);
    return true;
  }
  const sub = rest[0]?.toLowerCase() ?? "";
  const subArg = rest.slice(1).join(" ").trim();

  if (!sub) {
    ctx.setShowGatewayPicker(true);
    return true;
  }

  if (sub === "status") {
    const lines: string[] = [];
    if (cfg.aiGatewayId) {
      lines.push(`gateway: ${cfg.aiGatewayId}`);
      lines.push(`cache-ttl: ${cfg.aiGatewayCacheTtl ?? "default"}`);
      lines.push(`skip-cache: ${cfg.aiGatewaySkipCache ?? false}`);
      lines.push(`collect-logs: ${cfg.aiGatewayCollectLogPayload ?? false}`);
      const meta = cfg.aiGatewayMetadata;
      lines.push(`metadata: ${meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : "none"}`);
      // Tack on the live cache-hit ratio for the current session — derived
      // from the cf-aig-cache-status headers we've collected so far.
      const sid = sessionIdRef.current;
      if (sid) {
        void getCostReport(sid)
          .then((report) => {
            const req = report.session.gatewayRequests ?? 0;
            if (req === 0) return;
            const cached = report.session.gatewayCachedRequests ?? 0;
            const pct = ((cached / req) * 100).toFixed(1);
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `cache hits (session): ${cached}/${req} (${pct}%)` },
            ]);
          })
          .catch(() => {});
      }
    } else {
      lines.push("gateway: off (direct Workers AI)");
    }
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    return true;
  }

  if (sub === "off") {
    const next = { ...cfg, aiGatewayId: undefined };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "gateway disabled — using direct Workers AI" }]);
    return true;
  }

  if (sub === "cache-ttl") {
    const ttl = parseInt(subArg, 10);
    if (Number.isNaN(ttl) || ttl < 0) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /gateway cache-ttl <seconds>" }]);
      return true;
    }
    const next = { ...cfg, aiGatewayCacheTtl: ttl };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway cache-ttl set to ${ttl}s` }]);
    return true;
  }

  if (sub === "skip-cache") {
    const val = subArg === "true" ? true : subArg === "false" ? false : undefined;
    if (val === undefined) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /gateway skip-cache true|false" }]);
      return true;
    }
    const next = { ...cfg, aiGatewaySkipCache: val };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway skip-cache set to ${val}` }]);
    return true;
  }

  if (sub === "collect-logs") {
    const val = subArg === "true" ? true : subArg === "false" ? false : undefined;
    if (val === undefined) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /gateway collect-logs true|false" }]);
      return true;
    }
    const next = { ...cfg, aiGatewayCollectLogPayload: val };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway collect-logs set to ${val}` }]);
    return true;
  }

  if (sub === "metadata") {
    if (subArg === "clear") {
      const next = { ...cfg, aiGatewayMetadata: undefined };
      setCfg(next);
      void saveConfig(next).catch(() => {});
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "gateway metadata cleared" }]);
      return true;
    }
    const eq = subArg.indexOf("=");
    if (eq === -1) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "usage: /gateway metadata KEY=VALUE  or  /gateway metadata clear" },
      ]);
      return true;
    }
    const key = subArg.slice(0, eq).trim();
    let value: string | number | boolean = subArg.slice(eq + 1).trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
    const nextMeta = { ...(cfg.aiGatewayMetadata ?? {}), [key]: value };
    const next = { ...cfg, aiGatewayMetadata: nextMeta };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `gateway metadata: ${key}=${JSON.stringify(value)}` },
    ]);
    return true;
  }

  // Default: treat sub as a gateway ID to enable
  const next = { ...cfg, aiGatewayId: rest[0] };
  setCfg(next);
  void saveConfig(next).catch(() => {});
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway enabled: ${rest[0]}` }]);
  return true;
};

const handleMode: Handler = (ctx, _rest, arg) => {
  const { setEvents, mkKey } = ctx;
  if (!arg) {
    ctx.setShowModePicker(true);
    return true;
  }
  if (arg === "edit" || arg === "plan" || arg === "auto" || arg === "multi-agent-experimental") {
    ctx.setMode(arg);
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `mode: ${arg}` }]);
    return true;
  }
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /mode edit|plan|auto|multi-agent-experimental" }]);
  return true;
};

const handleMultiAgent: Handler = (ctx, rest, _arg) => {
  const { cfg, setCfg, setEvents, mkKey, setMode, mode } = ctx;
  if (!cfg) {
    setEvents((e) => [...e, { kind: "error", key: mkKey(), text: "no config loaded — credentials not set up" }]);
    return true;
  }
  const sub = (rest[0] ?? "").toLowerCase();
  // No subcommand → open the proper arrow-nav settings modal.
  if (!sub) {
    ctx.setShowMultiAgentModal(true);
    return true;
  }
  const value = rest.slice(1).join(" ").trim();
  const persist = (patch: Partial<typeof cfg>, msg: string, kind: "info" | "success" | "error" = "success") => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: kind === "success" ? "info" : kind, key: mkKey(), text: msg }]);
  };

  if (sub === "enable") {
    persist({ multiAgentEnabled: true }, "multi-agent enabled — Shift-Tab to switch modes");
    if (!cfg.workerEndpoint) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "tip: run /multi-agent endpoint <url> to set your endpoint, or open /multi-agent and pick Set up to deploy one" }]);
    }
    return true;
  }
  if (sub === "disable") {
    persist({ multiAgentEnabled: false }, "multi-agent disabled");
    if (mode === "multi-agent-experimental") setMode("edit");
    return true;
  }
  if (sub === "execute") {
    persist({ autoExecute: true }, "auto-execute on — after research, a 4th worker will implement + open a PR");
    return true;
  }
  if (sub === "no-execute") {
    persist({ autoExecute: false }, "auto-execute off — research only");
    return true;
  }
  if (sub === "endpoint") {
    if (!value) {
      setEvents((e) => [...e, { kind: "error", key: mkKey(), text: "usage: /multi-agent endpoint <url>" }]);
      return true;
    }
    persist({ workerEndpoint: value }, `endpoint set: ${value}`);
    return true;
  }
  if (sub === "worker-secret" || sub === "api-key") {
    // api-key kept as a deprecated alias.
    if (!value) {
      setEvents((e) => [...e, { kind: "error", key: mkKey(), text: "usage: /multi-agent worker-secret <secret>" }]);
      return true;
    }
    persist({ workerApiKey: value }, "worker secret set");
    return true;
  }
  if (sub === "status" || sub === "") {
    const lines = [
      "multi-agent status:",
      `  enabled:        ${cfg.multiAgentEnabled ? "yes" : "no"}`,
      `  endpoint:       ${cfg.workerEndpoint ?? "(not set)"}`,
      `  worker secret:  ${cfg.workerApiKey ? "(set)" : "(auto-managed by Set up)"}`,
      `  auto-implement: ${cfg.autoExecute ? "yes" : "no"}`,
      "",
      "subcommands: enable | disable | execute | no-execute | endpoint <url> | worker-secret <secret> | status",
    ];
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    return true;
  }
  setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `unknown subcommand: ${sub}. Run /multi-agent status for help.` }]);
  return true;
};

const handleTheme: Handler = (ctx, _rest, arg) => {
  const { setEvents, mkKey } = ctx;
  if (!arg) {
    ctx.setShowThemePicker(true);
    return true;
  }
  const next = resolveTheme(arg);
  if (next.name === DEFAULT_THEME_NAME && arg !== DEFAULT_THEME_NAME) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `unknown theme "${arg}" — available: ${themeNames().join(", ")}` },
    ]);
    return true;
  }
  ctx.setCfg((prev) => {
    if (!prev) return prev;
    const updated = { ...prev, theme: next.name };
    void saveConfig(updated).catch(() => {});
    return updated;
  });
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `theme: ${next.label} — restart to apply` }]);
  return true;
};

const handleUi: Handler = (ctx, _rest, arg) => {
  const { setEvents, mkKey } = ctx;
  // No-arg form opens the arrow-key picker (matches `/theme`, `/resume`).
  // Direct-arg form is still supported for muscle-memory and scripts.
  if (!arg) {
    ctx.setShowUiPicker(true);
    return true;
  }
  if (arg !== "ink" && arg !== "camouflage") {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `unknown UI engine "${arg}" — choose "ink" or "camouflage"` },
    ]);
    return true;
  }
  const next = arg as "ink" | "camouflage";
  ctx.setCfg((prev) => {
    if (!prev) return prev;
    const updated = { ...prev, uiEngine: next } as Cfg;
    void saveConfig(updated).catch(() => {});
    return updated;
  });
  // Loud red "error"-kind event so the user can't miss that they need to
  // restart. Also reminds them of the env-var escape hatch in case the
  // new engine is broken on their machine.
  setEvents((e) => [
    ...e,
    {
      kind: "error",
      key: mkKey(),
      text:
        `UI engine set to "${next}". RESTART kimiflare for it to take effect.` +
        (next === "camouflage"
          ? " (Camouflage is EXPERIMENTAL — `kimiflare --ui ink` or `unset KIMIFLARE_UI` to bail.)"
          : ""),
    },
  ]);
  return true;
};

const handlePlan: Handler = (ctx) => {
  ctx.setMode("plan");
  ctx.setEvents((e) => [...e, { kind: "info", key: ctx.mkKey(), text: "mode: plan" }]);
  return true;
};

const handleAuto: Handler = (ctx) => {
  ctx.setMode("auto");
  ctx.setEvents((e) => [...e, { kind: "info", key: ctx.mkKey(), text: "mode: auto" }]);
  return true;
};

const handleEdit: Handler = (ctx) => {
  ctx.setMode("edit");
  ctx.setEvents((e) => [...e, { kind: "info", key: ctx.mkKey(), text: "mode: edit" }]);
  return true;
};

const handleSkills: Handler = (ctx, rest) => {
  const { setEvents, mkKey } = ctx;
  const sub = rest[0]?.toLowerCase() ?? "";
  const subRest = rest.slice(1).join(" ").trim();

  if (sub === "") {
    ctx.setShowSkillsPicker(true);
    return true;
  }

  if (sub === "list") {
    void listAllSkills(process.cwd())
      .then((all) => {
        const lines: string[] = [];
        if (all.project.length > 0) {
          lines.push("project skills:");
          for (const s of all.project) {
            const status = s.enabled ? "✓" : "✗";
            lines.push(`  ${status} ${s.name} — ${s.description || "no description"} (${s.estimatedTokens} tokens)`);
          }
        }
        if (all.global.length > 0) {
          lines.push("global skills:");
          for (const s of all.global) {
            const status = s.enabled ? "✓" : "✗";
            lines.push(`  ${status} ${s.name} — ${s.description || "no description"} (${s.estimatedTokens} tokens)`);
          }
        }
        if (lines.length === 0) {
          lines.push("no skills found. create one with /skills add <name>");
        }
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to list skills: ${(err as Error).message}` }]);
      });
    return true;
  }

  if (sub === "add") {
    const name = subRest.trim();
    if (!name) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /skills add <name>" }]);
      return true;
    }
    void createSkill({ name, scope: "project", cwd: process.cwd() })
      .then((result) => {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `created skill '${name}' → ${result.filepath}` },
          { kind: "info", key: mkKey(), text: `edit the file to add your instructions` },
        ]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to create skill: ${(err as Error).message}` }]);
      });
    return true;
  }

  if (sub === "edit") {
    const name = subRest.trim();
    if (!name) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /skills edit <name>" }]);
      return true;
    }
    void findSkillFile(name, process.cwd())
      .then((filepath) => {
        if (!filepath) {
          setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `skill '${name}' not found` }]);
          return;
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `skill '${name}' → ${filepath}` },
          { kind: "info", key: mkKey(), text: `open it in your editor to make changes` },
        ]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to find skill: ${(err as Error).message}` }]);
      });
    return true;
  }

  if (sub === "delete") {
    const name = subRest.trim();
    if (!name) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /skills delete <name>" }]);
      return true;
    }
    void deleteSkill(name, process.cwd())
      .then((result) => {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `deleted skill '${name}' (${result.filepath})` }]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to delete skill: ${(err as Error).message}` }]);
      });
    return true;
  }

  if (sub === "enable") {
    const name = subRest.trim();
    if (!name) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /skills enable <name>" }]);
      return true;
    }
    void setSkillEnabled(name, true, process.cwd())
      .then((result) => {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `enabled skill '${name}' (${result.filepath})` }]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to enable skill: ${(err as Error).message}` }]);
      });
    return true;
  }

  if (sub === "disable") {
    const name = subRest.trim();
    if (!name) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /skills disable <name>" }]);
      return true;
    }
    void setSkillEnabled(name, false, process.cwd())
      .then((result) => {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `disabled skill '${name}' (${result.filepath})` }]);
      })
      .catch((err) => {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to disable skill: ${(err as Error).message}` }]);
      });
    return true;
  }

  setEvents((e) => [
    ...e,
    {
      kind: "info",
      key: mkKey(),
      text: "usage: /skills list | add <name> | edit <name> | delete <name> | enable <name> | disable <name>",
    },
  ]);
  return true;
};

const handleMemory: Handler = (ctx, _rest, arg) => {
  const { cfg, setCfg, setEvents, mkKey, memoryManagerRef } = ctx;
  if (!cfg) return true;
  if (!arg) {
    ctx.setShowMemoryPicker(true);
    return true;
  }
  if (arg === "on") {
    const next = { ...cfg, memoryEnabled: true };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "memory", key: mkKey(), text: "memory enabled" }]);
    return true;
  }
  if (arg === "off") {
    const next = { ...cfg, memoryEnabled: false };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "memory", key: mkKey(), text: "memory disabled" }]);
    return true;
  }
  if (!cfg.memoryEnabled) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "memory is disabled. Use /memory on to enable it, or set KIMIFLARE_MEMORY_ENABLED=1" },
    ]);
    return true;
  }
  if (arg === "clear") {
    const cleared = memoryManagerRef.current?.clearRepo(process.cwd()) ?? 0;
    setEvents((e) => [...e, { kind: "memory", key: mkKey(), text: `cleared ${cleared} memories for this repo` }]);
    return true;
  }
  if (arg.startsWith("search ")) {
    const query = arg.slice(7).trim();
    if (!query) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /memory search <query>" }]);
      return true;
    }
    void memoryManagerRef.current?.recall({ text: query, repoPath: process.cwd(), limit: 10 }).then((results) => {
      if (results.length === 0) {
        setEvents((es) => [...es, { kind: "info", key: mkKey(), text: "no memories found" }]);
      } else {
        const lines = results.map((r) => `  [${r.memory.category}] ${r.memory.content} (score: ${r.combinedScore.toFixed(2)})`);
        setEvents((es) => [...es, { kind: "info", key: mkKey(), text: `memories:\n${lines.join("\n")}` }]);
      }
    });
    return true;
  }
  const stats = memoryManagerRef.current?.getStats();
  if (stats) {
    const sizeKb = Math.round(stats.dbSizeBytes / 1024);
    const lines = [
      `total: ${stats.totalCount} memories (${sizeKb} KB)`,
      `  fact: ${stats.byCategory.fact}, event: ${stats.byCategory.event}, instruction: ${stats.byCategory.instruction}`,
      `  task: ${stats.byCategory.task}, preference: ${stats.byCategory.preference}`,
      `last cleanup: ${stats.lastCleanupAt ? new Date(stats.lastCleanupAt).toISOString() : "never"}`,
    ];
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
  } else {
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "memory manager not initialized" }]);
  }
  return true;
};

const handleResume: Handler = (ctx) => {
  void ctx.openResumePicker();
  return true;
};

const handleCheckpoint: Handler = (ctx, rest, arg) => {
  const { setEvents, mkKey, sessionIdRef } = ctx;

  // `/checkpoint list` → list checkpoints (replaces old `/checkpoints`)
  if (arg === "list") {
    const currentId = sessionIdRef.current;
    if (!currentId) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no active session" }]);
      return true;
    }
    void (async () => {
      try {
        const { sessionsDir } = await import("../sessions.js");
        const file = await loadSession(join(sessionsDir(), `${currentId}.json`));
        const cps = file.checkpoints ?? [];
        if (cps.length === 0) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no checkpoints in this session" }]);
          return;
        }
        const lines = [
          "checkpoints:",
          ...cps.map(
            (cp, i) =>
              `  ${i + 1}. "${cp.label}" — turn ${cp.turnIndex} · ${new Date(cp.timestamp).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`,
          ),
        ];
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
      } catch (e) {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `failed to list checkpoints: ${(e as Error).message}` },
        ]);
      }
    })();
    return true;
  }

  const label = rest.join(" ").trim() || `checkpoint ${new Date().toLocaleString()}`;
  const turnIndex = ctx.messagesRef.current.length;
  if (turnIndex === 0) {
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "nothing to checkpoint yet" }]);
    return true;
  }
  const cp: Checkpoint = {
    id: `cp_${Date.now()}`,
    label,
    turnIndex,
    timestamp: new Date().toISOString(),
    sessionState: ctx.compiledContextRef.current ? ctx.sessionStateRef.current : undefined,
    artifactStore: serializeArtifactStore(ctx.artifactStoreRef.current),
  };
  void (async () => {
    try {
      ctx.ensureSessionId();
      const { sessionsDir } = await import("../sessions.js");
      const filePath = join(sessionsDir(), `${ctx.sessionIdRef.current}.json`);
      await addCheckpoint(filePath, cp);
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `checkpoint saved: "${label}"` }]);
    } catch (e) {
      setEvents((es) => [
        ...es,
        { kind: "error", key: mkKey(), text: `checkpoint failed: ${(e as Error).message}` },
      ]);
    }
  })();
  return true;
};

const handleCompact: Handler = (ctx) => {
  void ctx.runCompact();
  return true;
};

const handleInit: Handler = (ctx) => {
  void ctx.runInit();
  return true;
};

const handleUpdate: Handler = (ctx) => {
  const { setEvents, mkKey } = ctx;
  void checkForUpdate(true).then((result) => {
    if (result.hasUpdate) {
      ctx.setHasUpdate(true);
      ctx.setLatestVersion(result.latestVersion);
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `update available: ${result.localVersion} → ${result.latestVersion}` },
      ]);
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "run:  npm update -g kimiflare  then restart" },
      ]);
    } else {
      ctx.setHasUpdate(false);
      ctx.setLatestVersion(null);
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no update available" }]);
    }
  });
  return true;
};

const handleMcp: Handler = (ctx, _rest, arg) => {
  const { setEvents, mkKey, busy } = ctx;
  if (arg === "list") {
    const servers = ctx.mcpManagerRef.current.listServers();
    if (servers.length === 0) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "no MCP servers connected — add them to ~/.config/kimiflare/config.json" },
      ]);
    } else {
      const lines = servers.map((s) => `  ${s.name} (${s.type}) — ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`);
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "MCP servers:\n" + lines.join("\n") }]);
    }
    return true;
  }
  if (arg === "reload") {
    if (busy) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /mcp reload while model is running" }]);
      return true;
    }
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "reloading MCP servers..." }]);
    for (const tool of ctx.mcpToolsRef.current) {
      ctx.executorRef.current.unregister(tool.name);
    }
    ctx.mcpToolsRef.current = [];
    ctx.mcpInitRef.current = false;
    void ctx.initMcp();
    return true;
  }
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /mcp list | reload" }]);
  return true;
};

const handleLsp: Handler = (ctx, _rest, arg) => {
  const { setEvents, mkKey, busy, lspScope, lspProjectPath } = ctx;
  if (arg === "list") {
    const servers = ctx.lspManagerRef.current.listActive();
    const scopeLine =
      lspScope === "project" && lspProjectPath ? ` (project: ${lspProjectPath})` : " (global config)";
    if (servers.length === 0) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `no LSP servers active${scopeLine}` }]);
    } else {
      const lines = servers.map(
        (s) => `  ${s.id} (${s.rootUri}) — ${s.state}, ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`,
      );
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `LSP servers${scopeLine}:\n` + lines.join("\n") },
      ]);
    }
    return true;
  }
  if (arg === "reload") {
    if (busy) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /lsp reload while model is running" }]);
      return true;
    }
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "reloading LSP servers..." }]);
    for (const tool of ctx.lspToolsRef.current) {
      ctx.executorRef.current.unregister(tool.name);
    }
    ctx.lspToolsRef.current = [];
    ctx.lspInitRef.current = false;
    void Promise.resolve(ctx.initLsp()).catch((e) => {
      setEvents((es) => [
        ...es,
        { kind: "error", key: mkKey(), text: `LSP reload failed: ${(e as Error).message}` },
      ]);
    });
    return true;
  }
  if (arg === "scope") {
    const scopeText =
      lspScope === "project" && lspProjectPath
        ? `project scope: ${lspProjectPath}`
        : "global scope: ~/.config/kimiflare/config.json";
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: scopeText }]);
    return true;
  }
  if (arg === "config" || arg === "") {
    ctx.setShowLspWizard(true);
    return true;
  }
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /lsp list | reload | scope | config" }]);
  return true;
};

const handleHooks: Handler = (ctx, rest, arg) => {
  const { setEvents, mkKey } = ctx;
  const cwd = process.cwd();

  // M6.1: `/hooks` (no args) opens the interactive dashboard. Typing
  // `/hooks list` keeps the old text-dump behavior for users who
  // prefer that.
  if (arg === "") {
    ctx.setShowHooksDashboard(true);
    return true;
  }

  if (arg === "list") {
    const lines: string[] = [];
    let any = false;
    for (const ev of HOOK_EVENTS) {
      const hooks = ctx.hooksManagerRef.current.hooksFor(ev);
      if (hooks.length === 0) continue;
      any = true;
      lines.push(`${ev}:`);
      for (const h of hooks) {
        const id = h.id ?? "?";
        const en = h.enabled === false ? " [disabled]" : "";
        const src = h.source ? ` (${h.source})` : "";
        const matcher = h.matcher ? `  matcher=${h.matcher}` : "";
        const desc = h.description ? `\n      ${h.description}` : "";
        lines.push(`  ${id}${en}${src}${matcher}\n      $ ${h.command}${desc}`);
      }
    }
    if (!any) {
      lines.push("no hooks configured. Type `/hooks` for the interactive dashboard.");
    }
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    return true;
  }

  if (arg === "recommended") {
    const lines = ["Recommended hooks (all disabled by default):"];
    for (const r of RECOMMENDED_HOOKS) {
      lines.push(`  ${r.id}  [${r.event}]`);
      if (r.hook.description) lines.push(`      ${r.hook.description}`);
    }
    lines.push("");
    lines.push("Enable one with: /hooks enable <id> [global|project]");
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
    return true;
  }

  if (arg === "path") {
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text:
          `global: ${globalSettingsPath()}\n` +
          `project: ${projectSettingsPath(cwd)}`,
      },
    ]);
    return true;
  }

  if (arg === "reload") {
    ctx.hooksManagerRef.current.reload();
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "hooks reloaded" }]);
    return true;
  }

  // `enable <id> [global|project]` — adds a recommended hook to
  // settings.json with `enabled: true`. If the id refers to an
  // existing user hook (recommended or otherwise), flips its
  // `enabled` flag instead.
  if (arg === "enable" || arg === "disable") {
    const id = rest[1];
    if (!id) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `usage: /hooks ${arg} <id> [global|project]` },
      ]);
      return true;
    }
    const scope: "global" | "project" = rest[2] === "global" ? "global" : "project";

    if (arg === "enable") {
      // Existing hook by id → just flip; recommended hook → append.
      const flipped = setHookEnabled(cwd, id, true);
      if (flipped) {
        ctx.hooksManagerRef.current.reload();
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `hook ${id} enabled in ${flipped}` }]);
        return true;
      }
      const rec = getRecommendedHook(id);
      if (!rec) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `no hook with id ${id}. Try /hooks recommended` },
        ]);
        return true;
      }
      const path = appendHook(scope, cwd, rec.event, { ...rec.hook, enabled: true });
      ctx.hooksManagerRef.current.reload();
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `enabled ${rec.id} (${rec.event}) in ${path}` },
      ]);
      return true;
    }

    // disable
    const flipped = setHookEnabled(cwd, id, false);
    if (!flipped) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `no hook with id ${id} to disable` },
      ]);
      return true;
    }
    ctx.hooksManagerRef.current.reload();
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `hook ${id} disabled in ${flipped}` }]);
    return true;
  }

  setEvents((e) => [
    ...e,
    {
      kind: "info",
      key: mkKey(),
      text:
        "usage: /hooks [list | recommended | path | reload | enable <id> [global|project] | disable <id>]",
    },
  ]);
  return true;
};

const handleHello: Handler = (ctx) => {
  const { setEvents, mkKey } = ctx;
  const session = crypto.randomUUID();
  const url = `${FEEDBACK_WORKER_URL}/?s=${session}&v=${getAppVersion()}`;
  openBrowser(url);
  void (async () => {
    try {
      const qr = await QRCode.toString(url, { type: "terminal", small: true });
      const lines = qr.split("\n").map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
      setEvents((e) => [
        ...e,
        {
          kind: "qrcode",
          key: mkKey(),
          lines,
          caption: "Scan this QR code with your phone to send a voice note:",
        },
        { kind: "info", key: mkKey(), text: "Also opened voice note page in your browser." },
      ]);
    } catch {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "Opened voice note page in your browser. Record your message there and hit Send when you're done.",
        },
      ]);
    }
  })();
  return true;
};

const handleInbox: Handler = (ctx) => {
  ctx.setShowInboxModal(true);
  return true;
};

const handleLogout: Handler = (ctx) => {
  unlink(configPath()).catch(() => {});
  ctx.setEvents((e) => [
    ...e,
    { kind: "info", key: ctx.mkKey(), text: `credentials cleared from ${configPath()}` },
  ]);
  ctx.setCfg(null);
  return true;
};

const handleCommand: Handler = (ctx, rest) => {
  const { setEvents, mkKey } = ctx;
  const sub = rest[0]?.toLowerCase() ?? "";
  // `/command` (no args) opens the interactive list — same as `/command list`
  if (sub === "" || sub === "list") {
    ctx.setShowCommandList(true);
    return true;
  }
  if (sub === "create") {
    ctx.setCommandWizard({ mode: "create" });
    return true;
  }
  if (sub === "edit") {
    ctx.setCommandPicker({ mode: "edit" });
    return true;
  }
  if (sub === "delete") {
    ctx.setCommandPicker({ mode: "delete" });
    return true;
  }
  setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /command create | edit | delete | list" }]);
  return true;
};

const handleRemote: Handler = (ctx, rest, arg) => {
  const { setEvents, mkKey, cfg, setCfg, activeScopeRef } = ctx;
  if (arg === "status" || arg === "cancel") {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `Use \`kimiflare remote ${arg}\` from your shell.` },
    ]);
    return true;
  }

  const prompt = rest.join(" ").trim();
  if (!prompt) {
    ctx.setShowRemoteDashboard(true);
    return true;
  }

  const repo = detectGitHubRepo(cfg?.githubRepo);
  if (!repo) {
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "Could not detect GitHub repo. Run from a repo with a GitHub remote, or set githubRepo in config.",
      },
    ]);
    return true;
  }

  (async () => {
    if (!cfg?.remoteWorkerUrl) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "Remote infrastructure not deployed yet. Setting up now (~2 min)..." },
      ]);

      try {
        for await (const step of deployForTui()) {
          setEvents((e) => [
            ...e,
            { kind: step.error ? "error" : "info", key: mkKey(), text: step.message },
          ]);
          if (step.done) break;
        }
      } catch {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: "Deploy failed. Fix the issue above and try /remote again." },
        ]);
        return;
      }

      const { loadConfig: reloadConfig } = await import("../config.js");
      const newCfg = await reloadConfig();
      if (newCfg) setCfg(newCfg);
    }

    const currentCfg = cfg ?? (await loadConfig());
    if (!currentCfg?.remoteWorkerUrl) {
      setEvents((e) => [
        ...e,
        { kind: "error", key: mkKey(), text: "Deploy seemed to succeed but config wasn't saved. Try again." },
      ]);
      return;
    }

    if (!currentCfg.githubOAuthToken) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "GitHub not authenticated. Starting OAuth device flow..." },
      ]);

      try {
        for await (const step of authGitHubForTui()) {
          setEvents((e) => [
            ...e,
            { kind: step.error ? "error" : "info", key: mkKey(), text: step.message },
          ]);
          if (step.done) break;
        }
      } catch {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: "GitHub auth failed. Try `kimiflare auth github` from shell." },
        ]);
        return;
      }

      const { loadConfig: reloadConfig } = await import("../config.js");
      const newCfg = await reloadConfig();
      if (newCfg) setCfg(newCfg);
    }

    const finalCfg = (await loadConfig()) ?? currentCfg;

    const ttl = finalCfg.remoteTtlMinutes ?? 30;
    const budget = finalCfg.remoteMaxInputTokens ?? 5_000_000;
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `Starting remote session for ${repo.owner}/${repo.name}...` },
      { kind: "info", key: mkKey(), text: `Budget: ${formatTokens(budget)} tokens. TTL: ${ttl} min.` },
    ]);

    try {
      const data = await startRemoteSession({
        prompt,
        repo,
        cfg: finalCfg,
        ttlMinutes: finalCfg.remoteTtlMinutes,
        tokensBudget: finalCfg.remoteMaxInputTokens,
      });
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `Session started: ${data.sessionId}` }]);

      for await (const ev of streamRemoteProgress(
        finalCfg.remoteWorkerUrl!,
        data.sessionId,
        activeScopeRef.current?.signal,
      )) {
        const event = ev as Record<string, unknown>;
        if (event.type === "text_delta") {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: String(event.text ?? "") }]);
        } else if (event.type === "tool_call") {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `→ ${String(event.name ?? "")}` }]);
        } else if (event.type === "done") {
          const prUrl = event.prUrl as string | undefined;
          const tokensUsed = event.tokensUsed as number | undefined;
          const tokensBudget = event.tokensBudget as number | undefined;
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: prUrl ? `Done — PR: ${prUrl}` : "Done" },
          ]);
          await saveRemoteSession({
            sessionId: data.sessionId,
            prompt,
            repo: `${repo.owner}/${repo.name}`,
            workerUrl: finalCfg.remoteWorkerUrl!,
            status: "done",
            prUrl,
            tokensUsed,
            tokensBudget,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else if (event.type === "error") {
          const message = String(event.message ?? "");
          const category = event.category as RemoteSession["errorCategory"] | undefined;
          setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `Remote error: ${message}` }]);
          await saveRemoteSession({
            sessionId: data.sessionId,
            prompt,
            repo: `${repo.owner}/${repo.name}`,
            workerUrl: finalCfg.remoteWorkerUrl!,
            status: "error",
            errorCategory: category ?? "unknown",
            errorSummary: message,
            errorMessage: message,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      setEvents((e) => [
        ...e,
        { kind: "error", key: mkKey(), text: `Failed: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    }
  })();

  return true;
};

const handleHelp: Handler = (ctx) => {
  ctx.setShowHelpMenu(true);
  return true;
};

// ── Registry ─────────────────────────────────────────────────────────────

const handlers: Record<string, Handler> = {
  "/exit": handleExit,
  "/clear": handleClear,
  "/reasoning": handleReasoning,
  "/cost": handleCost,
  "/shell": handleShell,
  "/model": handleModel,
  "/gateway": handleGateway,
  "/mode": handleMode,
  "/multi-agent": handleMultiAgent,
  "/theme": handleTheme,
  "/ui": handleUi,
  "/plan": handlePlan,
  "/auto": handleAuto,
  "/edit": handleEdit,
  "/skills": handleSkills,
  "/memory": handleMemory,
  "/resume": handleResume,
  "/checkpoint": handleCheckpoint,
  "/compact": handleCompact,
  "/init": handleInit,
  "/update": handleUpdate,
  "/mcp": handleMcp,
  "/lsp": handleLsp,
  "/hooks": handleHooks,
  "/hello": handleHello,
  "/inbox": handleInbox,
  "/logout": handleLogout,
  "/command": handleCommand,
  "/remote": handleRemote,
  "/help": handleHelp,
};

/**
 * Match the first whitespace-delimited token of `cmd` (lowercased) against
 * the slash-command registry. Returns true if a handler consumed the
 * command, false if `cmd` is unrecognized (so the caller can fall through
 * to custom-command lookup).
 */
export function dispatchSlashCommand(ctx: SlashContext, cmd: string): boolean {
  const raw = cmd.trim();
  const [head, ...rest] = raw.split(/\s+/);
  const c = (head ?? "").toLowerCase();
  const arg = rest.join(" ").trim().toLowerCase();
  const handler = handlers[c];
  if (!handler) return false;
  return handler(ctx, rest, arg);
}
