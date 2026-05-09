import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import SelectInput from "ink-select-input";

import { runAgentTurn } from "./agent/loop.js";
import { TurnSupervisor } from "./agent/supervisor.js";
import type { AiGatewayOptions, GatewayMeta } from "./agent/client.js";
import {
  buildSystemPrompt,
  buildSessionPrefix,
} from "./agent/system-prompt.js";
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
  serializeArtifactStore,
  deserializeArtifactStore,
  type SessionState,
} from "./agent/session-state.js";
import {
  ToolExecutor,
  ALL_TOOLS,
  type PermissionDecision,
} from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import { McpManager } from "./mcp/manager.js";
import { LspManager } from "./lsp/manager.js";
import { sanitizeString } from "./agent/messages.js";
import type { ChatMessage, ContentPart, Usage } from "./agent/messages.js";
import { KimiApiError, isCloudQuotaExhaustedError } from "./util/errors.js";
import { safeSave as safeSaveRaw } from "./config-utils.js";
import { AbortScope } from "./util/abort-scope.js";
import { logger } from "./util/logger.js";
import { ChatView, type ChatEvent } from "./ui/chat.js";
import { StatusBar } from "./ui/status.js";
import { PermissionModal } from "./ui/permission.js";
import { LimitModal, type LimitDecision } from "./ui/limit-modal.js";
import { ResumePicker } from "./ui/resume-picker.js";
import { CheckpointPicker } from "./ui/checkpoint-picker.js";
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
import { Frame } from "./ui/frame.js";
import {
  configPath,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  loadConfig,
  saveConfig,
  type ReasoningEffort,
} from "./config.js";
import {
  startRemoteSession,
  streamRemoteProgress,
} from "./remote/worker-client.js";
import {
  saveRemoteSession,
  type RemoteSession,
} from "./remote/session-store.js";
import { deployForTui } from "./remote/tui-deploy.js";
import { authGitHubForTui } from "./remote/tui-auth.js";
import { RemoteDashboard, RemoteSessionDetail } from "./ui/remote-dashboard.js";
import {
  nextMode,
  type Mode,
  isBlockedInPlanMode,
  isReadOnlyBash,
} from "./mode.js";
import { classifyIntent } from "./intent/classify.js";
import { routeSkills, type SkillRoutingResult } from "./skills/index.js";
import {
  listAllSkills,
  createSkill,
  deleteSkill,
  setSkillEnabled,
  findSkillFile,
} from "./skills/manager.js";
import {
  ensureSessionId as ensureSessionIdFn,
  saveSessionSafe as saveSessionSafeFn,
  doResumeSession as doResumeSessionFn,
  handleResumePick as handleResumePickFn,
  handleCheckpointPick as handleCheckpointPickFn,
} from "./app/session-helpers.js";
import {
  listSessions,
  loadSession,
  addCheckpoint,
  generateSessionTitle,
  type SessionSummary,
  type Checkpoint,
} from "./sessions.js";
import { unlink } from "node:fs/promises";
import { encodeImageFile } from "./util/image.js";
import {
  recordUsage,
  getCostReport,
  formatCostReport,
} from "./usage-tracker.js";
import type { GatewayUsageLookup, DailyUsage } from "./usage-tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { RETENTION } from "./storage-limits.js";
import {
  shouldShowCreatorMessage,
  markCreatorMessageSeen,
} from "./util/state.js";
import { getAppVersion } from "./util/version.js";

import { renderCommand } from "./commands/renderer.js";
import { BUILTIN_COMMAND_NAMES } from "./commands/builtins.js";
import type { CustomCommand, SlashItem } from "./commands/types.js";

import type { SaveCustomCommandOptions } from "./commands/save.js";
import { CommandWizard } from "./ui/command-wizard.js";
import { buildInitPrompt } from "./init/context-generator.js";
import { CommandPicker } from "./ui/command-picker.js";
import { CommandList } from "./ui/command-list.js";
import { LspWizard } from "./ui/lsp-wizard.js";
import { ThemeProvider } from "./ui/theme-context.js";
import { FilledItem } from "./ui/select-item.js";
import { ThemePicker } from "./ui/theme-picker.js";
import {
  resolveTheme,
  themeList,
  themeNames,
  DEFAULT_THEME_NAME,
} from "./ui/theme.js";
import { loadAndMergeThemes } from "./ui/theme-loader.js";
import type { Theme } from "./ui/theme.js";
import { maybeLspNudge } from "./util/lsp-nudge.js";
import { saveProjectLspConfig } from "./util/lsp-config.js";
import { FilePicker } from "./ui/file-picker.js";
import { SlashPicker } from "./ui/slash-picker.js";

/**
 * Build a comprehensive ignore list for the @ file mention picker.
 * Combines common noise patterns (dependencies, build output, caches, etc.)
 * with patterns read from the project's .gitignore file.
 *
 * All hardcoded patterns use the `** /` prefix so they match at any depth
 * (e.g. `** /node_modules/ *` catches both root and nested node_modules).
 */
import { trackRecentFile } from "./util/file-picker.js";
import { detectGitHubRepo, detectGitBranch } from "./util/git-detect.js";
import { findImagePaths } from "./util/image-paths.js";
import { formatTokens } from "./util/token-format.js";
import { openBrowser } from "./util/browser.js";
import {
  capEvents,
  mkKey,
  makePrefixMessages,
  CONTEXT_LIMIT,
  AUTO_COMPACT_SUGGEST_PCT,
} from "./util/event-helpers.js";
import {
  initMcp as initMcpFn,
  initLsp as initLspFn,
} from "./app/mcp-lsp-init.js";
import { onIterationEnd as onIterationEndFn } from "./app/compaction.js";
import {
  reloadCustomCommands as reloadCustomCommandsFn,
  handleCommandSave as handleCommandSaveFn,
  handleCommandDelete as handleCommandDeleteFn,
} from "./app/commands-init.js";
import { runCompact as runCompactFn, runInitFn } from "./app/agent-turn.js";
import { processMessageFn, submitFn } from "./app/process-message.js";
import { useInputCoordinator } from "./app/input-coordinator.js";
import { createUiUpdaters } from "./app/ui-updates.js";
import { handleSlash as slashHandleSlash } from "./app/slash-commands.js";

export interface Cfg {
  accountId: string;
  apiToken: string;
  model: string;
  aiGatewayId?: string;
  aiGatewayCacheTtl?: number;
  aiGatewaySkipCache?: boolean;
  aiGatewayCollectLogPayload?: boolean;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  reasoningEffort?: ReasoningEffort;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
  mcpServers?: Record<
    string,
    {
      type: "local" | "remote";
      command?: string[];
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      enabled?: boolean;
    }
  >;
  cacheStablePrompts?: boolean;
  compiledContext?: boolean;
  imageHistoryTurns?: number;
  memoryEnabled?: boolean;
  memoryDbPath?: string;
  memoryMaxAgeDays?: number;
  memoryMaxEntries?: number;
  memoryEmbeddingModel?: string;
  plumbingModel?: string;
  memoryExtractionModel?: string;
  codeMode?: boolean;
  lspEnabled?: boolean;
  lspServers?: Record<
    string,
    {
      command: string[];
      env?: Record<string, string>;
      enabled?: boolean;
      rootPatterns?: string[];
    }
  >;
  costAttribution?: boolean;
  filePicker?: boolean;
  theme?: string;
  remoteWorkerUrl?: string;
  remoteAuthSecret?: string;
  remoteTtlMinutes?: number;
  remoteMaxInputTokens?: number;
  githubOAuthToken?: string;
  githubRefreshToken?: string;
  githubTokenExpiry?: number;
  githubRepo?: string;
  cloudMode?: boolean;
  cloudToken?: string;
}

export function gatewayFromConfig(cfg: Cfg): AiGatewayOptions | undefined {
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

const FEEDBACK_WORKER_URL = "https://hello.kimiflare.com";

interface PendingPermission {
  tool: ToolSpec;
  args: Record<string, unknown>;
  resolve: (d: PermissionDecision) => void;
}

type Overlay =
  | { kind: "none" }
  | { kind: "permission"; perm: PendingPermission }
  | { kind: "limitModal"; limit: number; resolve: (d: LimitDecision) => void }
  | { kind: "themePicker" }
  | { kind: "commandPicker"; mode: "edit" | "delete" }
  | { kind: "commandDelete"; cmd: CustomCommand }
  | { kind: "commandList" };

const MAX_IMAGES_PER_MESSAGE = 10;

function App({
  initialCfg,
  initialUpdateResult,
  initialLspScope,
  initialLspProjectPath,
  initialCloudToken,
  initialCloudDeviceId,
}: {
  initialCfg: Cfg | null;
  initialUpdateResult?: UpdateCheckResult;
  initialLspScope: "project" | "global";
  initialLspProjectPath: string | null;
  initialCloudToken?: string;
  initialCloudDeviceId?: string;
}) {
  const { exit } = useApp();
  const [cfg, setCfg] = useState<Cfg | null>(initialCfg);
  const [lspScope, setLspScope] = useState<"project" | "global">(
    initialLspScope,
  );
  const [lspProjectPath, setLspProjectPath] = useState<string | null>(
    initialLspProjectPath,
  );
  const [cloudToken, setCloudToken] = useState(initialCloudToken);
  const [cloudDeviceId] = useState(initialCloudDeviceId);
  const [events, setRawEvents] = useState<ChatEvent[]>([]);
  const setEvents = useCallback(
    (updater: React.SetStateAction<ChatEvent[]>) => {
      setRawEvents((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: ChatEvent[]) => ChatEvent[])(prev)
            : updater;
        return capEvents(next);
      });
    },
    [],
  );
  const appendEvent = useCallback(
    (event: ChatEvent) => setEvents((e) => [...e, event]),
    [setEvents],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessionUsage, setSessionUsage] = useState<DailyUsage | null>(null);

  function safeSave(operation: string, promise: Promise<unknown>): void {
    safeSaveRaw(operation, promise, (event) => setEvents((e) => [...e, event]));
  }
  const [gatewayMeta, setGatewayMeta] = useState<GatewayMeta | null>(null);
  const [cloudBudget, setCloudBudget] = useState<{
    remaining: number;
    limit: number;
  } | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [queue, setQueue] = useState<
    Array<{ full: string; display: string; key: string }>
  >([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");

  const [mode, setMode] = useState<Mode>("edit");
  const [codeMode, setCodeMode] = useState<boolean>(false);
  const filePickerEnabled = initialCfg?.filePicker ?? true;
  const [effort] = useState<ReasoningEffort>(
    initialCfg?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  const [resumeSessions, setResumeSessions] = useState<SessionSummary[] | null>(
    null,
  );
  const [checkpointSession, setCheckpointSession] =
    useState<SessionSummary | null>(null);
  const [checkpointList, setCheckpointList] = useState<Checkpoint[]>([]);
  const [commandWizard, setCommandWizard] = useState<{
    mode: "create" | "edit";
    initial?: CustomCommand;
  } | null>(null);
  const [showLspWizard, setShowLspWizard] = useState(false);
  const [showRemoteDashboard, setShowRemoteDashboard] = useState(false);
  const [selectedRemoteSession, setSelectedRemoteSession] =
    useState<RemoteSession | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStartedAt, setTasksStartedAt] = useState<number | null>(null);
  const [tasksStartTokens, setTasksStartTokens] = useState<number>(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnPhase, setTurnPhase] =
    useState<import("./ui/status.js").TurnPhase>("waiting");
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [_hasUpdate, setHasUpdate] = useState(
    initialUpdateResult?.hasUpdate ?? false,
  );
  const [_latestVersion, setLatestVersion] = useState<string | null>(
    initialUpdateResult?.latestVersion ?? null,
  );
  const [theme, setTheme] = useState<Theme>(resolveTheme(initialCfg?.theme));

  const [skillsActive, setSkillsActive] = useState(0);
  const [memoryRecalled] = useState(false);
  const [intentTier, setIntentTier] = useState<
    "light" | "medium" | "heavy" | null
  >(null);
  const skillsDirRef = useRef(join(process.cwd(), ".kimiflare", "skills"));
  const [kimiMdStale, setKimiMdStale] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [lastSessionTopic, setLastSessionTopic] = useState<string | null>(null);

  useEffect(() => {
    setGitBranch(detectGitBranch());
  }, []);

  // Register a SIGINT handler so Ctrl+C still works when the terminal is not
  // in raw mode (e.g. after a child process modified terminal state). The
  // handler delegates to the same logic as the useInput Ctrl+C handler.
  // This is different from the previous attempt (c6e9c1f) which unconditionally
  // called exit() and caused screen flashing by conflicting with useInput.
  useEffect(() => {
    const onSigint = () => {
      logger.info("sigint:fired", {
        hasHandler: sigintHandlerRef.current !== null,
      });
      sigintHandlerRef.current?.();
    };
    process.on("SIGINT", onSigint);
    return () => {
      process.off("SIGINT", onSigint);
    };
  }, []);

  // Fetch last session topic for smart welcome greetings
  useEffect(() => {
    void import("./sessions.js").then(({ listSessions }) =>
      listSessions(1).then((sessions) => {
        const last = sessions[0];
        if (last) {
          setLastSessionTopic(last.firstPrompt);
        }
      }),
    );
  }, []);

  // Load user and project themes at startup
  useEffect(() => {
    let cancelled = false;
    loadAndMergeThemes().then(({ errors, wcagWarnings }) => {
      if (cancelled) return;
      if (errors.length > 0) {
        setEvents((e) => [
          ...e,
          {
            kind: "error",
            key: mkKey(),
            text: `theme load errors:\n${errors.join("\n")}`,
          },
        ]);
      }
      if (wcagWarnings.length > 0) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `theme WCAG warnings:\n${wcagWarnings.join("\n")}`,
          },
        ]);
      }
      // Re-resolve current theme in case a user/project theme overrides the built-in
      setTheme(resolveTheme(initialCfg?.theme));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch cloud token budget on startup
  useEffect(() => {
    if (!cfg?.cloudMode || !initialCloudToken) return;
    let cancelled = false;
    const fetchBudget = async () => {
      const { fetchCloudUsage } = await import("./cloud/auth.js");
      const usage = await fetchCloudUsage(
        initialCloudToken,
        cloudDeviceId ?? initialCloudDeviceId,
      );
      if (usage && !cancelled) {
        setCloudBudget({
          remaining: usage.remaining,
          limit: usage.input_token_limit,
        });
      }
    };
    fetchBudget();
    return () => {
      cancelled = true;
    };
  }, [cfg?.cloudMode, initialCloudToken]);

  const [cursorOffset, setCursorOffset] = useState(0);
  const [customCommandsVersion, setCustomCommandsVersion] = useState(0);

  const cacheStableRef = useRef(initialCfg?.cacheStablePrompts !== false);
  const messagesRef = useRef<ChatMessage[]>(
    makePrefixMessages(
      cacheStableRef.current,
      cfg?.model ?? DEFAULT_MODEL,
      "edit",
      ALL_TOOLS,
    ),
  );
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const nextAssistantIdRef = useRef(1);
  const sessionScopeRef = useRef<AbortScope>(new AbortScope());
  const activeScopeRef = useRef<AbortScope | null>(null);
  const supervisorRef = useRef<TurnSupervisor>(new TurnSupervisor());
  const isAbortingRef = useRef(false);
  const lastEscapeAtRef = useRef(0);
  /** Holds the latest Ctrl+C interrupt logic so the SIGINT handler can delegate to it. */
  const sigintHandlerRef = useRef<(() => void) | null>(null);
  const permResolveRef = useRef<((d: PermissionDecision) => void) | null>(null);
  const limitResolveRef = useRef<((d: LimitDecision) => void) | null>(null);
  const pendingToolCallsRef = useRef<Map<string, string>>(new Map());
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreatedAtRef = useRef<string | null>(null);
  const sessionTitleRef = useRef<string | null>(null);
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
  const submitRef = useRef<(full: string, display?: string) => void>(() => {});
  const lspManagerRef = useRef(new LspManager());
  const lspToolsRef = useRef<ToolSpec[]>([]);
  const lspInitRef = useRef(false);
  const busyRef = useRef(busy);
  const memoryManagerRef = useRef<MemoryManager | null>(null);
  const sessionStartRecallRef = useRef<Promise<void> | null>(null);
  const kimiMdStaleNudgedRef = useRef(false);
  const turnCounterRef = useRef(0);

  // Batched streaming delta refs to reduce React re-render frequency
  const pendingTextRef = useRef<
    Map<number, { text: string; reasoning: string }>
  >(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customCommandsRef = useRef<CustomCommand[]>([]);
  const recentFilesRef = useRef<Map<string, number>>(new Map());
  const MAX_RECENT_FILES = 10;

  useEffect(() => {
    if (!cfg) return;
    // Prune old sessions on startup
    void import("./sessions.js").then(({ pruneSessions }) =>
      pruneSessions().then((removed) => {
        if (removed > 0) {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `pruned ${removed} old session files`,
            },
          ]);
        }
      }),
    );

    // Show creator welcome message once per version
    void shouldShowCreatorMessage(getAppVersion()).then((shouldShow) => {
      if (shouldShow) {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: "Hey, how do you like this version? I'd love to hear from you — type /hello to send me a voice note. Only I see it, and I may DM you back.",
          },
        ]);
        void markCreatorMessageSeen(getAppVersion());
      }
    });

    // Initialize memory manager if enabled
    if (cfg.memoryEnabled) {
      const dbPath =
        cfg.memoryDbPath ?? join(process.cwd(), ".kimiflare", "memory.db");
      const manager = new MemoryManager({
        dbPath,
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        plumbingModel: cfg.plumbingModel,
        extractionModel: cfg.memoryExtractionModel,
        embeddingModel: cfg.memoryEmbeddingModel,
        gateway: gatewayFromConfig(cfg),
        maxAgeDays: cfg.memoryMaxAgeDays ?? RETENTION.memoryMaxAgeDays,
        maxEntries: cfg.memoryMaxEntries ?? RETENTION.memoryMaxEntries,
      });
      manager.open();
      memoryManagerRef.current = manager;

      // Run cleanup and backfill on startup
      void manager.cleanup(process.cwd()).then((result) => {
        const total =
          result.oldDeleted + result.excessDeleted + result.duplicatesMerged;
        if (total > 0) {
          setEvents((e) => [
            ...e,
            {
              kind: "memory",
              key: mkKey(),
              text: `memory cleanup: removed ${total} stale entries`,
            },
          ]);
        }
      });
      void manager.backfill(process.cwd()).then((fixed) => {
        if (fixed > 0) {
          setEvents((e) => [
            ...e,
            {
              kind: "memory",
              key: mkKey(),
              text: `memory backfill: embedded ${fixed} un-vectorized entries`,
            },
          ]);
        }
      });

      // Fire session-start recall so the model walks in with context.
      // The promise is awaited in submit() before the first user message.
      const cwd = process.cwd();
      sessionStartRecallRef.current = (async () => {
        try {
          const results = await manager.recall({
            text: cwd,
            repoPath: cwd,
            limit: 5,
          });
          if (results.length > 0) {
            const text = await manager.synthesizeRecalled(results);
            // Insert after existing system messages, before any user messages
            const lastSystemIdx = messagesRef.current.findLastIndex(
              (m) => m.role === "system",
            );
            const insertIdx =
              lastSystemIdx >= 0
                ? lastSystemIdx + 1
                : messagesRef.current.length;
            messagesRef.current.splice(insertIdx, 0, {
              role: "system",
              content: text,
            });
            setEvents((e) => [
              ...e,
              {
                kind: "memory",
                key: mkKey(),
                text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} about this repo`,
              },
            ]);
          }
        } catch {
          // Non-fatal: session works fine without recalled memories
        }
      })();

      // Session-start drift check (Trigger A): if KIMI.md exists and high-signal
      // memories have been learned since the last refresh, mark as stale.
      if (existsSync(join(cwd, "KIMI.md"))) {
        const lastRefresh = manager.getLastKimiMdRefreshTime(cwd);
        const driftCount = manager.countHighSignalMemoriesSince(
          cwd,
          lastRefresh,
        );
        if (driftCount >= 5) {
          setKimiMdStale(true);
        }
      }
    } else {
      memoryManagerRef.current?.close();
      memoryManagerRef.current = null;
    }

    void reloadCustomCommandsFn(
      customCommandsRef,
      setCustomCommandsVersion,
      appendEvent,
    );
  }, [cfg, setEvents]);

  // Periodically clear performance marks to prevent perf_hooks buffer overflow
  // in long-running sessions (react-devtools-core causes marks on every render).
  useEffect(() => {
    const id = setInterval(() => {
      try {
        performance.clearMarks();
        performance.clearMeasures();
      } catch {
        // ignore — not all Node versions expose these globally
      }
    }, 300_000); // every 5 minutes
    return () => clearInterval(id);
  }, []);

  const reloadCustomCommands = useCallback(async () => {
    await reloadCustomCommandsFn(
      customCommandsRef,
      setCustomCommandsVersion,
      appendEvent,
    );
  }, [appendEvent]);

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
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          model: cfg?.model ?? DEFAULT_MODEL,
          mode,
        }),
      };
    } else {
      messagesRef.current[0] = {
        role: "system",
        content: buildSystemPrompt({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
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
    const id = setInterval(
      () => {
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
      },
      30 * 60 * 1000,
    ); // 30 minutes
    return () => clearInterval(id);
  }, [cfg]);

  const initMcp = useCallback(async () => {
    if (!cfg) return;
    await initMcpFn(
      cfg,
      mcpInitRef,
      mcpManagerRef,
      executorRef,
      mcpToolsRef,
      messagesRef,
      cacheStableRef,
      modeRef,
      lspToolsRef,
      appendEvent,
    );
  }, [cfg, appendEvent]);

  const initLsp = useCallback(async () => {
    if (!cfg) return;
    await initLspFn(
      cfg,
      lspInitRef,
      lspManagerRef,
      executorRef,
      lspToolsRef,
      messagesRef,
      cacheStableRef,
      modeRef,
      mcpToolsRef,
      appendEvent,
    );
  }, [cfg, appendEvent]);

  useEffect(() => {
    if (cfg && !mcpInitRef.current) {
      void initMcp();
    }
    if (cfg && !lspInitRef.current) {
      void initLsp();
    }
  }, [cfg, initMcp, initLsp]);

  const ensureSessionId = useCallback(() => {
    return ensureSessionIdFn({ sessionIdRef, messagesRef });
  }, []);

  const saveSessionSafe = useCallback(async () => {
    await saveSessionSafeFn({
      cfg,
      sessionIdRef,
      sessionCreatedAtRef,
      sessionTitleRef,
      sessionStateRef,
      compiledContextRef,
      artifactStoreRef,
      messagesRef,
      setEvents,
      mkKey,
    });
  }, [cfg]);

  /** Mid-turn compaction hook: called between tool-iteration cycles in runAgentTurn.
   *  Prevents context overflow during long exploration sessions. */
  const onIterationEnd = useCallback(
    async (
      messages: ChatMessage[],
      signal: AbortSignal,
    ): Promise<ChatMessage[]> => {
      return onIterationEndFn(
        messages,
        signal,
        cfg,
        compiledContextRef,
        artifactStoreRef,
        sessionStateRef,
        memoryManagerRef,
        appendEvent,
        saveSessionSafe,
      );
    },
    [cfg, saveSessionSafe, appendEvent],
  );

  const {
    activePicker,
    filteredFileItems,
    filteredSlashItems,
    pickerQuery,
    handlePickerUp,
    handlePickerDown,
    handlePickerSelect,
    handlePickerCancel,
    handleKeyPress,
  } = useInputCoordinator({
    input,
    setInput,
    cursorOffset,
    setCursorOffset,
    filePickerEnabled,
    recentFilesRef,
    maxRecentFiles: MAX_RECENT_FILES,
    customCommandsRef,
    customCommandsVersion,
    submitRef,
    setEvents,
    mkKey,
    permResolveRef,
    limitResolveRef,
    busyRef,
    activeScopeRef,
    isAbortingRef,
    supervisorRef,
    setQueue,
    saveSessionSafe,
    setTasks,
    setTasksStartedAt,
    setTasksStartTokens,
    tasksRef,
    lspManagerRef,
    overlay,
    showLspWizard,
    commandWizard,
    resumeSessions,
    checkpointSession,
    lastEscapeAtRef,
    setShowReasoning,
    setMode,
    nextMode,
    setVerbose,
    exit,
    setOverlay,
  });

  useInput(handleKeyPress);

  // Keep the SIGINT handler in sync with the latest state/refs so that when
  // the terminal sends a real SIGINT (bypassing Ink raw mode) we can still
  // interrupt the turn or exit gracefully.
  sigintHandlerRef.current = () => {
    logger.info("sigint:handler", {
      busy: busyRef.current,
      hasActiveScope: activeScopeRef.current !== null,
      isAborting: isAbortingRef.current,
      hasPerm: permResolveRef.current !== null,
      hasLimit: limitResolveRef.current !== null,
    });
    const hadPerm = permResolveRef.current !== null;
    const hadLimit = limitResolveRef.current !== null;
    if (hadPerm) {
      permResolveRef.current!("deny");
      permResolveRef.current = null;
      setOverlay({ kind: "none" });
    }
    if (hadLimit) {
      limitResolveRef.current!("stop");
      limitResolveRef.current = null;
      setOverlay({ kind: "none" });
    }
    if (busyRef.current && activeScopeRef.current && !isAbortingRef.current) {
      isAbortingRef.current = true;
      supervisorRef.current.killTurn();
      activeScopeRef.current.abort("user_stopped");
      setQueue([]);
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "(interrupted)" },
      ]);
      void saveSessionSafe();
      setTasks([]);
      setTasksStartedAt(null);
      setTasksStartTokens(0);
      tasksRef.current = [];
    } else if (!hadPerm && !hadLimit) {
      logger.info("sigint:handler:exiting");
      void lspManagerRef.current.stopAll().finally(() => exit());
    }
  };

  const { updateAssistant, updateTool } = createUiUpdaters({
    setEvents,
    pendingTextRef,
    flushTimeoutRef,
  });

  const updateGatewayMeta = useCallback((meta: GatewayMeta) => {
    gatewayMetaRef.current = meta;
    setGatewayMeta(meta);
  }, []);

  const runCompact = useCallback(async () => {
    await runCompactFn({
      cfg,
      busy,
      saveSessionSafe,
      setEvents,
      mkKey,
      setBusy,
      busyRef,
      setTurnStartedAt,
      setTurnPhase,
      setCurrentToolName,
      setLastActivityAt,
      sessionScopeRef,
      activeScopeRef,
      permResolveRef,
      limitResolveRef,
      pendingToolCallsRef,
      messagesRef,
      sessionStateRef,
      compiledContextRef,
      artifactStoreRef,
    });
  }, [cfg, busy, saveSessionSafe]);

  const openResumePicker = useCallback(async () => {
    const sessions = await listSessions(200, process.cwd());
    setResumeSessions(sessions);
  }, []);

  const runInit = useCallback(async () => {
    await runInitFn({
      cfg,
      busy,
      setEvents,
      mkKey,
      messagesRef,
      setBusy,
      busyRef,
      setTurnStartedAt,
      setTurnPhase,
      setCurrentToolName,
      setLastActivityAt,
      sessionScopeRef,
      activeScopeRef,
      setCodeMode,
      effortRef,
      cloudToken: cloudToken ?? null,
      initialCloudToken: initialCloudToken ?? null,
      cloudDeviceId: cloudDeviceId ?? null,
      initialCloudDeviceId: initialCloudDeviceId ?? null,
      mcpToolsRef,
      lspToolsRef,
      executorRef,
      memoryManagerRef,
      lspManagerRef,
      updateAssistant,
      updateTool,
      activeAsstIdRef,
      pendingToolCallsRef,
      usageRef,
      setUsage,
      setSessionUsage,
      ensureSessionId,
      gatewayMetaRef,
      permResolveRef,
      limitResolveRef,
      setOverlay,
      modeRef,
      kimiMdStaleNudgedRef,
      setKimiMdStale,
      setCloudBudget,
      tasksRef,
      setTasks,
      setTasksStartedAt,
      setTasksStartTokens,
      updateGatewayMeta,
      recordUsage,
      gatewayUsageLookupFromConfig,
      getCostReport,
      isBlockedInPlanMode,
      isReadOnlyBash,
      recentFilesRef,
      maxRecentFiles: MAX_RECENT_FILES,
      trackRecentFile,
      cacheStableRef,
      safeSave,
      saveConfig,
      isCloudQuotaExhaustedError,
      nextAssistantIdRef,
      onIterationEnd,
    });
  }, [cfg, busy, updateAssistant, updateTool, updateGatewayMeta]);

  const handleThemePick = useCallback((picked: Theme | null) => {
    setOverlay({ kind: "none" });
    if (!picked) return;
    setCfg((c) => {
      if (!c) return c;
      const updated = { ...c, theme: picked.name };
      safeSave("saveConfig", saveConfig(updated));
      return updated;
    });
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `theme: ${picked.label} — restart to apply`,
      },
    ]);
  }, []);

  const _doResumeSession = useCallback(
    async (filePath: string, checkpointId?: string) => {
      await doResumeSessionFn(
        {
          messagesRef,
          sessionIdRef,
          sessionCreatedAtRef,
          sessionStateRef,
          compiledContextRef,
          artifactStoreRef,
          memoryManagerRef,
          gatewayMetaRef,
          setEvents,
          setHistory,
          setUsage,
          setSessionUsage,
          setGatewayMeta,
          mkKey,
        },
        filePath,
        checkpointId,
      );
    },
    [],
  );

  const handleResumePick = useCallback(
    async (picked: SessionSummary | null) => {
      await handleResumePickFn(
        {
          messagesRef,
          sessionIdRef,
          sessionCreatedAtRef,
          sessionStateRef,
          compiledContextRef,
          artifactStoreRef,
          memoryManagerRef,
          gatewayMetaRef,
          setEvents,
          setHistory,
          setUsage,
          setSessionUsage,
          setGatewayMeta,
          mkKey,
          setResumeSessions,
          setCheckpointList,
          setCheckpointSession,
        },
        picked,
      );
    },
    [],
  );

  const handleCheckpointPick = useCallback(
    async (checkpointId: string | null) => {
      await handleCheckpointPickFn(
        {
          messagesRef,
          sessionIdRef,
          sessionCreatedAtRef,
          sessionStateRef,
          compiledContextRef,
          artifactStoreRef,
          memoryManagerRef,
          gatewayMetaRef,
          setEvents,
          setHistory,
          setUsage,
          setSessionUsage,
          setGatewayMeta,
          mkKey,
          setResumeSessions,
          setCheckpointList,
          setCheckpointSession,
        },
        checkpointSession,
        checkpointId,
      );
    },
    [checkpointSession],
  );

  const handleSlash = useCallback(
    (cmd: string): boolean => {
      return slashHandleSlash(cmd, {
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
        theme,
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
      });
    },
    [reloadCustomCommands, setEvents],
  );

  const handleCommandSave = useCallback(
    async (opts: SaveCustomCommandOptions) => {
      await handleCommandSaveFn(
        {
          commandWizard,
          setCommandWizard,
          setEvents,
          mkKey,
          reloadCustomCommands,
        },
        opts,
      );
    },
    [commandWizard, reloadCustomCommands, setEvents],
  );

  const handleCommandDelete = useCallback(
    async (cmd: CustomCommand) => {
      await handleCommandDeleteFn(
        { setOverlay, setEvents, mkKey, reloadCustomCommands },
        cmd,
      );
    },
    [reloadCustomCommands, setEvents],
  );

  const processMessage = useCallback(
    async (
      text: string,
      displayText?: string,
      opts?: { queuedKey?: string },
    ) => {
      await processMessageFn(
        {
          cfg,
          handleSlash,
          customCommandsRef,
          setEvents,
          mkKey,
          trackRecentFile,
          recentFilesRef,
          maxRecentFiles: MAX_RECENT_FILES,
          maxImagesPerMessage: MAX_IMAGES_PER_MESSAGE,
          findImagePaths,
          encodeImageFile,
          sessionStartRecallRef,
          maybeLspNudge,
          messagesRef,
          saveSessionSafe,
          compiledContextRef,
          artifactStoreRef,
          sessionStateRef,
          turnCounterRef,
          busyRef,
          gatewayMetaRef,
          setGatewayMeta,
          setTurnStartedAt,
          setIntentTier,
          sessionTitleRef,
          skillsDirRef,
          contextLimit: CONTEXT_LIMIT,
          setSkillsActive,
          effortRef,
          setCodeMode,
          cacheStableRef,
          mcpToolsRef,
          lspToolsRef,
          modeRef,
          nextAssistantIdRef,
          activeAsstIdRef,
          updateAssistant,
          updateTool,
          setTurnPhase,
          setLastActivityAt,
          setCurrentToolName,
          pendingToolCallsRef,
          executorRef,
          usageRef,
          setUsage,
          ensureSessionId,
          recordUsage,
          gatewayUsageLookupFromConfig,
          getCostReport,
          setSessionUsage,
          cloudToken: cloudToken ?? null,
          initialCloudToken: initialCloudToken ?? null,
          cloudDeviceId: cloudDeviceId ?? null,
          initialCloudDeviceId: initialCloudDeviceId ?? null,
          setCloudBudget,
          isBlockedInPlanMode,
          isReadOnlyBash,
          permResolveRef,
          setOverlay,
          limitResolveRef,
          kimiMdStaleNudgedRef,
          setKimiMdStale,
          tasksRef,
          setTasks,
          setTasksStartedAt,
          setTasksStartTokens,
          sessionScopeRef,
          activeScopeRef,
          isAbortingRef,
          supervisorRef,
          memoryManagerRef,
          lspManagerRef,
          safeSave,
          onIterationEnd,
          isCloudQuotaExhaustedError,
          setBusy,
          updateGatewayMeta,
          kimiMdStale,
        },
        text,
        displayText,
        opts,
      );
    },
    [
      cfg,
      handleSlash,
      updateAssistant,
      updateTool,
      saveSessionSafe,
      updateGatewayMeta,
    ],
  );

  useEffect(() => {
    if (!busy && queue.length > 0 && supervisorRef.current.phase === "idle") {
      const next = queue[0]!;
      setQueue((q) => q.slice(1));
      processMessage(next.full, next.display, { queuedKey: next.key });
    }
  }, [busy, queue, processMessage]);

  const submit = useCallback(
    (full: string, display?: string) => {
      submitFn(
        {
          busyRef,
          activeScopeRef,
          isAbortingRef,
          supervisorRef,
          setEvents,
          mkKey,
          setTasks,
          setTasksStartedAt,
          setTasksStartTokens,
          tasksRef,
          setQueue,
          setHistory,
          setInput,
          setHistoryIndex,
          history,
          draftInput,
          processMessage,
        },
        full,
        display,
      );
    },
    [processMessage, history, draftInput],
  );
  submitRef.current = submit;

  useEffect(() => {
    if (compactSuggestedRef.current) return;
    if (
      usage &&
      usage.prompt_tokens / CONTEXT_LIMIT >= AUTO_COMPACT_SUGGEST_PCT
    ) {
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
      <ThemeProvider theme={theme}>
        <Onboarding
          onCancel={() => exit()}
          onDone={async (newCfg) => {
            setCfg(newCfg);
            if (newCfg.cloudMode) {
              const { loadCloudCredentials } = await import("./cloud/auth.js");
              const creds = await loadCloudCredentials();
              if (creds) {
                setCloudToken(creds.accessToken);
                setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: mkKey(),
                    text: "configuration saved — welcome to kimiflare! (cloud mode)",
                  },
                ]);
              } else {
                setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: mkKey(),
                    text: "cloud mode configured — run `kimiflare auth cloud` to sign in",
                  },
                ]);
              }
            } else {
              setEvents((e) => [
                ...e,
                {
                  kind: "info",
                  key: mkKey(),
                  text: "configuration saved — welcome to kimiflare!",
                },
              ]);
            }
          }}
        />
      </ThemeProvider>
    );
  }

  if (checkpointSession !== null) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <CheckpointPicker
            session={checkpointSession}
            checkpoints={checkpointList}
            onPick={handleCheckpointPick}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (resumeSessions !== null) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <ResumePicker sessions={resumeSessions} onPick={handleResumePick} />
        </Box>
      </ThemeProvider>
    );
  }

  if (showRemoteDashboard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          {selectedRemoteSession ? (
            <RemoteSessionDetail
              session={selectedRemoteSession}
              onBack={() => setSelectedRemoteSession(null)}
              onCancel={async (session) => {
                try {
                  const { cancelRemoteSession } = await import(
                    "./remote/worker-client.js"
                  );
                  await cancelRemoteSession(
                    session.workerUrl,
                    session.sessionId,
                  );
                  setEvents((e) => [
                    ...e,
                    {
                      kind: "info",
                      key: mkKey(),
                      text: `Cancelled session ${session.sessionId}`,
                    },
                  ]);
                } catch (err) {
                  setEvents((e) => [
                    ...e,
                    {
                      kind: "error",
                      key: mkKey(),
                      text: `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`,
                    },
                  ]);
                }
                setSelectedRemoteSession(null);
                setShowRemoteDashboard(false);
              }}
            />
          ) : (
            <RemoteDashboard
              onSelect={(session) => setSelectedRemoteSession(session)}
              onCancel={() => setShowRemoteDashboard(false)}
            />
          )}
        </Box>
      </ThemeProvider>
    );
  }

  if (showLspWizard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <LspWizard
            servers={cfg?.lspServers ?? {}}
            currentScope={lspScope}
            hasProjectDir={existsSync(join(process.cwd(), ".kimiflare"))}
            onDone={() => setShowLspWizard(false)}
            onSave={(servers, enabled, scope) => {
              setCfg((c) =>
                c ? { ...c, lspEnabled: enabled, lspServers: servers } : c,
              );
              setLspScope(scope);
              if (scope === "project") {
                void saveProjectLspConfig(process.cwd(), {
                  lspEnabled: enabled,
                  lspServers: servers,
                })
                  .then((path) => {
                    setLspProjectPath(path);
                    setEvents((e) => [
                      ...e,
                      {
                        kind: "info",
                        key: mkKey(),
                        text: `LSP config saved to project (${path}). Run /lsp reload to apply.`,
                      },
                    ]);
                  })
                  .catch(() => {
                    setEvents((e) => [
                      ...e,
                      {
                        kind: "error",
                        key: mkKey(),
                        text: "Failed to save project LSP config.",
                      },
                    ]);
                  });
              } else if (cfg) {
                safeSave(
                  "saveConfig",
                  saveConfig({
                    ...cfg,
                    lspEnabled: enabled,
                    lspServers: servers,
                  }),
                );
                setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: mkKey(),
                    text: `LSP config saved to global config. Run /lsp reload to apply.`,
                  },
                ]);
              }
              setShowLspWizard(false);
            }}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (commandWizard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <CommandWizard
            mode={commandWizard.mode}
            initial={commandWizard.initial}
            existingNames={customCommandsRef.current.map((c) => c.name)}
            builtinNames={BUILTIN_COMMAND_NAMES}
            onDone={() => setCommandWizard(null)}
            onSave={handleCommandSave}
          />
        </Box>
      </ThemeProvider>
    );
  }

  const hasConversation = events.some(
    (e) => e.kind === "user" || e.kind === "assistant",
  );

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column">
        {!hasConversation && events.length === 0 ? (
          <Welcome />
        ) : (
          <ChatView
            events={events}
            showReasoning={showReasoning}
            verbose={verbose}
            intentTier={intentTier ?? undefined}
          />
        )}
        {overlay.kind === "permission" ? (
          <PermissionModal
            tool={overlay.perm.tool}
            args={overlay.perm.args}
            onDecide={(d) => {
              overlay.perm.resolve(d);
              permResolveRef.current = null;
              setOverlay({ kind: "none" });
            }}
          />
        ) : overlay.kind === "limitModal" ? (
          <LimitModal
            limit={overlay.limit}
            onDecide={(d) => {
              overlay.resolve(d);
              limitResolveRef.current = null;
              setOverlay({ kind: "none" });
            }}
          />
        ) : overlay.kind === "themePicker" ? (
          <ThemePicker themes={themeList()} onPick={handleThemePick} />
        ) : overlay.kind === "commandPicker" ? (
          <CommandPicker
            commands={customCommandsRef.current}
            title={
              overlay.mode === "edit"
                ? "Edit custom command"
                : "Delete custom command"
            }
            onPick={(cmd) => {
              setOverlay({ kind: "none" });
              if (!cmd) return;
              if (overlay.mode === "edit") {
                setCommandWizard({ mode: "edit", initial: cmd });
              } else {
                setOverlay({ kind: "commandDelete", cmd });
              }
            }}
          />
        ) : overlay.kind === "commandDelete" ? (
          <Frame borderColor={theme.accent} padX={1}>
            <Text color={theme.accent} bold>
              Delete /{overlay.cmd.name}?
            </Text>
            <Text color={theme.info.color}>{overlay.cmd.filepath}</Text>
            <Box marginTop={1}>
              <SelectInput
                itemComponent={FilledItem}
                items={[
                  { label: "Yes, delete", value: "yes", key: "yes" },
                  { label: "Cancel", value: "cancel", key: "cancel" },
                ]}
                onSelect={(item) => {
                  if (item.value === "yes") {
                    void handleCommandDelete(overlay.cmd);
                  } else {
                    setOverlay({ kind: "none" });
                  }
                }}
              />
            </Box>
          </Frame>
        ) : overlay.kind === "commandList" ? (
          <CommandList
            commands={customCommandsRef.current}
            onDone={() => setOverlay({ kind: "none" })}
          />
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {tasks.length > 0 && (
              <TaskList
                tasks={tasks}
                startedAt={tasksStartedAt}
                tokensDelta={Math.max(
                  0,
                  (usage?.prompt_tokens ?? 0) - tasksStartTokens,
                )}
              />
            )}
            {queue.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                {queue.map((q, i) => (
                  <Text
                    key={`queue_${i}`}
                    color={theme.info.color}
                    dimColor={theme.info.dim}
                  >
                    ⏳ {q.display}
                  </Text>
                ))}
              </Box>
            )}
            <StatusBar
              usage={usage}
              sessionUsage={sessionUsage}
              thinking={busy}
              turnStartedAt={turnStartedAt}
              mode={mode}
              contextLimit={CONTEXT_LIMIT}
              gatewayMeta={gatewayMeta}
              codeMode={codeMode}
              cloudMode={cfg.cloudMode}
              cloudBudget={cloudBudget}
              skillsActive={skillsActive}
              memoryRecalled={memoryRecalled}
              phase={turnPhase}
              currentTool={currentToolName}
              lastActivityAt={lastActivityAt}
              kimiMdStale={kimiMdStale}
              gitBranch={gitBranch}
              intentTier={intentTier ?? undefined}
            />
            {activePicker?.kind === "file" && (
              <FilePicker
                items={filteredFileItems}
                selectedIndex={activePicker.selected}
                query={pickerQuery ?? ""}
                recentFiles={new Set(recentFilesRef.current.keys())}
              />
            )}
            {activePicker?.kind === "slash" && (
              <SlashPicker
                items={filteredSlashItems}
                selectedIndex={activePicker.selected}
                query={pickerQuery ?? ""}
              />
            )}
            <Box marginTop={1}>
              <Text color={theme.prompt ?? theme.accent}>› </Text>
              <CustomTextInput
                value={input}
                onChange={setInput}
                onSubmit={submit}
                enablePaste
                cursorOffset={cursorOffset}
                onCursorChange={setCursorOffset}
                pickerActive={activePicker !== null}
                onPickerUp={handlePickerUp}
                onPickerDown={handlePickerDown}
                onPickerSelect={handlePickerSelect}
                onPickerCancel={handlePickerCancel}
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
    </ThemeProvider>
  );
}

export async function renderApp(
  cfg: Cfg | null,
  updateResult?: UpdateCheckResult,
  lspScope: "project" | "global" = "global",
  lspProjectPath: string | null = null,
  cloudToken?: string,
  cloudDeviceId?: string,
) {
  const instance = render(
    <App
      initialCfg={cfg}
      initialUpdateResult={updateResult}
      initialLspScope={lspScope}
      initialLspProjectPath={lspProjectPath}
      initialCloudToken={cloudToken}
      initialCloudDeviceId={cloudDeviceId}
    />,
    {
      incrementalRendering: true,
    },
  );
  await instance.waitUntilExit();
}
