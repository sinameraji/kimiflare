import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";

import { runAgentTurn } from "./agent/loop.js";
import type { AiGatewayOptions, GatewayMeta } from "./agent/client.js";
import { buildSystemPrompt, buildSystemMessages, buildSessionPrefix } from "./agent/system-prompt.js";
import { compactMessages } from "./agent/compact.js";
import {
  compactMessages as compactCompiled,
  shouldCompact,
  recallArtifacts,
} from "./agent/compaction.js";
import {
  emptySessionState,
  ArtifactStore,
  formatRecalledArtifacts,
  type SessionState,
} from "./agent/session-state.js";
import { ToolExecutor, ALL_TOOLS, type PermissionDecision } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import { McpManager } from "./mcp/manager.js";
import { sanitizeString } from "./agent/messages.js";
import type { ChatMessage, ContentPart, Usage } from "./agent/messages.js";
import { KimiApiError } from "./util/errors.js";
import { ChatView, type ChatEvent } from "./ui/chat.js";
import { StatusBar } from "./ui/status.js";
import { PermissionModal } from "./ui/permission.js";
import { ResumePicker } from "./ui/resume-picker.js";
import { ThemePicker } from "./ui/theme-picker.js";
import { TaskList } from "./ui/task-list.js";
import type { Task } from "./tasks-state.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolRender } from "./tools/registry.js";
import { CustomTextInput } from "./ui/text-input.js";
import { checkForUpdate } from "./util/update-check.js";
import type { UpdateCheckResult } from "./util/update-check.js";
import { Onboarding } from "./ui/onboarding.js";
import { Welcome } from "./ui/welcome.js";
import {
  configPath,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  saveConfig,
  type ReasoningEffort,
} from "./config.js";
import { resolveTheme, themeNames, themeList, type Theme } from "./ui/theme.js";
import { nextMode, type Mode, isBlockedInPlanMode, isReadOnlyBash } from "./mode.js";
import {
  listSessions,
  loadSession,
  makeSessionId,
  saveSession,
  type SessionSummary,
} from "./sessions.js";
import { unlink } from "node:fs/promises";
import { encodeImageFile, isImagePath, type EncodedImage } from "./util/image.js";
import { recordUsage, getCostReport, formatCostReport } from "./usage-tracker.js";
import type { GatewayUsageLookup, DailyUsage } from "./usage-tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { RETENTION } from "./storage-limits.js";

interface Cfg {
  accountId: string;
  apiToken: string;
  model: string;
  aiGatewayId?: string;
  aiGatewayCacheTtl?: number;
  aiGatewaySkipCache?: boolean;
  aiGatewayCollectLogPayload?: boolean;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  theme?: string;
  reasoningEffort?: ReasoningEffort;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
  mcpServers?: Record<string, { type: "local" | "remote"; command?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string>; enabled?: boolean }>;
  cacheStablePrompts?: boolean;
  compiledContext?: boolean;
  imageHistoryTurns?: number;
  memoryEnabled?: boolean;
  memoryDbPath?: string;
  memoryMaxAgeDays?: number;
  memoryMaxEntries?: number;
  memoryEmbeddingModel?: string;
  codeMode?: boolean;
}

function gatewayFromConfig(cfg: Cfg): AiGatewayOptions | undefined {
  if (!cfg.aiGatewayId) return undefined;
  return {
    id: cfg.aiGatewayId,
    cacheTtl: cfg.aiGatewayCacheTtl,
    skipCache: cfg.aiGatewaySkipCache,
    collectLogPayload: cfg.aiGatewayCollectLogPayload,
    metadata: cfg.aiGatewayMetadata,
  };
}

function gatewayUsageLookupFromConfig(
  cfg: Cfg,
  meta: GatewayMeta | null,
): GatewayUsageLookup | undefined {
  if (!cfg.aiGatewayId || !meta) return undefined;
  return {
    accountId: cfg.accountId,
    apiToken: cfg.apiToken,
    gatewayId: cfg.aiGatewayId,
    meta,
  };
}

interface PendingPermission {
  tool: ToolSpec;
  args: Record<string, unknown>;
  resolve: (d: PermissionDecision) => void;
}

const CONTEXT_LIMIT = 262_000;
const AUTO_COMPACT_SUGGEST_PCT = 0.8;
const MAX_EVENTS = 500;

let nextAssistantId = 1;
let nextKey = 1;
const mkKey = () => `evt_${nextKey++}`;

function capEvents(prev: ChatEvent[]): ChatEvent[] {
  if (prev.length <= MAX_EVENTS) return prev;
  return prev.slice(prev.length - MAX_EVENTS);
}

/** Visually compact events by collapsing old turns into a placeholder.
 *  Keeps the last `keepLastTurns` user messages and everything after them. */
function compactEventsVisual(prev: ChatEvent[], keepLastTurns: number): ChatEvent[] {
  let seen = 0;
  let cutoff = -1;
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i]!.kind === "user") {
      seen++;
      if (seen === keepLastTurns + 1) {
        cutoff = i;
        break;
      }
    }
  }
  if (cutoff <= 0) return prev;
  const kept = prev.slice(cutoff);
  return [
    { kind: "info", key: mkKey(), text: `··· ${cutoff} earlier messages compacted ···` },
    ...kept,
  ];
}

const MAX_IMAGES_PER_MESSAGE = 10;

function makePrefixMessages(
  cacheStable: boolean,
  model: string,
  mode: Mode,
  tools: ToolSpec[],
): ChatMessage[] {
  if (cacheStable) {
    return buildSystemMessages({ cwd: process.cwd(), tools, model, mode });
  }
  return [
    {
      role: "system",
      content: buildSystemPrompt({ cwd: process.cwd(), tools, model, mode }),
    },
  ];
}

function findImagePaths(text: string): string[] {
  const paths: string[] = [];
  for (const token of text.split(/\s+/)) {
    const clean = token.replace(/^["']|["',;:!?]$/g, "").replace(/[.,;:!?]$/, "");
    if (isImagePath(clean) && existsSync(clean)) {
      paths.push(clean);
    }
  }
  return [...new Set(paths)];
}

const EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  low: "low — fastest; lightest reasoning. Best for simple Q&A, small edits, quick coordination.",
  medium: "medium — balanced (default). Solid quality on most edits, fast on trivial prompts.",
  high: "high — deepest reasoning; slowest. Best for complex debugging, architecture, multi-file refactors.",
};

function App({ initialCfg, initialUpdateResult }: { initialCfg: Cfg | null; initialUpdateResult?: UpdateCheckResult }) {
  const { exit } = useApp();
  const [cfg, setCfg] = useState<Cfg | null>(initialCfg);
  const [events, setRawEvents] = useState<ChatEvent[]>([]);
  const setEvents = useCallback(
    (updater: React.SetStateAction<ChatEvent[]>) => {
      setRawEvents((prev) => {
        const next = typeof updater === "function" ? (updater as (prev: ChatEvent[]) => ChatEvent[])(prev) : updater;
        return capEvents(next);
      });
    },
    [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessionUsage, setSessionUsage] = useState<DailyUsage | null>(null);
  const [gatewayMeta, setGatewayMeta] = useState<GatewayMeta | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [perm, setPerm] = useState<PendingPermission | null>(null);
  const [queue, setQueue] = useState<Array<{ full: string; display: string }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");

  const [mode, setMode] = useState<Mode>("edit");
  const [codeMode, setCodeMode] = useState<boolean>(initialCfg?.codeMode ?? false);
  const [effort, setEffort] = useState<ReasoningEffort>(
    initialCfg?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  const [theme, setTheme] = useState<Theme>(resolveTheme(initialCfg?.theme));
  const [resumeSessions, setResumeSessions] = useState<SessionSummary[] | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [originalTheme, setOriginalTheme] = useState<Theme | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStartedAt, setTasksStartedAt] = useState<number | null>(null);
  const [tasksStartTokens, setTasksStartTokens] = useState<number>(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(initialUpdateResult?.hasUpdate ?? false);
  const [latestVersion, setLatestVersion] = useState<string | null>(initialUpdateResult?.latestVersion ?? null);

  const cacheStableRef = useRef(initialCfg?.cacheStablePrompts !== false);
  const messagesRef = useRef<ChatMessage[]>(
    makePrefixMessages(cacheStableRef.current, cfg?.model ?? DEFAULT_MODEL, "edit", ALL_TOOLS),
  );
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const modeRef = useRef<Mode>(mode);
  const effortRef = useRef<ReasoningEffort>(effort);
  const tasksRef = useRef<Task[]>([]);
  const usageRef = useRef<Usage | null>(null);
  const gatewayMetaRef = useRef<GatewayMeta | null>(null);
  const updateCheckedRef = useRef(false);
  const sessionStateRef = useRef<SessionState>(emptySessionState());
  const artifactStoreRef = useRef<ArtifactStore>(new ArtifactStore());
  const compiledContextRef = useRef(initialCfg?.compiledContext === true);
  const updateNudgedRef = useRef(false);
  const compactSuggestedRef = useRef(false);
  const mcpManagerRef = useRef(new McpManager());
  const mcpToolsRef = useRef<ToolSpec[]>([]);
  const mcpInitRef = useRef(false);
  const memoryManagerRef = useRef<MemoryManager | null>(null);

  // Batched streaming delta refs to reduce React re-render frequency
  const pendingTextRef = useRef<Map<number, { text: string; reasoning: string }>>(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!cfg) return;
    // Prune old sessions on startup
    void import("./sessions.js").then(({ pruneSessions }) =>
      pruneSessions().then((removed) => {
        if (removed > 0) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `pruned ${removed} old session files` },
          ]);
        }
      }),
    );

    // Initialize memory manager if enabled
    if (cfg.memoryEnabled) {
      const dbPath = cfg.memoryDbPath ?? join(process.cwd(), ".kimiflare", "memory.db");
      const manager = new MemoryManager({
        dbPath,
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        embeddingModel: cfg.memoryEmbeddingModel,
        gateway: gatewayFromConfig(cfg),
        maxAgeDays: cfg.memoryMaxAgeDays ?? RETENTION.memoryMaxAgeDays,
        maxEntries: cfg.memoryMaxEntries ?? RETENTION.memoryMaxEntries,
      });
      manager.open();
      memoryManagerRef.current = manager;

      // Run cleanup and backfill on startup
      void manager.cleanup(process.cwd()).then((result) => {
        const total = result.oldDeleted + result.excessDeleted + result.duplicatesMerged;
        if (total > 0) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `memory cleanup: removed ${total} stale entries` },
          ]);
        }
      });
      void manager.backfill(process.cwd()).then((fixed) => {
        if (fixed > 0) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `memory backfill: embedded ${fixed} un-vectorized entries` },
          ]);
        }
      });
    } else {
      memoryManagerRef.current?.close();
      memoryManagerRef.current = null;
    }
  }, [cfg]);

  useEffect(() => {
    if (!cfg || updateCheckedRef.current) return;
    updateCheckedRef.current = true;

    if (initialUpdateResult) {
      if (initialUpdateResult.hasUpdate && !updateNudgedRef.current) {
        updateNudgedRef.current = true;
        setHasUpdate(true);
        setLatestVersion(initialUpdateResult.latestVersion);
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `update available: ${initialUpdateResult.localVersion} → ${initialUpdateResult.latestVersion}`,
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
      }
      return;
    }

    void checkForUpdate().then((result) => {
      if (result.hasUpdate && !updateNudgedRef.current) {
        updateNudgedRef.current = true;
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
      }
    });
  }, [cfg, initialUpdateResult]);

  useEffect(() => {
    modeRef.current = mode;
    if (cacheStableRef.current) {
      messagesRef.current[1] = {
        role: "system",
        content: buildSessionPrefix({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current],
          model: cfg?.model ?? DEFAULT_MODEL,
          mode,
        }),
      };
    } else {
      messagesRef.current[0] = {
        role: "system",
        content: buildSystemPrompt({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current],
          model: cfg?.model ?? DEFAULT_MODEL,
          mode,
        }),
      };
    }
    if (mode === "plan") {
      executorRef.current.clearSessionPermissions();
    }
  }, [mode, cfg?.model]);

  useEffect(() => {
    effortRef.current = effort;
  }, [effort]);

  useEffect(() => {
    if (!cfg) return;
    const id = setInterval(() => {
      void checkForUpdate().then((result) => {
        if (result.hasUpdate) {
          setHasUpdate(true);
          setLatestVersion(result.latestVersion);
          if (!updateNudgedRef.current) {
            updateNudgedRef.current = true;
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
          }
        }
      });
    }, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(id);
  }, [cfg]);

  const initMcp = useCallback(async () => {
    if (!cfg?.mcpServers || mcpInitRef.current) return;
    mcpInitRef.current = true;
    const manager = mcpManagerRef.current;
    let totalTools = 0;
    for (const [name, server] of Object.entries(cfg.mcpServers)) {
      if (server.enabled === false) continue;
      try {
        if (server.type === "local" && server.command && server.command.length > 0) {
          await manager.addLocalServer(name, server.command, server.env);
        } else if (server.type === "remote" && server.url) {
          await manager.addRemoteServer(name, server.url, server.headers);
        } else {
          setEvents((e) => [
            ...e,
            { kind: "error", key: mkKey(), text: `MCP server "${name}" has invalid config` },
          ]);
          continue;
        }
        const tools = manager.getAllTools();
        const newTools = tools.filter((t) => !mcpToolsRef.current.some((mt) => mt.name === t.name));
        for (const tool of newTools) {
          executorRef.current.register(tool);
        }
        mcpToolsRef.current = tools;
        totalTools = tools.length;
      } catch (e) {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `MCP server "${name}" failed: ${(e as Error).message}` },
        ]);
      }
    }
    if (totalTools > 0) {
      if (cacheStableRef.current) {
        messagesRef.current[1] = {
          role: "system",
          content: buildSessionPrefix({
            cwd: process.cwd(),
            tools: [...ALL_TOOLS, ...mcpToolsRef.current],
            model: cfg.model ?? DEFAULT_MODEL,
            mode: modeRef.current,
          }),
        };
      } else {
        messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd: process.cwd(),
            tools: [...ALL_TOOLS, ...mcpToolsRef.current],
            model: cfg.model ?? DEFAULT_MODEL,
            mode: modeRef.current,
          }),
        };
      }
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `MCP connected — ${totalTools} external tool${totalTools === 1 ? "" : "s"} available` },
      ]);
    }
  }, [cfg]);

  useEffect(() => {
    if (cfg && !mcpInitRef.current) {
      void initMcp();
    }
  }, [cfg, initMcp]);

  const ensureSessionId = useCallback(() => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const firstUser = messagesRef.current.find((m) => m.role === "user");
    let firstText = "session";
    if (typeof firstUser?.content === "string") {
      firstText = firstUser.content;
    } else if (Array.isArray(firstUser?.content)) {
      const textPart = firstUser.content.find((p) => p.type === "text");
      if (textPart?.text) firstText = textPart.text;
    }
    sessionIdRef.current = makeSessionId(firstText);
    return sessionIdRef.current;
  }, []);

  const saveSessionSafe = useCallback(async () => {
    if (!cfg) return;
    ensureSessionId();
    try {
      await saveSession({
        id: sessionIdRef.current!,
        cwd: process.cwd(),
        model: cfg.model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: messagesRef.current,
        sessionState: compiledContextRef.current ? sessionStateRef.current : undefined,
      });
    } catch {
      /* non-fatal */
    }
  }, [cfg, ensureSessionId]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      if (busy && activeControllerRef.current) {
        activeControllerRef.current.abort();
        setQueue([]);
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
      } else {
        exit();
      }
      return;
    }
    if (key.ctrl && inputChar === "r") {
      setShowReasoning((s) => !s);
      return;
    }
    if (key.shift && key.tab) {
      setMode((m) => nextMode(m));
      return;
    }
    if (key.ctrl && inputChar === "o") {
      setVerbose((v) => !v);
      return;
    }
    if (key.ctrl && inputChar === "t") {
      setOriginalTheme(theme);
      setShowThemePicker(true);
      return;
    }
    if (key.ctrl && inputChar === "m") {
      setCodeMode((c) => !c);
      return;
    }
  });

  const flushAssistantUpdates = useCallback(() => {
    flushTimeoutRef.current = null;
    const pending = pendingTextRef.current;
    if (pending.size === 0) return;
    pendingTextRef.current = new Map();
    setEvents((evts) =>
      evts.map((e) => {
        if (e.kind !== "assistant") return e;
        const delta = pending.get(e.id);
        if (!delta) return e;
        return {
          ...e,
          text: e.text + delta.text,
          reasoning: e.reasoning + delta.reasoning,
        } as ChatEvent;
      }),
    );
  }, []);

  const updateAssistant = useCallback(
    (id: number, patch: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>) => {
      const result = patch({ text: "", reasoning: "" } as Extract<ChatEvent, { kind: "assistant" }>);
      const assistantResult = result as Partial<Extract<ChatEvent, { kind: "assistant" }>>;
      const hasTextDelta = assistantResult.text !== undefined && assistantResult.text.length > 0;
      const hasReasoningDelta = assistantResult.reasoning !== undefined && assistantResult.reasoning.length > 0;

      if (hasTextDelta || hasReasoningDelta) {
        const existing = pendingTextRef.current.get(id) ?? { text: "", reasoning: "" };
        pendingTextRef.current.set(id, {
          text: existing.text + (assistantResult.text ?? ""),
          reasoning: existing.reasoning + (assistantResult.reasoning ?? ""),
        });
        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(flushAssistantUpdates, 16); // ~60fps
        }
        return;
      }

      // Non-text patches (streaming flag, etc.) apply immediately after flushing
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushAssistantUpdates();
      }
      setEvents((evts) =>
        evts.map((e) =>
          e.kind === "assistant" && e.id === id ? ({ ...e, ...result } as ChatEvent) : e,
        ),
      );
    },
    [flushAssistantUpdates],
  );

  const updateTool = useCallback(
    (id: string, patch: Partial<Extract<ChatEvent, { kind: "tool" }>>) => {
      setEvents((evts) =>
        evts.map((e) =>
          e.kind === "tool" && e.id === id ? ({ ...e, ...patch } as ChatEvent) : e,
        ),
      );
    },
    [],
  );

  const updateGatewayMeta = useCallback((meta: GatewayMeta) => {
    gatewayMetaRef.current = meta;
    setGatewayMeta(meta);
  }, []);

  const runCompact = useCallback(async () => {
    if (!cfg) return;
    if (busy) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't compact while model is running" }]);
      return;
    }
    setBusy(true);
    setTurnStartedAt(Date.now());
    const controller = new AbortController();
    activeControllerRef.current = controller;
    try {
      if (compiledContextRef.current) {
        const result = compactCompiled({
          messages: messagesRef.current,
          state: sessionStateRef.current,
          store: artifactStoreRef.current,
        });
        if (result.metrics.rawTurnsRemoved === 0) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "nothing to compact yet" },
          ]);
        } else {
          messagesRef.current = result.newMessages;
          sessionStateRef.current = result.newState;
          setEvents((e) =>
            compactEventsVisual(
              [
                ...e,
                {
                  kind: "info",
                  key: mkKey(),
                  text: `compacted ${result.metrics.rawTurnsRemoved} turns → ${result.metrics.estimatedTokensBefore} → ${result.metrics.estimatedTokensAfter} tokens, ${result.metrics.archivedArtifacts} artifacts`,
                },
              ],
              4,
            ),
          );
          await saveSessionSafe();
        }
      } else {
        const result = await compactMessages({
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: cfg.model,
          messages: messagesRef.current,
          signal: controller.signal,
          gateway: gatewayFromConfig(cfg),
        });
        if (result.replacedCount === 0) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "nothing to compact yet" },
          ]);
        } else {
          messagesRef.current = result.newMessages;
          setEvents((e) =>
            compactEventsVisual(
              [
                ...e,
                {
                  kind: "info",
                  key: mkKey(),
                  text: `compacted ${result.replacedCount} messages into a summary`,
                },
              ],
              4,
            ),
          );
          await saveSessionSafe();
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `compact failed: ${(e as Error).message}` },
        ]);
      }
    } finally {
      setBusy(false);
      setTurnStartedAt(null);
      activeControllerRef.current = null;
    }
  }, [cfg, busy, saveSessionSafe]);

  const openResumePicker = useCallback(async () => {
    const sessions = await listSessions(200);
    setResumeSessions(sessions);
  }, []);

  const runInit = useCallback(async () => {
    if (!cfg) return;
    if (busy) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /init while model is running" }]);
      return;
    }
    const cwd = process.cwd();
    for (const name of ["KIMI.md", "KIMIFLARE.md", "AGENT.md"]) {
      if (existsSync(join(cwd, name))) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `${name} already exists at ${join(cwd, name)} — delete it first if you want to regenerate`,
          },
        ]);
        return;
      }
    }
    const prompt = [
      "Generate a KIMI.md at the repository root so future agents have project context.",
      "",
      "First, use the `glob`, `read`, and `grep` tools to understand the project: read `package.json`, the top-level `README.md` if present, the tsconfig / build config, and skim the top-level source directory structure.",
      "",
      "Then call the `write` tool to create `KIMI.md` at the repo root with these sections, terse (aim ≤ 100 lines total):",
      "",
      "- **Project** — one-line description + primary language/runtime.",
      "- **Build / test / run** — exact shell commands an agent should use.",
      "- **Layout** — key directories and what lives in each.",
      "- **Conventions** — naming, import style, file structure, commit style, anything surprising.",
      "- **Do / Don't** — quirks or rules future agents should know.",
      "",
      "Do not call `tasks_set` for this. Just read what you need, then write the file.",
    ].join("\n");

    setEvents((e) => [...e, { kind: "user", key: mkKey(), text: "/init" }]);
    messagesRef.current.push({ role: "user", content: sanitizeString(prompt) });
    setBusy(true);
    setTurnStartedAt(Date.now());
    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      await runAgentTurn({
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        gateway: gatewayFromConfig(cfg),
        messages: messagesRef.current,
        tools: [...ALL_TOOLS, ...mcpToolsRef.current],
        executor: executorRef.current,
        cwd,
        signal: controller.signal,
        reasoningEffort: effortRef.current,
        coauthor:
          cfg.coauthor !== false
            ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
            : undefined,
        sessionId: ensureSessionId(),
        memoryManager: memoryManagerRef.current,
        codeMode,
        callbacks: {
          onAssistantStart: () => {
            const id = nextAssistantId++;
            activeAsstIdRef.current = id;
            setEvents((e) => [
              ...e,
              { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true },
            ]);
          },
          onReasoningDelta: (d) => {
            const id = activeAsstIdRef.current;
            if (id !== null) updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
          },
          onTextDelta: (d) => {
            const id = activeAsstIdRef.current;
            if (id !== null) updateAssistant(id, (e) => ({ text: e.text + d }));
          },
          onAssistantFinal: () => {
            const id = activeAsstIdRef.current;
            if (id !== null) updateAssistant(id, () => ({ streaming: false }));
          },
          onToolCallFinalized: (call) => {
            const spec = executorRef.current.list().find((t) => t.name === call.function.name);
            let renderMeta: ToolRender | undefined;
            try {
              const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              renderMeta = spec?.render?.(args);
            } catch {
              /* ignore */
            }
            setEvents((e) => [
              ...e,
              {
                kind: "tool",
                key: `tool_${call.id}`,
                id: call.id,
                name: call.function.name,
                args: call.function.arguments,
                status: "running",
                render: renderMeta,
                expanded: false,
              },
            ]);
          },
          onToolResult: (r) => {
            updateTool(r.tool_call_id, { status: r.ok ? "done" : "error", result: r.content });
          },
          onUsage: (u) => {
            usageRef.current = u;
            setUsage(u);
          },
          onUsageFinal: (u, meta) => {
            const sid = ensureSessionId();
            void recordUsage(sid, u, gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current));
            void getCostReport(sid).then((report) => setSessionUsage(report.session));
          },
          onGatewayMeta: updateGatewayMeta,
          askPermission: (req) =>
            new Promise<PermissionDecision>((resolve) => {
              if (modeRef.current === "auto") {
                resolve("allow");
                return;
              }
              if (modeRef.current === "plan" && isBlockedInPlanMode(req.tool.name)) {
                if (req.tool.name === "bash" && typeof req.args.command === "string" && isReadOnlyBash(req.args.command)) {
                  resolve("allow");
                  return;
                }
                setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: mkKey(),
                    text: `plan mode blocked ${req.tool.name}; exit plan mode to execute`,
                  },
                ]);
                resolve("deny");
                return;
              }
              setPerm({ tool: req.tool, args: req.args, resolve });
            }),
        },
      });

      if (existsSync(join(cwd, "KIMI.md"))) {
        if (cacheStableRef.current) {
          messagesRef.current[1] = {
            role: "system",
            content: buildSessionPrefix({
              cwd,
              tools: [...ALL_TOOLS, ...mcpToolsRef.current],
              model: cfg.model,
              mode: modeRef.current,
            }),
          };
        } else {
          messagesRef.current[0] = {
            role: "system",
            content: buildSystemPrompt({
              cwd,
              tools: [...ALL_TOOLS, ...mcpToolsRef.current],
              model: cfg.model,
              mode: modeRef.current,
            }),
          };
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "KIMI.md generated; context loaded for future turns" },
        ]);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `init failed: ${(e as Error).message}` },
        ]);
      }
    } finally {
      setBusy(false);
      setTurnStartedAt(null);
      activeAsstIdRef.current = null;
      activeControllerRef.current = null;
    }
  }, [cfg, busy, updateAssistant, updateTool, updateGatewayMeta]);

  const handleResumePick = useCallback(
    async (picked: SessionSummary | null) => {
      setResumeSessions(null);
      if (!picked) return;
      try {
        const file = await loadSession(picked.filePath);
        messagesRef.current = file.messages;
        sessionIdRef.current = file.id;
        if (file.sessionState && compiledContextRef.current) {
          sessionStateRef.current = file.sessionState;
          artifactStoreRef.current = new ArtifactStore();
        }
        setEvents([
          {
            kind: "info",
            key: mkKey(),
            text: `resumed session ${picked.id} (${picked.messageCount} msgs)`,
          },
        ]);
        const userMsgs = file.messages
          .filter((m) => m.role === "user" && m.content)
          .map((m) => {
            if (!m.content) return "";
            if (typeof m.content === "string") return m.content;
            const textPart = m.content.find((p) => p.type === "text");
            return textPart?.text ?? "";
          })
          .filter((text) => text.length > 0);
        if (userMsgs.length > 0) setHistory(userMsgs);
        setUsage(null);
        setSessionUsage(null);
        gatewayMetaRef.current = null;
        setGatewayMeta(null);
        void getCostReport(file.id).then((report) => setSessionUsage(report.session));
      } catch (e) {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `failed to load session: ${(e as Error).message}` },
        ]);
      }
    },
    [],
  );

  const handleThemePick = useCallback(
    (picked: Theme | null) => {
      if (!picked) {
        // cancel — revert to original
        if (originalTheme) setTheme(originalTheme);
        setShowThemePicker(false);
        setOriginalTheme(null);
        return;
      }
      setTheme(picked);
      setCfg((c) => (c ? { ...c, theme: picked.name } : c));
      if (cfg) void saveConfig({ ...cfg, theme: picked.name }).catch(() => {});
      setShowThemePicker(false);
      setOriginalTheme(null);
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `theme: ${picked.label}` },
      ]);
    },
    [cfg, originalTheme],
  );

  const handleSlash = useCallback(
    (cmd: string): boolean => {
      const raw = cmd.trim();
      const [head, ...rest] = raw.split(/\s+/);
      const c = (head ?? "").toLowerCase();
      const arg = rest.join(" ").trim().toLowerCase();

      if (c === "/exit" || c === "/quit") {
        exit();
        return true;
      }
      if (c === "/clear") {
        if (cacheStableRef.current && messagesRef.current.length >= 2) {
          messagesRef.current = [messagesRef.current[0]!, messagesRef.current[1]!];
        } else {
          messagesRef.current = [messagesRef.current[0]!];
        }
        sessionIdRef.current = null;
        sessionStateRef.current = emptySessionState();
        artifactStoreRef.current = new ArtifactStore();
        executorRef.current.clearArtifacts();
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
            { kind: "info", key: mkKey(), text: `reasoning: ${next ? "shown" : "hidden"}` },
          ]);
          return next;
        });
        return true;
      }
      if (c === "/cost") {
        void getCostReport(sessionIdRef.current ?? undefined)
          .then((report) => {
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: formatCostReport(report) },
            ]);
          })
          .catch((err) => {
            setEvents((e) => [
              ...e,
              { kind: "error", key: mkKey(), text: `cost report failed: ${(err as Error).message}` },
            ]);
          });
        return true;
      }
      if (c === "/model") {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `current model: ${cfg?.model ?? "unknown"}` },
        ]);
        return true;
      }
      if (c === "/gateway") {
        if (!cfg) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no config loaded" }]);
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
            lines.push(`metadata: ${meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : "none"}`);
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
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "usage: /gateway metadata KEY=VALUE  or  /gateway metadata clear" }]);
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
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway metadata: ${key}=${JSON.stringify(value)}` }]);
          return true;
        }

        // Default: treat sub as a gateway ID to enable
        const next = { ...cfg, aiGatewayId: rest[0] };
        setCfg(next);
        void saveConfig(next).catch(() => {});
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `gateway enabled: ${rest[0]}` }]);
        return true;
      }
      if (c === "/thinking" || c === "/effort") {
        if (!arg) {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `current: ${effort}  ·  ${EFFORT_DESCRIPTIONS[effort]}\nuse: /thinking low | medium | high`,
            },
          ]);
          return true;
        }
        if (arg === "low" || arg === "medium" || arg === "high") {
          setEffort(arg);
          if (cfg) void saveConfig({ ...cfg, reasoningEffort: arg }).catch(() => {});
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `thinking: ${arg}  ·  ${EFFORT_DESCRIPTIONS[arg]}`,
            },
          ]);
          return true;
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "usage: /thinking low | medium | high" },
        ]);
        return true;
      }
      if (c === "/theme") {
        if (!arg) {
          setOriginalTheme(theme);
          setShowThemePicker(true);
          return true;
        }
        const next = resolveTheme(arg);
        if (next.name !== arg) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `unknown theme "${arg}" — available: ${themeNames().join(", ")}` },
          ]);
          return true;
        }
        setTheme(next);
        setCfg((c) => (c ? { ...c, theme: next.name } : c));
        if (cfg) void saveConfig({ ...cfg, theme: next.name }).catch(() => {});
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `theme: ${next.label}` },
        ]);
        return true;
      }
      if (c === "/mode") {
        if (!arg) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `current mode: ${mode}  ·  use /mode edit|plan|auto or shift+tab` },
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
      if (c === "/plan") {
        setMode("plan");
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "mode: plan" }]);
        return true;
      }
      if (c === "/auto") {
        setMode("auto");
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "mode: auto" }]);
        return true;
      }
      if (c === "/edit") {
        setMode("edit");
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "mode: edit" }]);
        return true;
      }
      if (c === "/memory") {
        if (!cfg?.memoryEnabled) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "memory is disabled. Enable with KIMIFLARE_MEMORY_ENABLED=1" }]);
          return true;
        }
        if (arg === "clear") {
          const cleared = memoryManagerRef.current?.clearRepo(process.cwd()) ?? 0;
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `cleared ${cleared} memories for this repo` }]);
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
      }
      if (c === "/resume") {
        void openResumePicker();
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
              { kind: "info", key: mkKey(), text: "no MCP servers connected — add them to ~/.config/kimiflare/config.json" },
            ]);
          } else {
            const lines = servers.map((s) => `  ${s.name} (${s.type}) — ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`);
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: "MCP servers:\n" + lines.join("\n") },
            ]);
          }
          return true;
        }
        if (arg === "reload") {
          if (busy) {
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /mcp reload while model is running" }]);
            return true;
          }
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "reloading MCP servers..." }]);
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
      if (c === "/logout") {
        unlink(configPath()).catch(() => {});
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `credentials cleared from ${configPath()}` },
        ]);
        setCfg(null);
        return true;
      }
      if (c === "/help") {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text:
              "commands:\n" +
              "  /mode edit|plan|auto    switch mode (or shift+tab to cycle)\n" +
              "  /plan /auto /edit       shortcuts for /mode\n" +
              "  /thinking low|med|high  set reasoning effort (quality vs speed)\n" +
              "  /theme                  interactive theme picker (or ctrl+t)\n" +
              "  /theme NAME             set theme by name\n" +
              "  /resume                 pick a past conversation\n" +
              "  /compact                summarize old turns to free context\n" +
              "  /init                   scan this repo and write a KIMI.md for future agents\n" +
              "  /memory                 show memory stats\n" +
              "  /memory search <query>  search stored memories\n" +
              "  /memory clear           wipe memories for this repo\n" +
              "  /mcp list               list connected MCP servers and tools\n" +
              "  /mcp reload             reconnect all configured MCP servers\n" +
              "  /reasoning              toggle show/hide model reasoning\n" +
              "  /clear                  clear current conversation\n" +
              "  /gateway                show gateway status\n" +
              "  /gateway ID             enable AI Gateway\n" +
              "  /gateway off            disable AI Gateway (direct Workers AI)\n" +
              "  /gateway cache-ttl N    set gateway cache TTL in seconds\n" +
              "  /gateway skip-cache T|F set gateway skip-cache flag\n" +
              "  /gateway collect-logs T|F  include payload in gateway logs\n" +
              "  /gateway metadata K=V   add metadata key-value pair\n" +
              "  /gateway metadata clear remove all metadata\n" +
              "  /cost /model /update /logout /help /exit\n" +
              "keys: ctrl-c interrupt/exit · ctrl-r toggle reasoning · ctrl-o verbose · ctrl+t theme · shift+tab cycle mode · ↑/↓ history",
          },
        ]);
        return true;
      }
      return false;
    },
    [cfg, exit, usage, effort, theme, mode, openResumePicker, runCompact, runInit, initMcp, setCfg],
  );

  const processMessage = useCallback(
    async (text: string, displayText?: string) => {
      if (!cfg) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("/") && handleSlash(trimmed)) return;

      const display = displayText?.trim() || trimmed;
      const imagePaths = findImagePaths(trimmed).slice(0, MAX_IMAGES_PER_MESSAGE);
      let images: string[] = [];
      let content: string | ContentPart[] = sanitizeString(trimmed);

      if (imagePaths.length > 0) {
        const encoded = await Promise.all(
          imagePaths.map(async (path) => {
            try {
              const img = await encodeImageFile(path);
              return { path, img };
            } catch (e) {
              setEvents((es) => [
                ...es,
                { kind: "error", key: mkKey(), text: `failed to encode image ${path}: ${(e as Error).message}` },
              ]);
              return null;
            }
          }),
        );
        const valid = encoded.filter((x): x is { path: string; img: EncodedImage } => x !== null);
        if (valid.length > 0) {
          images = valid.map((v) => v.img.filename);
          const parts: ContentPart[] = [
            { type: "text", text: sanitizeString(trimmed) },
            ...valid.map((v) => ({ type: "image_url" as const, image_url: { url: v.img.dataUrl } })),
          ];
          content = parts;
        }
      }

      setEvents((e) => [...e, { kind: "user", key: mkKey(), text: display, images: images.length > 0 ? images : undefined }]);
      messagesRef.current.push({ role: "user", content });

      // Recall artifacts before sending if compiled context is enabled
      if (compiledContextRef.current) {
        const { ids, recalled } = recallArtifacts(messagesRef.current, artifactStoreRef.current, sessionStateRef.current);
        if (recalled.length > 0) {
          const recalledText = formatRecalledArtifacts(recalled);
          messagesRef.current.push({ role: "system", content: recalledText });
          sessionStateRef.current = {
            ...sessionStateRef.current,
            artifact_index: { ...sessionStateRef.current.artifact_index },
          };
        }
      }

      setBusy(true);
      gatewayMetaRef.current = null;
      setGatewayMeta(null);
      setTurnStartedAt(Date.now());

      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        await runAgentTurn({
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: cfg.model,
          gateway: gatewayFromConfig(cfg),
          messages: messagesRef.current,
          tools: [...ALL_TOOLS, ...mcpToolsRef.current],
          executor: executorRef.current,
          cwd: process.cwd(),
          signal: controller.signal,
          reasoningEffort: effortRef.current,
          coauthor:
            cfg.coauthor !== false
              ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
              : undefined,
          sessionId: ensureSessionId(),
          memoryManager: memoryManagerRef.current,
          keepLastImageTurns: cfg.imageHistoryTurns ?? 2,
          codeMode,
          callbacks: {
            onAssistantStart: () => {
              const id = nextAssistantId++;
              activeAsstIdRef.current = id;
              setEvents((e) => [
                ...e,
                { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true },
              ]);
            },
            onReasoningDelta: (d) => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
            },
            onTextDelta: (d) => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, (e) => ({ text: e.text + d }));
            },
            onAssistantFinal: () => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, () => ({ streaming: false }));
            },
            onToolCallFinalized: (call) => {
              const spec = executorRef.current.list().find((t) => t.name === call.function.name);
              let renderMeta: ToolRender | undefined;
              try {
                const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                renderMeta = spec?.render?.(args);
              } catch {
                /* ignore render failure */
              }
              setEvents((e) => [
                ...e,
                {
                  kind: "tool",
                  key: `tool_${call.id}`,
                  id: call.id,
                  name: call.function.name,
                  args: call.function.arguments,
                  status: "running",
                  render: renderMeta,
                  expanded: false,
                },
              ]);
            },
            onToolResult: (r) => {
              updateTool(r.tool_call_id, {
                status: r.ok ? "done" : "error",
                result: r.content,
              });
            },
            onUsage: (u) => {
              usageRef.current = u;
              setUsage(u);
            },
            onUsageFinal: (u, meta) => {
              const sid = ensureSessionId();
              void recordUsage(sid, u, gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current));
              void getCostReport(sid).then((report) => setSessionUsage(report.session));
            },
            onGatewayMeta: updateGatewayMeta,
            onTasks: (nextTasks) => {
              const prevEmpty = tasksRef.current.length === 0;
              const prevAllDone =
                tasksRef.current.length > 0 &&
                tasksRef.current.every((t) => t.status === "completed");
              tasksRef.current = nextTasks;
              setTasks(nextTasks);
              if ((prevEmpty || prevAllDone) && nextTasks.length > 0) {
                setTasksStartedAt(Date.now());
                setTasksStartTokens(usageRef.current?.prompt_tokens ?? 0);
              }
              if (nextTasks.length === 0) {
                setTasksStartedAt(null);
                setTasksStartTokens(0);
              }
            },
            askPermission: (req) =>
              new Promise<PermissionDecision>((resolve) => {
                if (modeRef.current === "auto") {
                  resolve("allow");
                  return;
                }
                if (modeRef.current === "plan" && isBlockedInPlanMode(req.tool.name)) {
                  if (req.tool.name === "bash" && typeof req.args.command === "string" && isReadOnlyBash(req.args.command)) {
                    resolve("allow");
                    return;
                  }
                  setEvents((e) => [
                    ...e,
                    {
                      kind: "info",
                      key: mkKey(),
                      text: `plan mode blocked ${req.tool.name}; exit plan mode to execute`,
                    },
                  ]);
                  resolve("deny");
                  return;
                }
                setPerm({ tool: req.tool, args: req.args, resolve });
              }),
          },
        });
        await saveSessionSafe();

        // Auto-compact after turn if compiled context is enabled and thresholds are met
        if (compiledContextRef.current && shouldCompact({ messages: messagesRef.current })) {
          const result = compactCompiled({
            messages: messagesRef.current,
            state: sessionStateRef.current,
            store: artifactStoreRef.current,
          });
          if (result.metrics.rawTurnsRemoved > 0) {
            messagesRef.current = result.newMessages;
            sessionStateRef.current = result.newState;
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: `auto-compacted: ${result.metrics.estimatedTokensBefore} → ${result.metrics.estimatedTokensAfter} tokens (${result.metrics.archivedArtifacts} artifacts)`,
              },
            ]);
            await saveSessionSafe();
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setEvents((es) => [...es, { kind: "info", key: mkKey(), text: "(aborted)" }]);
        } else {
          const isInvalidJson400 =
            e instanceof KimiApiError &&
            e.httpStatus === 400 &&
            e.message.includes("invalid escaped character");
          if (isInvalidJson400) {
            messagesRef.current.pop();
            setEvents((es) => [
              ...es,
              {
                kind: "error",
                key: mkKey(),
                text: "API rejected request (invalid JSON in conversation history). Retrying may work; run /clear to reset if it persists.",
              },
            ]);
          } else {
            setEvents((es) => [
              ...es,
              { kind: "error", key: mkKey(), text: (e as Error).message ?? String(e) },
            ]);
          }
        }
      } finally {
        setBusy(false);
        setTurnStartedAt(null);
        activeAsstIdRef.current = null;
        activeControllerRef.current = null;
      }
    },
    [cfg, handleSlash, updateAssistant, updateTool, saveSessionSafe, updateGatewayMeta],
  );

  useEffect(() => {
    if (!busy && queue.length > 0) {
      const next = queue[0]!;
      setQueue((q) => q.slice(1));
      processMessage(next.full, next.display);
    }
  }, [busy, queue, processMessage]);

  const submit = useCallback(
    (full: string, display?: string) => {
      const trimmedFull = full.trim();
      if (!trimmedFull) return;
      const trimmedDisplay = (display ?? full).trim() || trimmedFull;

      const historyEntry = trimmedDisplay;

      if (busy) {
        setQueue((q) => [...q, { full: trimmedFull, display: trimmedDisplay }]);
        setHistory((h) => (h.length > 0 && h[h.length - 1] === historyEntry ? h : [...h, historyEntry]));
        setInput("");
        setHistoryIndex(-1);
        return;
      }

      setHistory((h) => (h.length > 0 && h[h.length - 1] === historyEntry ? h : [...h, historyEntry]));
      setInput("");
      setHistoryIndex(-1);
      processMessage(trimmedFull, trimmedDisplay !== trimmedFull ? trimmedDisplay : undefined);
    },
    [busy, processMessage],
  );

  useEffect(() => {
    if (compactSuggestedRef.current) return;
    if (usage && usage.prompt_tokens / CONTEXT_LIMIT >= AUTO_COMPACT_SUGGEST_PCT) {
      compactSuggestedRef.current = true;
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `context ${Math.round((usage.prompt_tokens / CONTEXT_LIMIT) * 100)}% full — run /compact to summarize older turns`,
        },
      ]);
    }
  }, [usage]);

  if (!cfg) {
    return (
      <Onboarding
        onDone={(newCfg) => {
          setCfg(newCfg);
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "configuration saved — welcome to kimiflare!" },
          ]);
        }}
      />
    );
  }

  if (resumeSessions !== null) {
    return (
      <Box flexDirection="column">
        <ResumePicker sessions={resumeSessions} onPick={handleResumePick} theme={theme} />
      </Box>
    );
  }

  if (showThemePicker) {
    return (
      <Box flexDirection="column">
        <ThemePicker themes={themeList()} current={theme} onPick={handleThemePick} onPreview={(t) => setTheme(t)} />
      </Box>
    );
  }

  const hasConversation = events.some((e) => e.kind === "user" || e.kind === "assistant");

  return (
    <Box flexDirection="column">
      {!hasConversation && events.length === 0 ? (
        <Welcome theme={theme} accountId={cfg.accountId} />
      ) : (
        <ChatView events={events} showReasoning={showReasoning} theme={theme} verbose={verbose} />
      )}
      {perm ? (
        <PermissionModal
          tool={perm.tool}
          args={perm.args}
          theme={theme}
          onDecide={(d) => {
            perm.resolve(d);
            setPerm(null);
          }}
        />
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {tasks.length > 0 && (
            <TaskList
              tasks={tasks}
              theme={theme}
              startedAt={tasksStartedAt}
              tokensDelta={Math.max(0, (usage?.prompt_tokens ?? 0) - tasksStartTokens)}
            />
          )}
          {queue.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {queue.map((q, i) => (
                <Text key={`queue_${i}`} color={theme.queue.color} dimColor={theme.queue.dim}>
                  ⏳ {q.display}
                </Text>
              ))}
            </Box>
          )}
          <StatusBar
            model={cfg.model}
            usage={usage}
            sessionUsage={sessionUsage}
            thinking={busy}
            turnStartedAt={turnStartedAt}
            theme={theme}
            mode={mode}
            effort={effort}
            contextLimit={CONTEXT_LIMIT}
            hasUpdate={hasUpdate}
            latestVersion={latestVersion}
            gatewayMeta={gatewayMeta}
            codeMode={codeMode}
          />
          <Box marginTop={1}>
            <Text color={theme.accent}>› </Text>
            <CustomTextInput
              value={input}
              onChange={setInput}
              onSubmit={submit}
              enablePaste
              onHistoryUp={() => {
                if (history.length === 0) return;
                if (historyIndex === -1) {
                  setDraftInput(input);
                  const nextIndex = history.length - 1;
                  setHistoryIndex(nextIndex);
                  setInput(history[nextIndex]!);
                } else {
                  const nextIndex = Math.max(0, historyIndex - 1);
                  setHistoryIndex(nextIndex);
                  setInput(history[nextIndex]!);
                }
              }}
              onHistoryDown={() => {
                if (historyIndex === -1) return;
                const nextIndex = historyIndex + 1;
                if (nextIndex >= history.length) {
                  setHistoryIndex(-1);
                  setInput(draftInput);
                } else {
                  setHistoryIndex(nextIndex);
                  setInput(history[nextIndex]!);
                }
              }}
              onClearQueueItem={(text) => {
                setQueue((q) => {
                  const idx = q.findIndex((item) => item.display === text);
                  if (idx >= 0) {
                    const next = [...q];
                    next.splice(idx, 1);
                    return next;
                  }
                  return q;
                });
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

export async function renderApp(cfg: Cfg | null, updateResult?: UpdateCheckResult) {
  const instance = render(<App initialCfg={cfg} initialUpdateResult={updateResult} />, {
    incrementalRendering: true,
  });
  await instance.waitUntilExit();
}
