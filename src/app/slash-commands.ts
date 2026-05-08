// Slash command dispatcher extracted from app.tsx.
// This module intentionally has a large context interface — handleSlash was
// a 1,400-line closure over app.tsx state. The interface captures every
// dependency explicitly so the body can remain mechanically copied.

import type { ChatEvent } from "../ui/chat.js";
import type { Cfg } from "../app.js";
import type { Mode } from "../mode.js";
import type { ToolSpec } from "../tools/registry.js";
import type { Theme } from "../ui/theme.js";
import type { MemoryManager } from "../memory/manager.js";
import type { McpManager } from "../mcp/manager.js";
import type { LspManager } from "../lsp/manager.js";
import type { SessionState } from "../agent/session-state.js";
import type { Checkpoint } from "../sessions.js";
import { serializeArtifactStore } from "../agent/session-state.js";
import { join } from "node:path";
import type { RemoteSession } from "../remote/session-store.js";

export interface SlashCommandContext {
  // --- event pipeline ---
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  mkKey: () => string;
  exit: () => void;

  // --- config / settings ---
  cfg: Cfg | null;
  setCfg: React.Dispatch<React.SetStateAction<Cfg | null>>;
  safeSave: (operation: string, promise: Promise<unknown>) => void;
  saveConfig: (cfg: Cfg) => Promise<unknown>;
  loadConfig: () => Promise<Cfg | null>;
  configPath: () => string;

  // --- mode / theme ---
  mode: Mode;
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  theme: Theme;
  resolveTheme: (name: string) => Theme & { label: string };
  themeNames: () => string[];
  DEFAULT_THEME_NAME: string;

  // --- overlays / wizard ---
  setOverlay: React.Dispatch<React.SetStateAction<any>>;
  setCommandWizard: React.Dispatch<React.SetStateAction<any>>;
  setShowLspWizard: React.Dispatch<React.SetStateAction<boolean>>;
  setShowRemoteDashboard: React.Dispatch<React.SetStateAction<boolean>>;

  // --- session ---
  sessionIdRef: React.MutableRefObject<string | null>;
  sessionCreatedAtRef: React.MutableRefObject<string | null>;
  sessionTitleRef: React.MutableRefObject<string | null>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  ensureSessionId: () => string;
  openResumePicker: () => void;

  // --- agent / turn ---
  busy: boolean;
  activeScopeRef: React.MutableRefObject<{
    abort: (reason: string) => void;
    signal: AbortSignal;
  } | null>;
  setTasks: React.Dispatch<React.SetStateAction<any[]>>;
  setTasksStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTasksStartTokens: React.Dispatch<React.SetStateAction<number>>;
  usageRef: React.MutableRefObject<any>;
  setUsage: React.Dispatch<React.SetStateAction<any>>;
  setSessionUsage: React.Dispatch<React.SetStateAction<any>>;
  gatewayMetaRef: React.MutableRefObject<any>;
  setGatewayMeta: React.Dispatch<React.SetStateAction<any>>;
  compactSuggestedRef: React.MutableRefObject<boolean>;
  updateNudgedRef: React.MutableRefObject<boolean>;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  activeAsstIdRef: React.MutableRefObject<number | null>;
  flushTimeoutRef: React.MutableRefObject<any>;
  pendingTextRef: React.MutableRefObject<any>;
  turnCounterRef: React.MutableRefObject<number>;

  // --- refs for systems ---
  messagesRef: React.MutableRefObject<any>;
  executorRef: React.MutableRefObject<any>;
  artifactStoreRef: React.MutableRefObject<any>;
  cacheStableRef: React.MutableRefObject<boolean>;
  compiledContextRef: React.MutableRefObject<boolean>;
  mcpInitRef: React.MutableRefObject<boolean>;
  lspInitRef: React.MutableRefObject<boolean>;
  mcpToolsRef: React.MutableRefObject<ToolSpec[]>;
  lspToolsRef: React.MutableRefObject<ToolSpec[]>;
  mcpManagerRef: React.MutableRefObject<McpManager>;
  lspManagerRef: React.MutableRefObject<LspManager>;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;

  // --- LSP / MCP ---
  lspScope: "project" | "global";
  lspProjectPath: string | null;
  initMcp: () => Promise<void>;
  initLsp: () => Promise<void>;

  // --- cloud / remote ---
  cloudToken?: string;
  cloudDeviceId?: string;
  initialCloudToken?: string;
  initialCloudDeviceId?: string;

  // --- UI ---
  setShowReasoning: React.Dispatch<React.SetStateAction<boolean>>;
  setHasUpdate: React.Dispatch<React.SetStateAction<boolean>>;
  setLatestVersion: React.Dispatch<React.SetStateAction<string | null>>;

  // --- imported helpers ---
  detectGitHubRepo: (
    cachedRepo?: string,
  ) => { owner: string; name: string } | null;
  openBrowser: (url: string) => void;
  formatTokens: (n: number) => string;
  formatCostReport: (report: any) => string;
  getCostReport: (sessionId?: string) => Promise<any>;
  getAppVersion: () => string;
  listAllSkills: (cwd: string) => Promise<any>;
  createSkill: (opts: any) => Promise<{ filepath: string }>;
  deleteSkill: (name: string, cwd: string) => Promise<{ filepath: string }>;
  setSkillEnabled: (
    name: string,
    enabled: boolean,
    cwd: string,
  ) => Promise<{ filepath: string }>;
  findSkillFile: (name: string, cwd: string) => Promise<string | null>;
  emptySessionState: () => SessionState;
  ArtifactStore: new () => any;
  checkForUpdate: (
    force?: boolean,
  ) => Promise<import("../util/update-check.js").UpdateCheckResult>;
  startRemoteSession: (
    opts: any,
  ) => Promise<{ sessionId: string; streamUrl: string }>;
  streamRemoteProgress: (
    workerUrl: string,
    sessionId: string,
    signal?: AbortSignal,
  ) => AsyncGenerator<unknown, void, void>;
  saveRemoteSession: (opts: any) => Promise<any>;
  deployForTui: () => AsyncGenerator<any, any, any>;
  authGitHubForTui: () => AsyncGenerator<any, any, any>;
  loadSession: (id: string) => Promise<any>;
  addCheckpoint: (sessionId: string, opts: any) => Promise<any>;
  unlink: (path: string) => Promise<void>;
  runCompact: () => Promise<void>;
  runInit: () => Promise<void>;
  FEEDBACK_WORKER_URL: string;
}

export function handleSlash(cmd: string, ctx: SlashCommandContext): boolean {
  const {
    setEvents,
    mkKey,
    exit,
    cfg,
    setCfg,
    safeSave,
    saveConfig,
    loadConfig,
    configPath,
    mode,
    setMode,
    resolveTheme,
    themeNames,
    DEFAULT_THEME_NAME,
    setOverlay,
    setCommandWizard,
    setShowLspWizard,
    setShowRemoteDashboard,
    sessionIdRef,
    sessionCreatedAtRef,
    sessionTitleRef,
    sessionStateRef,
    ensureSessionId,
    openResumePicker,
    busy,
    activeScopeRef,
    setTasks,
    setTasksStartedAt,
    setTasksStartTokens,
    usageRef,
    setUsage,
    setSessionUsage,
    gatewayMetaRef,
    setGatewayMeta,
    compactSuggestedRef,
    updateNudgedRef,
    pendingToolCallsRef,
    activeAsstIdRef,
    flushTimeoutRef,
    pendingTextRef,
    turnCounterRef,
    messagesRef,
    executorRef,
    artifactStoreRef,
    cacheStableRef,
    compiledContextRef,
    mcpInitRef,
    lspInitRef,
    mcpToolsRef,
    lspToolsRef,
    mcpManagerRef,
    lspManagerRef,
    memoryManagerRef,
    lspScope,
    lspProjectPath,
    initMcp,
    initLsp,
    setShowReasoning,
    setHasUpdate,
    setLatestVersion,
    detectGitHubRepo,
    openBrowser,
    formatTokens,
    formatCostReport,
    getCostReport,
    getAppVersion,
    listAllSkills,
    createSkill,
    deleteSkill,
    setSkillEnabled,
    findSkillFile,
    emptySessionState,
    ArtifactStore,
    checkForUpdate,
    startRemoteSession,
    streamRemoteProgress,
    saveRemoteSession,
    deployForTui,
    authGitHubForTui,
    loadSession,
    addCheckpoint,
    unlink,
    runCompact,
    runInit,
    FEEDBACK_WORKER_URL,
  } = ctx;
  const raw = cmd.trim();
  const [head, ...rest] = raw.split(/\s+/);
  const c = (head ?? "").toLowerCase();
  const arg = rest.join(" ").trim().toLowerCase();

  if (c === "/exit" || c === "/quit") {
    void lspManagerRef.current.stopAll().finally(() => exit());
    return true;
  }
  if (c === "/clear") {
    if (busy) {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "can't /clear while model is running — press Esc to interrupt first",
        },
      ]);
      return true;
    }
    if (cacheStableRef.current && messagesRef.current.length >= 2) {
      messagesRef.current = [messagesRef.current[0]!, messagesRef.current[1]!];
    } else {
      messagesRef.current = [messagesRef.current[0]!];
    }
    sessionIdRef.current = null;
    sessionCreatedAtRef.current = null;
    sessionTitleRef.current = null;
    sessionStateRef.current = emptySessionState();
    artifactStoreRef.current = new ArtifactStore();
    executorRef.current.clearArtifacts();
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    pendingTextRef.current.clear();
    activeAsstIdRef.current = null;
    pendingToolCallsRef.current.clear();
    usageRef.current = null;
    turnCounterRef.current = 0;
    setEvents([]);
    setUsage(null);
    setSessionUsage(null);
    gatewayMetaRef.current = null;
    setGatewayMeta(null);
    setTasks([]);
    setTasksStartedAt(null);
    setTasksStartTokens(0);
    compactSuggestedRef.current = false;
    updateNudgedRef.current = false;
    return true;
  }
  if (c === "/reasoning") {
    setShowReasoning((s) => {
      const next = !s;
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `reasoning: ${next ? "shown" : "hidden"}`,
        },
      ]);
      return next;
    });
    return true;
  }
  if (c === "/cost") {
    if (!cfg) return true;
    if (arg === "on") {
      const next = { ...cfg, costAttribution: true };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "cost attribution enabled" },
      ]);
      return true;
    }
    if (arg === "off") {
      const next = { ...cfg, costAttribution: false };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "cost attribution disabled" },
      ]);
      return true;
    }
    void getCostReport(sessionIdRef.current ?? undefined)
      .then(async (report) => {
        const lines = [formatCostReport(report)];
        if (cfg?.costAttribution) {
          const { getCategoryReportText } = await import(
            "../cost-attribution/tui-report.js"
          );
          const catReport = await getCategoryReportText(
            sessionIdRef.current ?? undefined,
          );
          if (catReport) {
            lines.push("", "─── Cost by task type ───", catReport);
          }
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: lines.join("\n") },
        ]);
      })
      .catch((err) => {
        setEvents((e) => [
          ...e,
          {
            kind: "error",
            key: mkKey(),
            text: `cost report failed: ${(err as Error).message}`,
          },
        ]);
      });
    return true;
  }
  if (c === "/model") {
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `current model: ${cfg?.model ?? "unknown"}`,
      },
    ]);
    return true;
  }
  if (c === "/gateway") {
    if (!cfg) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "no config loaded" },
      ]);
      return true;
    }
    if (cfg.cloudMode) {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "AI Gateway is managed by Kimiflare Cloud",
        },
      ]);
      return true;
    }
    const sub = rest[0]?.toLowerCase() ?? "";
    const subArg = rest.slice(1).join(" ").trim();

    if (!sub || sub === "status") {
      const lines: string[] = [];
      if (cfg.aiGatewayId) {
        lines.push(`gateway: ${cfg.aiGatewayId}`);
        lines.push(`cache-ttl: ${cfg.aiGatewayCacheTtl ?? "default"}`);
        lines.push(`skip-cache: ${cfg.aiGatewaySkipCache ?? false}`);
        lines.push(`collect-logs: ${cfg.aiGatewayCollectLogPayload ?? false}`);
        const meta = cfg.aiGatewayMetadata;
        lines.push(
          `metadata: ${meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : "none"}`,
        );
      } else {
        lines.push("gateway: off (direct Workers AI)");
      }
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: lines.join("\n") },
      ]);
      return true;
    }

    if (sub === "off") {
      const next = { ...cfg, aiGatewayId: undefined };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "gateway disabled — using direct Workers AI",
        },
      ]);
      return true;
    }

    if (sub === "cache-ttl") {
      const ttl = parseInt(subArg, 10);
      if (Number.isNaN(ttl) || ttl < 0) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /gateway cache-ttl <seconds>",
          },
        ]);
        return true;
      }
      const next = { ...cfg, aiGatewayCacheTtl: ttl };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `gateway cache-ttl set to ${ttl}s`,
        },
      ]);
      return true;
    }

    if (sub === "skip-cache") {
      const val =
        subArg === "true" ? true : subArg === "false" ? false : undefined;
      if (val === undefined) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /gateway skip-cache true|false",
          },
        ]);
        return true;
      }
      const next = { ...cfg, aiGatewaySkipCache: val };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `gateway skip-cache set to ${val}`,
        },
      ]);
      return true;
    }

    if (sub === "collect-logs") {
      const val =
        subArg === "true" ? true : subArg === "false" ? false : undefined;
      if (val === undefined) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /gateway collect-logs true|false",
          },
        ]);
        return true;
      }
      const next = { ...cfg, aiGatewayCollectLogPayload: val };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `gateway collect-logs set to ${val}`,
        },
      ]);
      return true;
    }

    if (sub === "metadata") {
      if (subArg === "clear") {
        const next = { ...cfg, aiGatewayMetadata: undefined };
        setCfg(next);
        safeSave("saveConfig", saveConfig(next));
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "gateway metadata cleared" },
        ]);
        return true;
      }
      const eq = subArg.indexOf("=");
      if (eq === -1) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /gateway metadata KEY=VALUE  or  /gateway metadata clear",
          },
        ]);
        return true;
      }
      const key = subArg.slice(0, eq).trim();
      let value: string | number | boolean = subArg.slice(eq + 1).trim();
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
      const nextMeta = { ...cfg.aiGatewayMetadata, [key]: value };
      const next = { ...cfg, aiGatewayMetadata: nextMeta };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `gateway metadata: ${key}=${JSON.stringify(value)}`,
        },
      ]);
      return true;
    }

    // Default: treat sub as a gateway ID to enable
    const next = { ...cfg, aiGatewayId: rest[0] };
    setCfg(next);
    safeSave("saveConfig", saveConfig(next));
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: `gateway enabled: ${rest[0]}` },
    ]);
    return true;
  }
  if (c === "/mode") {
    if (!arg) {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `current mode: ${mode}  ·  use /mode edit|plan|auto or shift+tab`,
        },
      ]);
      return true;
    }
    if (arg === "edit" || arg === "plan" || arg === "auto") {
      setMode(arg);
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `mode: ${arg}` },
      ]);
      return true;
    }
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "usage: /mode edit|plan|auto" },
    ]);
    return true;
  }
  if (c === "/theme") {
    if (!arg) {
      setOverlay({ kind: "themePicker" });
      return true;
    }
    const next = resolveTheme(arg);
    if (next.name === DEFAULT_THEME_NAME && arg !== DEFAULT_THEME_NAME) {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `unknown theme "${arg}" — available: ${themeNames().join(", ")}`,
        },
      ]);
      return true;
    }
    setCfg((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, theme: next.name };
      safeSave("saveConfig", saveConfig(updated));
      return updated;
    });
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `theme: ${next.label} — restart to apply`,
      },
    ]);
    return true;
  }
  if (c === "/plan") {
    setMode("plan");
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "mode: plan" },
    ]);
    return true;
  }
  if (c === "/auto") {
    setMode("auto");
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "mode: auto" },
    ]);
    return true;
  }
  if (c === "/edit") {
    setMode("edit");
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "mode: edit" },
    ]);
    return true;
  }
  if (c === "/skills") {
    const sub = rest[0]?.toLowerCase() ?? "";
    const subRest = rest.slice(1).join(" ").trim();

    if (sub === "list" || sub === "") {
      void listAllSkills(process.cwd())
        .then((all) => {
          const lines: string[] = [];
          if (all.project.length > 0) {
            lines.push("project skills:");
            for (const s of all.project) {
              const status = s.enabled ? "✓" : "✗";
              lines.push(
                `  ${status} ${s.name} — ${s.description || "no description"} (${s.estimatedTokens} tokens)`,
              );
            }
          }
          if (all.global.length > 0) {
            lines.push("global skills:");
            for (const s of all.global) {
              const status = s.enabled ? "✓" : "✗";
              lines.push(
                `  ${status} ${s.name} — ${s.description || "no description"} (${s.estimatedTokens} tokens)`,
              );
            }
          }
          if (lines.length === 0) {
            lines.push("no skills found. create one with /skills add <name>");
          }
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: lines.join("\n") },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to list skills: ${(err as Error).message}`,
            },
          ]);
        });
      return true;
    }

    if (sub === "add") {
      const name = subRest.trim();
      if (!name) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "usage: /skills add <name>" },
        ]);
        return true;
      }
      void createSkill({ name, scope: "project", cwd: process.cwd() })
        .then((result) => {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `created skill '${name}' → ${result.filepath}`,
            },
            {
              kind: "info",
              key: mkKey(),
              text: `edit the file to add your instructions`,
            },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to create skill: ${(err as Error).message}`,
            },
          ]);
        });
      return true;
    }

    if (sub === "edit") {
      const name = subRest.trim();
      if (!name) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /skills edit <name>",
          },
        ]);
        return true;
      }
      void findSkillFile(name, process.cwd())
        .then((filepath) => {
          if (!filepath) {
            setEvents((e) => [
              ...e,
              {
                kind: "error",
                key: mkKey(),
                text: `skill '${name}' not found`,
              },
            ]);
            return;
          }
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `skill '${name}' → ${filepath}`,
            },
            {
              kind: "info",
              key: mkKey(),
              text: `open it in your editor to make changes`,
            },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to find skill: ${(err as Error).message}`,
            },
          ]);
        });
      return true;
    }

    if (sub === "delete") {
      const name = subRest.trim();
      if (!name) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /skills delete <name>",
          },
        ]);
        return true;
      }
      void deleteSkill(name, process.cwd())
        .then((result) => {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `deleted skill '${name}' (${result.filepath})`,
            },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to delete skill: ${(err as Error).message}`,
            },
          ]);
        });
      return true;
    }

    if (sub === "enable") {
      const name = subRest.trim();
      if (!name) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /skills enable <name>",
          },
        ]);
        return true;
      }
      void setSkillEnabled(name, true, process.cwd())
        .then((result) => {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `enabled skill '${name}' (${result.filepath})`,
            },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to enable skill: ${(err as Error).message}`,
            },
          ]);
        });
      return true;
    }

    if (sub === "disable") {
      const name = subRest.trim();
      if (!name) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /skills disable <name>",
          },
        ]);
        return true;
      }
      void setSkillEnabled(name, false, process.cwd())
        .then((result) => {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `disabled skill '${name}' (${result.filepath})`,
            },
          ]);
        })
        .catch((err) => {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: `failed to disable skill: ${(err as Error).message}`,
            },
          ]);
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
  }
  if (c === "/memory") {
    if (!cfg) return true;
    if (arg === "on") {
      const next = { ...cfg, memoryEnabled: true };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        { kind: "memory", key: mkKey(), text: "memory enabled" },
      ]);
      return true;
    }
    if (arg === "off") {
      const next = { ...cfg, memoryEnabled: false };
      setCfg(next);
      safeSave("saveConfig", saveConfig(next));
      setEvents((e) => [
        ...e,
        { kind: "memory", key: mkKey(), text: "memory disabled" },
      ]);
      return true;
    }
    if (!cfg.memoryEnabled) {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "memory is disabled. Use /memory on to enable it, or set KIMIFLARE_MEMORY_ENABLED=1",
        },
      ]);
      return true;
    }
    if (arg === "clear") {
      const cleared = memoryManagerRef.current?.clearRepo(process.cwd()) ?? 0;
      setEvents((e) => [
        ...e,
        {
          kind: "memory",
          key: mkKey(),
          text: `cleared ${cleared} memories for this repo`,
        },
      ]);
      return true;
    }
    if (arg.startsWith("search ")) {
      const query = arg.slice(7).trim();
      if (!query) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "usage: /memory search <query>",
          },
        ]);
        return true;
      }
      void memoryManagerRef.current
        ?.recall({ text: query, repoPath: process.cwd(), limit: 10 })
        .then((results) => {
          if (results.length === 0) {
            setEvents((es) => [
              ...es,
              { kind: "info", key: mkKey(), text: "no memories found" },
            ]);
          } else {
            const lines = results.map(
              (r) =>
                `  [${r.memory.category}] ${r.memory.content} (score: ${r.combinedScore.toFixed(2)})`,
            );
            setEvents((es) => [
              ...es,
              {
                kind: "info",
                key: mkKey(),
                text: `memories:\n${lines.join("\n")}`,
              },
            ]);
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
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: lines.join("\n") },
      ]);
    } else {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: "memory manager not initialized",
        },
      ]);
    }
    return true;
  }
  if (c === "/resume") {
    void openResumePicker();
    return true;
  }
  if (c === "/checkpoint") {
    const label =
      rest.join(" ").trim() || `checkpoint ${new Date().toLocaleString()}`;
    const turnIndex = messagesRef.current.length;
    if (turnIndex === 0) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "nothing to checkpoint yet" },
      ]);
      return true;
    }
    const cp: Checkpoint = {
      id: `cp_${Date.now()}`,
      label,
      turnIndex,
      timestamp: new Date().toISOString(),
      sessionState: compiledContextRef.current
        ? sessionStateRef.current
        : undefined,
      artifactStore: serializeArtifactStore(artifactStoreRef.current),
    };
    void (async () => {
      try {
        ensureSessionId();
        const { sessionsDir } = await import("../sessions.js");
        const filePath = join(sessionsDir(), `${sessionIdRef.current}.json`);
        await addCheckpoint(filePath, cp);
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `checkpoint saved: "${label}"`,
          },
        ]);
      } catch (e) {
        setEvents((es) => [
          ...es,
          {
            kind: "error",
            key: mkKey(),
            text: `checkpoint failed: ${(e as Error).message}`,
          },
        ]);
      }
    })();
    return true;
  }
  if (c === "/checkpoints") {
    const currentId = sessionIdRef.current;
    if (!currentId) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "no active session" },
      ]);
      return true;
    }
    void (async () => {
      try {
        const { sessionsDir } = await import("../sessions.js");
        const file = await loadSession(
          join(sessionsDir(), `${currentId}.json`),
        );
        const cps = file.checkpoints ?? [];
        if (cps.length === 0) {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: "no checkpoints in this session",
            },
          ]);
          return;
        }
        const lines = [
          "checkpoints:",
          ...cps.map(
            (cp: any, i: number) =>
              `  ${i + 1}. "${cp.label}" — turn ${cp.turnIndex} · ${new Date(cp.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
          ),
        ];
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: lines.join("\n") },
        ]);
      } catch (e) {
        setEvents((es) => [
          ...es,
          {
            kind: "error",
            key: mkKey(),
            text: `failed to list checkpoints: ${(e as Error).message}`,
          },
        ]);
      }
    })();
    return true;
  }
  if (c === "/compact") {
    void runCompact();
    return true;
  }
  if (c === "/init") {
    void runInit();
    return true;
  }
  if (c === "/update") {
    void checkForUpdate(true).then((result) => {
      if (result.hasUpdate) {
        setHasUpdate(true);
        setLatestVersion(result.latestVersion);
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `update available: ${result.localVersion} → ${result.latestVersion}`,
          },
        ]);
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "run:  npm update -g kimiflare  then restart",
          },
        ]);
      } else {
        setHasUpdate(false);
        setLatestVersion(null);
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "no update available" },
        ]);
      }
    });
    return true;
  }
  if (c === "/mcp") {
    if (arg === "list") {
      const servers = mcpManagerRef.current.listServers();
      if (servers.length === 0) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "no MCP servers connected — add them to ~/.config/kimiflare/config.json",
          },
        ]);
      } else {
        const lines = servers.map(
          (s) =>
            `  ${s.name} (${s.type}) — ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`,
        );
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "MCP servers:\n" + lines.join("\n"),
          },
        ]);
      }
      return true;
    }
    if (arg === "reload") {
      if (busy) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "can't /mcp reload while model is running",
          },
        ]);
        return true;
      }
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "reloading MCP servers..." },
      ]);
      for (const tool of mcpToolsRef.current) {
        executorRef.current.unregister(tool.name);
      }
      mcpToolsRef.current = [];
      mcpInitRef.current = false;
      void initMcp();
      return true;
    }
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "usage: /mcp list | reload" },
    ]);
    return true;
  }
  if (c === "/lsp") {
    if (arg === "list") {
      const servers = lspManagerRef.current.listActive();
      const scopeLine =
        lspScope === "project" && lspProjectPath
          ? ` (project: ${lspProjectPath})`
          : " (global config)";
      if (servers.length === 0) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `no LSP servers active${scopeLine}`,
          },
        ]);
      } else {
        const lines = servers.map(
          (s) =>
            `  ${s.id} (${s.rootUri}) — ${s.state}, ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`,
        );
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `LSP servers${scopeLine}:\n` + lines.join("\n"),
          },
        ]);
      }
      return true;
    }
    if (arg === "reload") {
      if (busy) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "can't /lsp reload while model is running",
          },
        ]);
        return true;
      }
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "reloading LSP servers..." },
      ]);
      for (const tool of lspToolsRef.current) {
        executorRef.current.unregister(tool.name);
      }
      lspToolsRef.current = [];
      lspInitRef.current = false;
      void initLsp().catch((e) => {
        setEvents((es) => [
          ...es,
          {
            kind: "error",
            key: mkKey(),
            text: `LSP reload failed: ${(e as Error).message}`,
          },
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
      setShowLspWizard(true);
      return true;
    }
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "usage: /lsp list | reload | scope | config",
      },
    ]);
    return true;
  }
  if (c === "/hello") {
    const session = crypto.randomUUID();
    const url = `${FEEDBACK_WORKER_URL}/?s=${session}&v=${getAppVersion()}`;
    openBrowser(url);
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "Opened voice note page in your browser. Record your message there and hit Send when you're done.",
      },
    ]);
    return true;
  }
  if (c === "/logout") {
    safeSave("unlink", unlink(configPath()));
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `credentials cleared from ${configPath()}`,
      },
    ]);
    setCfg(null);
    return true;
  }
  if (c === "/command") {
    const sub = rest[0]?.toLowerCase() ?? "";
    if (sub === "create") {
      setCommandWizard({ mode: "create" });
      return true;
    }
    if (sub === "edit") {
      setOverlay({ kind: "commandPicker", mode: "edit" });
      return true;
    }
    if (sub === "delete") {
      setOverlay({ kind: "commandPicker", mode: "delete" });
      return true;
    }
    if (sub === "list") {
      setOverlay({ kind: "commandList" });
      return true;
    }
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "usage: /command create | edit | delete | list",
      },
    ]);
    return true;
  }
  if (c === "/remote") {
    if (arg === "status" || arg === "cancel") {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `Use \`kimiflare remote ${arg}\` from your shell.`,
        },
      ]);
      return true;
    }

    const prompt = rest.join(" ").trim();
    if (!prompt) {
      setShowRemoteDashboard(true);
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
          {
            kind: "info",
            key: mkKey(),
            text: "Remote infrastructure not deployed yet. Setting up now (~2 min)...",
          },
        ]);

        try {
          for await (const step of deployForTui()) {
            setEvents((e) => [
              ...e,
              {
                kind: step.error ? "error" : "info",
                key: mkKey(),
                text: step.message,
              },
            ]);
            if (step.done) break;
          }
        } catch {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: "Deploy failed. Fix the issue above and try /remote again.",
            },
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
          {
            kind: "error",
            key: mkKey(),
            text: "Deploy seemed to succeed but config wasn't saved. Try again.",
          },
        ]);
        return;
      }

      if (!currentCfg.githubOAuthToken) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "GitHub not authenticated. Starting OAuth device flow...",
          },
        ]);

        try {
          for await (const step of authGitHubForTui()) {
            setEvents((e) => [
              ...e,
              {
                kind: step.error ? "error" : "info",
                key: mkKey(),
                text: step.message,
              },
            ]);
            if (step.done) break;
          }
        } catch {
          setEvents((e) => [
            ...e,
            {
              kind: "error",
              key: mkKey(),
              text: "GitHub auth failed. Try `kimiflare auth github` from shell.",
            },
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
        {
          kind: "info",
          key: mkKey(),
          text: `Starting remote session for ${repo.owner}/${repo.name}...`,
        },
        {
          kind: "info",
          key: mkKey(),
          text: `Budget: ${formatTokens(budget)} tokens. TTL: ${ttl} min.`,
        },
      ]);

      try {
        const data = await startRemoteSession({
          prompt,
          repo,
          cfg: finalCfg,
          ttlMinutes: finalCfg.remoteTtlMinutes,
          tokensBudget: finalCfg.remoteMaxInputTokens,
        });
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `Session started: ${data.sessionId}`,
          },
        ]);

        for await (const ev of streamRemoteProgress(
          finalCfg.remoteWorkerUrl!,
          data.sessionId,
          activeScopeRef.current?.signal,
        )) {
          const event = ev as Record<string, unknown>;
          if (event.type === "text_delta") {
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: String(event.text ?? ""),
              },
            ]);
          } else if (event.type === "tool_call") {
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: `→ ${String(event.name ?? "")}`,
              },
            ]);
          } else if (event.type === "done") {
            const prUrl = event.prUrl as string | undefined;
            const tokensUsed = event.tokensUsed as number | undefined;
            const tokensBudget = event.tokensBudget as number | undefined;
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: prUrl ? `Done — PR: ${prUrl}` : "Done",
              },
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
            const category = event.category as
              | RemoteSession["errorCategory"]
              | undefined;
            setEvents((e) => [
              ...e,
              {
                kind: "error",
                key: mkKey(),
                text: `Remote error: ${message}`,
              },
            ]);
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
          {
            kind: "error",
            key: mkKey(),
            text: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      }
    })();

    return true;
  }
  if (c === "/help") {
    const lines = [
      "commands:",
      "  /mode edit|plan|auto     switch agent mode",
      "  /skills list|add|edit|... manage skills",
      "  /memory on|off|clear      manage memory",
      "  /cost                     show cost report",
      "  /compact                  summarize old turns",
      "  /resume                   pick a past session",
      "  /checkpoint [label]       save current point in session",
      "  /checkpoints              list checkpoints in session",
      "  /clear                    clear conversation",
      "  /init                     scan repo and write KIMI.md",
      "  /update                   check for updates",
      "  /exit                     exit kimiflare",
    ];
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: lines.join("\n") },
    ]);
    return true;
  }
  return false;
}
