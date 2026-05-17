import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";

import { runAgentTurn, AgentLoopError } from "./agent/loop.js";
import type { GatewayMeta } from "./agent/client.js";
import { buildSystemPrompt, buildSessionPrefix } from "./agent/system-prompt.js";
import { summarizeMessagesViaLlm } from "./agent/llm-summarize.js";
import {
  compactMessagesViaArtifacts,
  shouldCompact,
  recallArtifacts,
} from "./agent/artifact-compaction.js";
import {
  emptySessionState,
  ArtifactStore,
  formatRecalledArtifacts,
  serializeArtifactStore,
  type SessionState,
} from "./agent/session-state.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import { getShellCommand } from "./tools/bash.js";
import { McpManager } from "./mcp/manager.js";
import { LspManager } from "./lsp/manager.js";
import { HooksManager } from "./hooks/manager.js";
import { sanitizeString } from "./agent/messages.js";
import type { ChatMessage, ContentPart, Usage } from "./agent/messages.js";
import { KimiApiError, isCloudQuotaExhaustedError, isKillSwitchError, humanizeCloudflareError } from "./util/errors.js";
import { AbortScope } from "./util/abort-scope.js";
import { logger } from "./util/logger.js";
import { buildReport, sendReport } from "./cloud/report.js";
import type { CloudCredentials } from "./cloud/auth.js";
import { ChatView, type ChatEvent } from "./ui/chat.js";
import { StatusBar } from "./ui/status.js";
import { PermissionModal } from "./ui/permission.js";
import { usePermissionController } from "./ui/use-permission-controller.js";
import type { LimitDecision, LoopDecision } from "./ui/limit-modal.js";
import { ResumePicker } from "./ui/resume-picker.js";
import { CheckpointPicker } from "./ui/checkpoint-picker.js";
import { TaskList } from "./ui/task-list.js";
import type { Task } from "./tools/registry.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
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
  loadConfig,
  saveConfig,
  type ReasoningEffort,
} from "./config.js";
import { startRemoteSession, streamRemoteProgress } from "./remote/worker-client.js";
import { saveRemoteSession, type RemoteSession } from "./remote/session-store.js";
import { deployForTui } from "./remote/deploy.js";
import { authGitHubForTui } from "./remote/tui-auth.js";
import { nextMode, type Mode } from "./mode.js";
import { classifyIntent } from "./intent/classify.js";
import type { SemanticSkillRoutingResult } from "./skills/index.js";
import { getMemoryDb } from "./memory/db.js";
import { listAllSkills, createSkill, deleteSkill, setSkillEnabled, findSkillFile } from "./skills/manager.js";
import {
  loadSession,
  addCheckpoint,
  generateSessionTitle,
  type Checkpoint,
} from "./sessions.js";
import { unlink } from "node:fs/promises";
import { encodeImageFile, type EncodedImage } from "./util/image.js";
import { recordUsage, getCostReport, formatCostReport, formatGatewaySection, formatFeatureBreakdown, getSessionGatewayLogs, usageEvents } from "./usage-tracker.js";
import type { GatewayUsageLookup, DailyUsage } from "./usage-tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { loadCustomCommands } from "./commands/loader.js";
import { renderCommand } from "./commands/renderer.js";
import type { CustomCommand, SlashItem } from "./commands/types.js";
import { BUILTIN_COMMANDS, BUILTIN_COMMAND_NAMES } from "./commands/builtins.js";
import type { SaveCustomCommandOptions } from "./commands/save.js";
import { buildInitPrompt } from "./init/context-generator.js";
import { ThemeProvider } from "./ui/theme-context.js";
import { resolveTheme, themeList, themeNames, DEFAULT_THEME_NAME } from "./ui/theme.js";
import { loadAndMergeThemes } from "./ui/theme-loader.js";
import type { Theme } from "./ui/theme.js";
import type { ResolvedLspConfig } from "./util/lsp-config.js";
import { maybeLspNudge } from "./util/lsp-nudge.js";
import { glob } from "./util/glob.js";
import { FilePicker, type FilePickerItem } from "./ui/file-picker.js";
import { SlashPicker } from "./ui/slash-picker.js";
import { usePickerController } from "./ui/use-picker-controller.js";
import { useModalHost } from "./ui/use-modal-host.js";
import { ModalHost, ModalOverlay } from "./ui/modal-host.js";
import { useSessionManager } from "./ui/use-session-manager.js";
import { useTurnController } from "./ui/use-turn-controller.js";
import {
  interruptTurn as runInterruptTurn,
  interruptOrExit as runInterruptOrExit,
  type InterruptDeps,
} from "./ui/input-handlers.js";
import { dispatchSlashCommand, type SlashContext } from "./ui/slash-commands.js";
import { runInit as runInitImpl } from "./init/run-init.js";
import { runStartupTasks } from "./ui/run-startup-tasks.js";
import { initLsp as initLspImpl, initMcp as initMcpImpl } from "./ui/manager-init.js";
import { runCompact as runCompactImpl } from "./agent/run-compact.js";
import {
  handleCommandDelete as handleCommandDeleteImpl,
  handleCommandSave as handleCommandSaveImpl,
  handleLspSave as handleLspSaveImpl,
  handleRemoteCancel as handleRemoteCancelImpl,
} from "./ui/command-handlers.js";
import {
  AUTO_COMPACT_SUGGEST_PCT,
  buildFilePickerIgnoreList,
  capEvents,
  compactEventsVisual,
  CONTEXT_LIMIT,
  detectGitBranch,
  findImagePaths,
  gatewayFromConfig,
  gatewayUsageLookupFromConfig,
  makePrefixMessages,
  MAX_IMAGES_PER_MESSAGE,
  mkAssistantId,
  mkKey,
  openBrowser,
  trackRecentFile,
} from "./ui/app-helpers.js";

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
  mcpServers?: Record<string, { type: "local" | "remote"; command?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string>; enabled?: boolean; timeoutMs?: number }>;
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
  lspServers?: Record<string, { command: string[]; env?: Record<string, string>; enabled?: boolean; rootPatterns?: string[] }>;
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
  shell?: string;
}
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
  const [lspScope, setLspScope] = useState<"project" | "global">(initialLspScope);
  const [lspProjectPath, setLspProjectPath] = useState<string | null>(initialLspProjectPath);
  const [cloudToken, setCloudToken] = useState(initialCloudToken);
  const [cloudDeviceId, setCloudDeviceId] = useState(initialCloudDeviceId);
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessionUsage, setSessionUsage] = useState<DailyUsage | null>(null);

  // Refresh sessionUsage when usage-tracker emits an out-of-band update
  // (e.g. after a Gateway-log reconcile lands and patches a turn's real cost).
  useEffect(() => {
    const handler = (sid: string) => {
      if (sessionIdRef.current && sid === sessionIdRef.current) {
        void getCostReport(sid).then((report) => setSessionUsage(report.session));
      }
    };
    usageEvents.on("update", handler);
    return () => {
      usageEvents.off("update", handler);
    };
  }, []);
  const [gatewayMeta, setGatewayMeta] = useState<GatewayMeta | null>(null);
  const [cloudBudget, setCloudBudget] = useState<{ remaining: number; limit: number } | null>(null);
  const turn = useTurnController();
  const {
    busy, busyRef,
    isAbortingRef, lastEscapeAtRef,
    supervisorRef,
    turnPhase, setTurnPhase,
    turnStartedAt,
    currentToolName, setCurrentToolName,
    lastActivityAt, setLastActivityAt,
    turnCounterRef,
    showReasoning,
    tasks, setTasks, tasksRef,
    tasksStartedAt, setTasksStartedAt,
    tasksStartTokens, setTasksStartTokens,
    beginTurn, endTurn, clearTaskTracking,
  } = turn;
  const {
    pending: perm,
    askPermission: askForPermission,
    hasPending: hasPendingPermission,
    decide: decidePermission,
    denyPending: denyPendingPermission,
    clearResolveRef: clearPermissionResolveRef,
  } = usePermissionController(
    () => modeRef.current,
    (toolName) => {
      setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: mkKey(),
          text: `plan mode blocked ${toolName}; exit plan mode to execute`,
        },
      ]);
    },
  );
  const modals = useModalHost();
  const {
    limitModal, setLimitModal,
    loopModal, setLoopModal,
    commandWizard, setCommandWizard,
    commandPicker, setCommandPicker,
    commandToDelete, setCommandToDelete,
    showCommandList, setShowCommandList,
    showLspWizard, setShowLspWizard,
    showThemePicker, setShowThemePicker,
    showRemoteDashboard, setShowRemoteDashboard,
    showInboxModal, setShowInboxModal,
    hasFullscreenModal,
    hasAnyModal,
  } = modals;
  const [queue, setQueue] = useState<Array<{ full: string; display: string; key: string }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");

  const [mode, setMode] = useState<Mode>("edit");
  const [codeMode, setCodeMode] = useState<boolean>(false);
  const filePickerEnabled = initialCfg?.filePicker ?? true;
  const [effort, setEffort] = useState<ReasoningEffort>(
    initialCfg?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  const [selectedRemoteSession, setSelectedRemoteSession] = useState<RemoteSession | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(initialUpdateResult?.hasUpdate ?? false);
  const [latestVersion, setLatestVersion] = useState<string | null>(initialUpdateResult?.latestVersion ?? null);
  const [theme, setTheme] = useState<Theme>(resolveTheme(initialCfg?.theme));
  const [originalTheme, setOriginalTheme] = useState<Theme | null>(null);
  const [skillsActive, setSkillsActive] = useState(0);
  const [memoryRecalled, setMemoryRecalled] = useState(false);
  const [intentTier, setIntentTier] = useState<"light" | "medium" | "heavy" | null>(null);
  const [kimiMdStale, setKimiMdStale] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [lastSessionTopic, setLastSessionTopic] = useState<string | null>(null);

  useEffect(() => {
    setGitBranch(detectGitBranch());
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

  // Load user and project themes at startup
  useEffect(() => {
    let cancelled = false;
    loadAndMergeThemes().then(({ errors, wcagWarnings }) => {
      if (cancelled) return;
      if (errors.length > 0) {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: `theme load errors:\n${errors.join("\n")}` },
        ]);
      }
      if (wcagWarnings.length > 0) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `theme WCAG warnings:\n${wcagWarnings.join("\n")}` },
        ]);
      }
      // Re-resolve current theme in case a user/project theme overrides the built-in
      setTheme(resolveTheme(initialCfg?.theme));
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch cloud token budget on startup
  useEffect(() => {
    if (!cfg?.cloudMode || !initialCloudToken) return;
    let cancelled = false;
    const fetchBudget = async () => {
      try {
        const { fetchCloudUsage } = await import("./cloud/auth.js");
        const usage = await fetchCloudUsage(initialCloudToken, cloudDeviceId ?? initialCloudDeviceId);
        if (usage && !cancelled) {
          setCloudBudget({ remaining: usage.remaining, limit: usage.input_token_limit });
        }
      } catch (err) {
        if (isKillSwitchError(err) && !cancelled) {
          setCloudToken(undefined);
          setCloudDeviceId(undefined);
          setEvents((es) => [
            ...es,
            { kind: "service_ended", key: mkKey(), endedAt: err.endedAt },
          ]);
        }
        // Other errors are non-fatal
      }
    };
    fetchBudget();
    return () => { cancelled = true; };
  }, [cfg?.cloudMode, initialCloudToken]);

  // Cursor offset for the input box. The picker controller owns its own
  // open/close/selection state — see `usePickerController` below.
  const [cursorOffset, setCursorOffset] = useState(0);
  const [customCommandsVersion, setCustomCommandsVersion] = useState(0);

  const cacheStableRef = useRef(initialCfg?.cacheStablePrompts !== false);
  const messagesRef = useRef<ChatMessage[]>(
    makePrefixMessages(cacheStableRef.current, cfg?.model ?? DEFAULT_MODEL, "edit", ALL_TOOLS),
  );
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const sessionScopeRef = useRef<AbortScope>(new AbortScope());
  const activeScopeRef = useRef<AbortScope | null>(null);
  /** Holds the latest Ctrl+C interrupt logic so the SIGINT handler can delegate to it. */
  const sigintHandlerRef = useRef<(() => void) | null>(null);
  const limitResolveRef = useRef<((d: LimitDecision) => void) | null>(null);
  const loopResolveRef = useRef<((d: LoopDecision) => void) | null>(null);
  const pendingToolCallsRef = useRef<Map<string, string>>(new Map());
  const modeRef = useRef<Mode>(mode);
  const effortRef = useRef<ReasoningEffort>(effort);
  const usageRef = useRef<Usage | null>(null);
  const gatewayMetaRef = useRef<GatewayMeta | null>(null);
  const lastApiErrorRef = useRef<{ httpStatus?: number; code?: number; message: string } | null>(null);
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
  const memoryManagerRef = useRef<MemoryManager | null>(null);
  const hooksManagerRef = useRef<HooksManager>(new HooksManager(process.cwd()));
  // Wire hooks into the executor so every tool call — including those
  // generated from inside the code-mode sandbox (heavy-tier turns) —
  // fires PreToolUse / PostToolUse. The ref-based assignment after
  // construction is needed because the executor was created in line
  // with `useRef(new ToolExecutor(...))` above, before HooksManager
  // existed.
  useEffect(() => {
    executorRef.current.setHooks(hooksManagerRef.current);
    return () => executorRef.current.setHooks(null);
  }, []);
  const sessionStartRecallRef = useRef<Promise<import("./memory/schema.js").HybridResult[]> | null>(null);
  const kimiMdStaleNudgedRef = useRef(false);

  const sessionMgr = useSessionManager({
    cfg,
    messagesRef,
    sessionStateRef,
    artifactStoreRef,
    compiledContextRef,
    gatewayMetaRef,
    memoryManagerRef,
    setEvents,
    setHistory,
    setUsage,
    setSessionUsage,
    setGatewayMeta,
    mkKey,
  });
  const {
    sessionIdRef,
    sessionCreatedAtRef,
    sessionTitleRef,
    resumeSessions, setResumeSessions,
    checkpointSession, setCheckpointSession,
    checkpointList,
    ensureSessionId,
    saveSessionSafe,
    openResumePicker,
    doResumeSession,
    handleResumePick,
    handleCheckpointPick,
    resetSession,
  } = sessionMgr;

  // Batched streaming delta refs to reduce React re-render frequency
  const pendingTextRef = useRef<Map<number, { text: string; reasoning: string }>>(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customCommandsRef = useRef<CustomCommand[]>([]);
  const recentFilesRef = useRef<Map<string, number>>(new Map());
  const MAX_RECENT_FILES = 10;

  // Custom commands that shadow built-ins are warned about and won't run, so
  // don't surface them in the picker either. customCommandsVersion is bumped
  // by every customCommandsRef mutation — keep that invariant intact.
  const allSlashCommands = React.useMemo<SlashItem[]>(() => {
    const customs: SlashItem[] = customCommandsRef.current
      .filter((c) => !BUILTIN_COMMAND_NAMES.has(c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        description: c.description ?? "",
        source: c.source,
      }));
    return [...BUILTIN_COMMANDS, ...customs];
  }, [customCommandsVersion]);

  // Preserves the pre-refactor asymmetry: the picker close-on-modal check
  // includes showInboxModal but EXCLUDES showRemoteDashboard and
  // showThemePicker. Likely an oversight from when those modals were
  // added later — kept as-is for this pure refactor; revisit when we
  // audit modal/keybinding semantics.
  const modalActive =
    commandWizard !== null ||
    commandPicker !== null ||
    commandToDelete !== null ||
    showCommandList ||
    showLspWizard ||
    resumeSessions !== null ||
    checkpointSession !== null ||
    perm !== null ||
    limitModal !== null ||
    loopModal !== null ||
    showInboxModal;

  const loadFilePickerItems = useCallback(async (): Promise<FilePickerItem[]> => {
    const cwd = process.cwd();
    const entries = await glob("**/*", {
      cwd,
      ignore: buildFilePickerIgnoreList(cwd),
      dot: false,
      absolute: false,
      onlyFiles: false,
      markDirectories: true,
    });
    const strings = entries.slice(0, 300);
    const items: FilePickerItem[] = strings.map((e) => ({
      name: e.endsWith("/") ? e.slice(0, -1) : e,
      isDirectory: e.endsWith("/"),
    }));
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  }, []);

  const picker = usePickerController({
    input,
    cursorOffset,
    setInput,
    setCursorOffset,
    filePickerEnabled,
    allSlashCommands,
    modalActive,
    loadFilePickerItems,
    onFileSelected: (name) => trackRecentFile(recentFilesRef, name, MAX_RECENT_FILES),
    onSlashSelected: (value) => submitRef.current(value),
    getRecentFiles: () => recentFilesRef.current,
  });

  useEffect(() => {
    if (!cfg) return;
    runStartupTasks({
      cfg,
      setEvents,
      mkKey,
      memoryManagerRef,
      sessionStartRecallRef,
      setKimiMdStale,
      customCommandsRef,
      setCustomCommandsVersion,
      cloudToken,
      initialCloudToken,
      cloudDeviceId,
      initialCloudDeviceId,
    });
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
    const { commands, warnings } = await loadCustomCommands(process.cwd());
    customCommandsRef.current = commands;
    setCustomCommandsVersion((v) => v + 1);
    for (const w of warnings) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `commands: ${w}` }]);
    }
    const shadowed = commands.filter((c) => BUILTIN_COMMAND_NAMES.has(c.name.toLowerCase()));
    for (const c of shadowed) {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `commands: /${c.name} (${c.filepath}) shadowed by built-in — will not run` },
      ]);
    }
  }, [setEvents]);

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
    if (!cfg) return;
    await initMcpImpl({
      cfg,
      setEvents,
      mkKey,
      executorRef,
      messagesRef,
      cacheStableRef,
      modeRef,
      mcpToolsRef,
      lspToolsRef,
      mcpManagerRef,
      mcpInitRef,
    });
  }, [cfg]);

  const initLsp = useCallback(async () => {
    if (!cfg) return;
    await initLspImpl({
      cfg,
      setEvents,
      mkKey,
      executorRef,
      messagesRef,
      cacheStableRef,
      modeRef,
      mcpToolsRef,
      lspToolsRef,
      lspManagerRef,
      lspInitRef,
    });
  }, [cfg]);

  useEffect(() => {
    if (cfg && !mcpInitRef.current) {
      void initMcp();
    }
    if (cfg && !lspInitRef.current) {
      void initLsp();
    }
  }, [cfg, initMcp, initLsp]);

  /** Mid-turn compaction hook: called between tool-iteration cycles in runAgentTurn.
   *  Prevents context overflow during long exploration sessions. */
  const onIterationEnd = useCallback(
    async (messages: ChatMessage[], signal: AbortSignal): Promise<ChatMessage[]> => {
      if (signal.aborted) return messages;
      if (!shouldCompact({ messages })) return messages;

      // M6.1: fire PreCompact before either compaction path runs.
      // Best-effort + fire-and-forget — never block compaction on a
      // user hook. Same shape as the user-triggered /compact path.
      if (hooksManagerRef.current.hasEnabledHooks("PreCompact")) {
        void hooksManagerRef.current
          .fire(
            "PreCompact",
            {
              event: "PreCompact",
              session_id: sessionIdRef.current,
              cwd: process.cwd(),
            },
            null,
            signal,
          )
          .catch(() => {});
      }

      if (compiledContextRef.current) {
        const store = artifactStoreRef.current;
        const result = compactMessagesViaArtifacts({
          messages,
          state: sessionStateRef.current,
          store,
        });
        if (result.metrics.rawTurnsRemoved > 0) {
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
        // After compaction, recall memories so the model retains durable anchors
        const manager = memoryManagerRef.current;
        if (manager && !signal.aborted) {
          try {
            const cwd = process.cwd();
            const queryText = sessionStateRef.current.task || cwd;
            const results = await manager.recall({ text: queryText, repoPath: cwd, limit: 5 });
            if (results.length > 0 && !signal.aborted) {
              const text = await manager.synthesizeRecalled(results);
              const lastSystemIdx = result.newMessages.findLastIndex((m) => m.role === "system");
              const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : result.newMessages.length;
              result.newMessages.splice(insertIdx, 0, { role: "system", content: text });
              setEvents((e) => [
                ...e,
                {
                  kind: "memory",
                  key: mkKey(),
                  text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} after compaction`,
                },
              ]);
              await saveSessionSafe();
            }
          } catch {
            // Non-fatal
          }
        }
        return result.newMessages;
      }

      // Non-compiled context: fall back to LLM summarizer
      if (cfg && !signal.aborted) {
        try {
          const result = await summarizeMessagesViaLlm({
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            model: cfg.model,
            messages,
            signal,
            gateway: gatewayFromConfig(cfg),
          });
          if (result.replacedCount > 0) {
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: `auto-compacted: ${result.replacedCount} messages summarized`,
              },
            ]);
            await saveSessionSafe();
          }
          return result.newMessages;
        } catch {
          // Non-fatal: if compaction fails, continue with original messages
        }
      }
      return messages;
    },
    [cfg],
  );

  // The deps for interruptTurn / interruptOrExit. Assigned via a ref
  // below — after updateTool is declared — because useInput, the SIGINT
  // handler, and Esc all need to share the same object.
  const interruptDepsRef = useRef<InterruptDeps | null>(null);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      logger.info("input:ctrl+c", {
        busy: busyRef.current,
        hasActiveScope: activeScopeRef.current !== null,
        isAborting: isAbortingRef.current,
        hasPerm: hasPendingPermission(),
        hasLimit: limitResolveRef.current !== null,
      });
      const outcome = runInterruptOrExit(interruptDepsRef.current!);
      if (!outcome.didInterruptTurn && !outcome.hadPermission && !outcome.hadLimit && !outcome.hadLoop) {
        logger.info("input:ctrl+c:exiting");
      }
      return;
    }
    if (key.escape) {
      const now = Date.now();
      // Preserves the pre-refactor asymmetry: this Esc-handler check
      // EXCLUDES commandPicker, showInboxModal, and showRemoteDashboard
      // (so Esc still fires the abort-turn path when those are open).
      // Kept as-is for this pure refactor.
      const modalOpen =
        perm !== null ||
        limitModal !== null ||
        loopModal !== null ||
        showLspWizard ||
        showCommandList ||
        commandWizard !== null ||
        commandToDelete !== null ||
        resumeSessions !== null ||
        checkpointSession !== null ||
        showThemePicker;
      if (!modalOpen && busyRef.current && activeScopeRef.current && !isAbortingRef.current && now - lastEscapeAtRef.current > 500) {
        lastEscapeAtRef.current = now;
        runInterruptTurn(interruptDepsRef.current!);
        return;
      }
    }
    if (key.ctrl && inputChar === "r") {
      turn.toggleReasoning();
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
  });

  // Keep the SIGINT handler in sync with the latest state/refs so that when
  // the terminal sends a real SIGINT (bypassing Ink raw mode) we can still
  // interrupt the turn or exit gracefully.
  sigintHandlerRef.current = () => {
    logger.info("sigint:handler", {
      busy: busyRef.current,
      hasActiveScope: activeScopeRef.current !== null,
      isAborting: isAbortingRef.current,
      hasPerm: hasPendingPermission(),
      hasLimit: limitResolveRef.current !== null,
      hasLoop: loopResolveRef.current !== null,
    });
    // SIGINT preserves the pre-refactor asymmetry: it does NOT iterate
    // pendingToolCalls to mark them cancelled (the Ctrl+C path does).
    // Pass `skipPendingToolCleanup: true` so interruptTurn matches.
    const outcome = runInterruptOrExit({
      ...interruptDepsRef.current!,
      skipPendingToolCleanup: true,
    });
    if (!outcome.didInterruptTurn && !outcome.hadPermission && !outcome.hadLimit && !outcome.hadLoop) {
      logger.info("sigint:handler:exiting");
    }
  };

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

  // Keep the interruptDepsRef in sync with the latest refs / state. Read
  // by the useInput handler (Ctrl+C, Esc) and the SIGINT handler above.
  interruptDepsRef.current = {
    busyRef, activeScopeRef, isAbortingRef, supervisorRef,
    limitResolveRef, loopResolveRef, setLimitModal, setLoopModal,
    hasPendingPermission, denyPendingPermission,
    pendingToolCallsRef, updateTool,
    setEvents, mkKey,
    saveSessionSafe, clearTaskTracking,
    lspManagerRef, exit,
  };

  const runCompact = useCallback(async () => {
    if (!cfg) return;
    await runCompactImpl({
      cfg,
      busy,
      mkKey,
      setEvents,
      beginTurn,
      endTurn,
      saveSessionSafe,
      clearPermissionResolveRef,
      sessionScopeRef,
      activeScopeRef,
      compiledContextRef,
      artifactStoreRef,
      messagesRef,
      sessionStateRef,
      limitResolveRef,
      pendingToolCallsRef,
      hooks: hooksManagerRef.current,
      sessionId: sessionIdRef.current,
    });
  }, [cfg, busy, saveSessionSafe]);

  const runInit = useCallback(async () => {
    if (!cfg) return;
    await runInitImpl({
      cfg,
      busy,
      mkKey,
      setEvents,
      cloudToken,
      initialCloudToken,
      cloudDeviceId,
      initialCloudDeviceId,
      setCodeMode,
      setTurnPhase,
      setCurrentToolName,
      setLastActivityAt,
      setUsage,
      setSessionUsage,
      setCloudBudget,
      setCloudToken,
      setCloudDeviceId,
      setKimiMdStale,
      setLoopModal,
      beginTurn,
      endTurn,
      ensureSessionId,
      onIterationEnd,
      updateAssistant,
      updateTool,
      updateGatewayMeta,
      askForPermission,
      clearPermissionResolveRef,
      messagesRef,
      sessionScopeRef,
      activeScopeRef,
      mcpToolsRef,
      lspToolsRef,
      executorRef,
      effortRef,
      memoryManagerRef,
      pendingToolCallsRef,
      recentFilesRef,
      usageRef,
      activeAsstIdRef,
      gatewayMetaRef,
      kimiMdStaleNudgedRef,
      lspManagerRef,
      modeRef,
      cacheStableRef,
      lastApiErrorRef,
      limitResolveRef,
      loopResolveRef,
    });
  }, [cfg, busy, updateAssistant, updateTool, updateGatewayMeta]);

  const handleThemePick = useCallback(
    (picked: Theme | null) => {
      setShowThemePicker(false);
      if (!picked) return;
      setCfg((c) => {
        if (!c) return c;
        const updated = { ...c, theme: picked.name };
        void saveConfig(updated).catch(() => {});
        return updated;
      });
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `theme: ${picked.label} — restart to apply` },
      ]);
    },
    [],
  );

  const buildSlashContext = useCallback((): SlashContext => ({
    exit,
    busy,
    mkKey,
    setEvents,
    cfg,
    setCfg,
    mode,
    setMode,
    setShowReasoning: turn.setShowReasoning,
    setUsage,
    setSessionUsage,
    setGatewayMeta,
    setHasUpdate,
    setLatestVersion,
    setShowThemePicker,
    setShowInboxModal,
    setShowHooksDashboard: modals.setShowHooksDashboard,
    setShowLspWizard,
    setShowRemoteDashboard,
    setShowCommandList,
    setCommandWizard,
    setCommandPicker,
    lspScope,
    lspProjectPath,
    resetSession,
    clearTaskTracking,
    openResumePicker,
    runCompact,
    runInit,
    initMcp,
    initLsp,
    ensureSessionId,
    lspManagerRef,
    mcpManagerRef,
    hooksManagerRef,
    cacheStableRef,
    messagesRef,
    flushTimeoutRef,
    pendingTextRef,
    activeAsstIdRef,
    pendingToolCallsRef,
    usageRef,
    turnCounterRef,
    gatewayMetaRef,
    executorRef,
    mcpToolsRef,
    mcpInitRef,
    lspToolsRef,
    lspInitRef,
    sessionIdRef,
    compactSuggestedRef,
    updateNudgedRef,
    memoryManagerRef,
    artifactStoreRef,
    sessionStateRef,
    compiledContextRef,
    lastApiErrorRef,
    activeScopeRef,
  }), [
    exit, busy, cfg, mode, lspScope, lspProjectPath,
    setCfg, setMode, setEvents, setUsage, setSessionUsage, setGatewayMeta,
    setHasUpdate, setLatestVersion, setShowThemePicker, setShowInboxModal,
    setShowLspWizard, setShowRemoteDashboard, setShowCommandList,
    setCommandWizard, setCommandPicker,
    turn.setShowReasoning,
    resetSession, clearTaskTracking, openResumePicker, runCompact, runInit,
    initMcp, initLsp, ensureSessionId,
  ]);

  const handleSlash = useCallback(
    (cmd: string): boolean => dispatchSlashCommand(buildSlashContext(), cmd),
    [buildSlashContext],
  );

  const handleCommandSave = useCallback(
    (opts: SaveCustomCommandOptions) =>
      handleCommandSaveImpl(
        { setEvents, mkKey, commandWizard, setCommandWizard, reloadCustomCommands },
        opts,
      ),
    [commandWizard, reloadCustomCommands, setEvents],
  );

  const handleCommandDelete = useCallback(
    (cmd: CustomCommand) =>
      handleCommandDeleteImpl(
        { setEvents, mkKey, setCommandToDelete, reloadCustomCommands },
        cmd,
      ),
    [reloadCustomCommands, setEvents, setCommandToDelete],
  );

  const handleLspSave = useCallback(
    (
      servers: NonNullable<Cfg["lspServers"]>,
      enabled: boolean,
      scope: "project" | "global",
    ) =>
      handleLspSaveImpl(
        {
          cfg,
          setCfg,
          setEvents,
          mkKey,
          setLspScope,
          setLspProjectPath,
          setShowLspWizard,
        },
        servers,
        enabled,
        scope,
      ),
    [cfg, setCfg, setEvents, setShowLspWizard],
  );

  const handleRemoteCancel = useCallback(
    (session: RemoteSession) =>
      handleRemoteCancelImpl(
        { setEvents, mkKey, setSelectedRemoteSession, setShowRemoteDashboard },
        session,
      ),
    [setEvents, setShowRemoteDashboard],
  );

  const processMessage = useCallback(
    async (text: string, displayText?: string, opts?: { queuedKey?: string }) => {
      if (!cfg) return;
      let trimmed = text.trim();
      if (!trimmed) return;

      let overrideModel: string | undefined;
      let overrideEffort: ReasoningEffort | undefined;
      let display = displayText?.trim() || trimmed;

      if (trimmed.startsWith("/")) {
        if (handleSlash(trimmed)) return;
        const head = trimmed.split(/\s+/)[0]!.slice(1);
        const custom = customCommandsRef.current.find((c) => c.name === head);
        if (custom) {
          const info = (text: string) =>
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text }]);
          const { prompt: rendered, warnings } = await renderCommand(custom, trimmed, {
            cwd: process.cwd(),
          });
          for (const w of warnings) info(`/${custom.name}: ${w}`);
          if (custom.shell) {
            info(`/${custom.name}: executing shell code from template`);
          }
          if (!rendered.trim()) return;
          const parts: string[] = [];
          if (custom.model) {
            overrideModel = custom.model;
            parts.push(`model=${custom.model}`);
          }
          if (custom.effort) {
            overrideEffort = custom.effort;
            parts.push(`effort=${custom.effort}`);
          }
          if (parts.length > 0) info(`command '${custom.name}' → ${parts.join(", ")} (this turn)`);
          if (custom.mode) info(`note: mode override (${custom.mode}) is not yet wired; current mode applies`);
          display = trimmed;
          trimmed = rendered;
        }
      }

      // Track @-mentioned files for recent-files picker boost
      const mentionMatches = trimmed.matchAll(/@(\S+)/g);
      for (const m of mentionMatches) {
        const path = m[1];
        if (path) trackRecentFile(recentFilesRef, path, MAX_RECENT_FILES);
      }

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

      if (opts?.queuedKey) {
        setEvents((evts) =>
          evts.map((e) =>
            e.kind === "user" && e.key === opts.queuedKey
              ? { ...e, text: display, images: images.length > 0 ? images : undefined, queued: false }
              : e,
          ),
        );
      } else {
        setEvents((e) => [...e, { kind: "user", key: mkKey(), text: display, images: images.length > 0 ? images : undefined }]);
      }

      // LSP nudge: if user references code files and LSP is not configured
      const nudge = maybeLspNudge(display, cfg?.lspEnabled ?? false, cfg?.lspServers ?? {});
      if (nudge) {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: nudge }]);
      }

      // M6.1: classify intent EARLY so the tier is available to the
      // UserPromptSubmit hook payload. Classification is local + cheap
      // (no network). The result is reused below where the turn is
      // actually configured, so this isn't a duplicate cost.
      const classification = classifyIntent(trimmed);

      // UserPromptSubmit hook (veto-able). Fired after we know the
      // prompt resolves to actual user-message content (post slash /
      // custom command expansion). A vetoing hook cancels the turn
      // before any LLM call.
      if (hooksManagerRef.current.hasEnabledHooks("UserPromptSubmit")) {
        const promptOutcome = await hooksManagerRef.current.fire(
          "UserPromptSubmit",
          {
            event: "UserPromptSubmit",
            session_id: sessionIdRef.current,
            cwd: process.cwd(),
            prompt: display,
            tier: classification.tier,
          },
          null,
        );
        if (promptOutcome.vetoed) {
          const reason = promptOutcome.vetoReason || "UserPromptSubmit hook blocked the prompt";
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `hook blocked the prompt: ${reason}` },
          ]);
          return;
        }
      }

      messagesRef.current.push({ role: "user", content });

      // Pre-turn save: ensure session exists even if user exits mid-turn
      await saveSessionSafe();

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

      // Occasional gentle nudge about /init (educational, not a warning)
      turnCounterRef.current += 1;
      if (
        turnCounterRef.current % 15 === 0 &&
        existsSync(join(process.cwd(), "KIMI.md")) &&
        !kimiMdStale
      ) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "Tip: Rerunning /init occasionally helps KimiFlare stay accurate as your project evolves." },
        ]);
      }

      beginTurn();
      gatewayMetaRef.current = null;
      setGatewayMeta(null);

      // Classification already computed above for the UserPromptSubmit
      // hook payload (M6.1). Reuse it here to avoid re-running.
      setIntentTier(classification.tier);

      // Generate a human-readable title on first turn
      if (!sessionTitleRef.current) {
        sessionTitleRef.current = generateSessionTitle(trimmed, classification.intent);
      }

      const effortForTier: Record<string, ReasoningEffort> = {
        light: "low",
        medium: "medium",
        heavy: "high",
      };
      const turnReasoningEffort = overrideEffort ?? effortForTier[classification.tier] ?? effortRef.current;
      const effectiveCodeMode = classification.tier === "heavy";
      setCodeMode(effectiveCodeMode);

      const turnScope = sessionScopeRef.current.createChild();
      activeScopeRef.current = turnScope;

      // Pre-turn async work (session-start memory recall + skill routing) is
      // performed inside runAgentTurn so it is covered by the supervisor
      // lifecycle and the turn's abort signal.

      const sharedCallbacks = {
        onAssistantStart: () => {
          const id = mkAssistantId();
          activeAsstIdRef.current = id;
          setTurnPhase("generating");
          setLastActivityAt(Date.now());
          setEvents((e) => [
            ...e,
            { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true },
          ]);
        },
        onReasoningDelta: (d: string) => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
          setLastActivityAt(Date.now());
        },
        onTextDelta: (d: string) => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, (e) => ({ text: e.text + d }));
          setLastActivityAt(Date.now());
        },
        onAssistantFinal: () => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, () => ({ streaming: false }));
          setTurnPhase("waiting");
        },
        onToolCallFinalized: (call: import("./agent/messages.js").ToolCall) => {
          pendingToolCallsRef.current.set(call.id, call.function.name);
          setTurnPhase("executing");
          setCurrentToolName(call.function.name);
          setLastActivityAt(Date.now());
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
              status: "queued",
              render: renderMeta,
              expanded: false,
            },
          ]);
        },
        onToolWillExecute: (id: string, name: string) => {
          setTurnPhase("executing");
          setCurrentToolName(name);
          setLastActivityAt(Date.now());
          updateTool(id, { status: "running", startedAt: Date.now() });
        },
        onToolResult: (r: import("./tools/executor.js").ToolResult) => {
          pendingToolCallsRef.current.delete(r.tool_call_id);
          setLastActivityAt(Date.now());
          if (pendingToolCallsRef.current.size === 0) {
            setTurnPhase("waiting");
            setCurrentToolName(null);
          }
          updateTool(r.tool_call_id, {
            status: !r.ok && typeof r.content === "string" && r.content.startsWith("Permission denied") ? "rejected" : r.ok ? "done" : "error",
            result: r.content,
          });
        },
        onUsage: (u: Usage) => {
          usageRef.current = u;
          setUsage(u);
        },
        onUsageFinal: (u: Usage, meta?: GatewayMeta) => {
          const sid = ensureSessionId();
          void recordUsage(sid, u, gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current));
          void getCostReport(sid).then((report) => setSessionUsage(report.session));
          // Refresh cloud budget so remaining tokens update in real time
          if (cfg?.cloudMode && (cloudToken ?? initialCloudToken)) {
            const token = cloudToken ?? initialCloudToken!;
            const did = cloudDeviceId ?? initialCloudDeviceId;
            void (async () => {
              try {
                const { fetchCloudUsage } = await import("./cloud/auth.js");
                const usage = await fetchCloudUsage(token, did);
                if (usage) {
                  setCloudBudget({ remaining: usage.remaining, limit: usage.input_token_limit });
                }
              } catch (err) {
                if (isKillSwitchError(err)) {
                  setCloudToken(undefined);
                  setCloudDeviceId(undefined);
                  setEvents((es) => [
                    ...es,
                    { kind: "service_ended", key: mkKey(), endedAt: err.endedAt },
                  ]);
                }
                // Other errors are non-fatal
              }
            })();
          }
        },
        onGatewayMeta: updateGatewayMeta,
        onTasks: (nextTasks: Task[]) => {
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
        askPermission: askForPermission,
        onToolLimitReached: () =>
          new Promise<LimitDecision>((resolve) => {
            limitResolveRef.current = resolve;
            setLimitModal({ limit: 50, resolve });
          }),
        onLoopDetected: () =>
          new Promise<LoopDecision>((resolve) => {
            loopResolveRef.current = resolve;
            setLoopModal({ resolve });
          }),
        onKimiMdStale: () => {
          if (!kimiMdStaleNudgedRef.current) {
            kimiMdStaleNudgedRef.current = true;
            setKimiMdStale(true);
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: "Project context may be stale. Run /init to refresh KIMI.md based on recent changes." },
            ]);
          }
        },
        onMemoryRecalled: (count: number) => {
          setEvents((e) => [
            ...e,
            { kind: "memory", key: mkKey(), text: `recalled ${count} memory${count === 1 ? "" : "ies"} about this repo` },
          ]);
        },
        onSkillsSelected: (result: SemanticSkillRoutingResult) => {
          setSkillsActive(result.sectionCount);
        },
        onMetaBanner: (info: { intentTier: string; skillsActive: number; memoryRecalled: boolean }) => {
          setEvents((e) => [
            ...e,
            {
              kind: "meta",
              key: mkKey(),
              intentTier: info.intentTier as "light" | "medium" | "heavy",
              skillsActive: info.skillsActive,
              memoryRecalled: info.memoryRecalled,
            },
          ]);
        },
      };

      const cleanupTurn = () => {
        logger.info("cleanupTurn");
        setCodeMode(false);
        const asstId = activeAsstIdRef.current;
        if (asstId !== null) updateAssistant(asstId, () => ({ streaming: false }));
        endTurn();
        activeAsstIdRef.current = null;
        activeScopeRef.current = null;
        clearPermissionResolveRef();
        limitResolveRef.current = null;
        loopResolveRef.current = null;
        setLoopModal(null);
        pendingToolCallsRef.current.clear();

        // Clear task list so it doesn't linger into the next turn
        clearTaskTracking();

        // Mark any still-running tools as interrupted
        setEvents((evts) =>
          evts.map((e) => (e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const, result: "(stopped)" } : e)),
        );
      };

      // Clear the one-shot session-start recall so it is not reused.
      sessionStartRecallRef.current = null;

      supervisorRef.current.startTurn(
        {
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: overrideModel ?? cfg.model,
          gateway: gatewayFromConfig(cfg),
          messages: messagesRef.current,
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          executor: executorRef.current,
          cwd: process.cwd(),
          signal: turnScope.signal,
          reasoningEffort: turnReasoningEffort,
          coauthor:
            cfg.coauthor !== false
              ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
              : undefined,
          sessionId: ensureSessionId(),
          memoryManager: memoryManagerRef.current,
          hooks: hooksManagerRef.current,
          githubToken: cfg.githubOAuthToken,
          keepLastImageTurns: cfg.imageHistoryTurns ?? 2,
          codeMode: effectiveCodeMode,
          cloudMode: cfg.cloudMode,
          cloudToken: cloudToken ?? initialCloudToken,
          cloudDeviceId: cloudDeviceId ?? initialCloudDeviceId,
          onIterationEnd,
          intentClassification: classification,
          sessionStartRecall: sessionStartRecallRef.current ?? undefined,
          skillsDb: getMemoryDb() ?? undefined,
          skillRoutingConfig: {
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            embeddingModel: cfg.memoryEmbeddingModel,
            gateway: gatewayFromConfig(cfg),
            cloudMode: cfg.cloudMode,
            cloudToken: cloudToken ?? initialCloudToken,
            cloudDeviceId: cloudDeviceId ?? initialCloudDeviceId,
            maxSkillTokens: CONTEXT_LIMIT - 10_000,
          },
          mode: modeRef.current,
          cacheStable: cacheStableRef.current,
          onFileChange: (path, content) => {
            if (content) {
              lspManagerRef.current.notifyChange(path, content);
            } else {
              void import("node:fs/promises").then(({ readFile }) =>
                readFile(path, "utf8")
                  .then((c) => lspManagerRef.current.notifyChange(path, c))
                  .catch(() => {}),
              );
            }
          },
          callbacks: sharedCallbacks,
        },
        {
          onDone: async () => {
            await saveSessionSafe();

            // If the turn was killed (preempted or aborted), skip expensive
            // post-turn work so the next turn can start immediately.
            if (turnScope.signal.aborted) {
              cleanupTurn();
              return;
            }

            // Auto-compact after turn when thresholds are met. With compiled
            // context on, use the heuristic compactor; otherwise fall back to the
            // LLM summarizer so users have a safety net regardless of the flag.
            if (shouldCompact({ messages: messagesRef.current })) {
              // M6.1: same PreCompact fire as the mid-turn site above.
              if (hooksManagerRef.current.hasEnabledHooks("PreCompact")) {
                void hooksManagerRef.current
                  .fire(
                    "PreCompact",
                    {
                      event: "PreCompact",
                      session_id: sessionIdRef.current,
                      cwd: process.cwd(),
                    },
                    null,
                  )
                  .catch(() => {});
              }
              if (compiledContextRef.current) {
                const store = artifactStoreRef.current;
                const result = compactMessagesViaArtifacts({
                  messages: messagesRef.current,
                  state: sessionStateRef.current,
                  store,
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
              } else {
                try {
                  const result = await summarizeMessagesViaLlm({
                    accountId: cfg.accountId,
                    apiToken: cfg.apiToken,
                    model: cfg.model,
                    messages: messagesRef.current,
                    signal: turnScope.signal,
                    gateway: gatewayFromConfig(cfg),
                  });
                  if (result.replacedCount > 0) {
                    messagesRef.current = result.newMessages;
                    setEvents((e) => [
                      ...e,
                      {
                        kind: "info",
                        key: mkKey(),
                        text: `auto-compacted: ${result.replacedCount} messages summarized`,
                      },
                    ]);
                    await saveSessionSafe();
                  }
                } catch (compactErr) {
                  if ((compactErr as Error).name !== "AbortError") {
                    setEvents((es) => [
                      ...es,
                      {
                        kind: "info",
                        key: mkKey(),
                        text: `auto-compact failed: ${(compactErr as Error).message ?? String(compactErr)}`,
                      },
                    ]);
                  }
                }
              }
            }

            // After compaction, recall memories so the model retains durable anchors
            const manager = memoryManagerRef.current;
            if (manager) {
              try {
                const cwd = process.cwd();
                const queryText = sessionStateRef.current.task || cwd;
                const results = await manager.recall({ text: queryText, repoPath: cwd, limit: 5 });
                if (results.length > 0) {
                  const text = await manager.synthesizeRecalled(results);
                  const lastSystemIdx = messagesRef.current.findLastIndex((m) => m.role === "system");
                  const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : messagesRef.current.length;
                  messagesRef.current.splice(insertIdx, 0, { role: "system", content: text });
                  setEvents((e) => [
                    ...e,
                    {
                      kind: "memory",
                      key: mkKey(),
                      text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} after compaction`,
                    },
                  ]);
                  await saveSessionSafe();
                }
              } catch {
                // Non-fatal
              }
            }

            cleanupTurn();
          },
          onError: async (e) => {
            if (e.name === "AbortError") {
              // Inject synthetic tool results for any pending tool calls so message
              // history remains valid (assistant msg with tool_calls needs 1:1 results).
              for (const [tcId, tcName] of pendingToolCallsRef.current) {
                messagesRef.current.push({
                  role: "tool",
                  tool_call_id: tcId,
                  content: "(stopped)",
                  name: tcName,
                });
              }
              setEvents((evts) =>
                evts.map((e) => (e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const, result: "(stopped)" } : e)),
              );
            } else if (isKillSwitchError(e)) {
              setCloudToken(undefined);
              setCloudDeviceId(undefined);
              setEvents((es) => [
                ...es,
                { kind: "service_ended", key: mkKey(), endedAt: e.endedAt },
              ]);
            } else if (cfg?.cloudMode && isCloudQuotaExhaustedError(e)) {
              const token = cloudToken ?? initialCloudToken;
              const did = cloudDeviceId ?? initialCloudDeviceId;
              let used = 0;
              let limit = 0;
              let expiresAt = "";
              if (token) {
                try {
                  const { fetchCloudUsage } = await import("./cloud/auth.js");
                  const usage = await fetchCloudUsage(token, did);
                  if (usage) {
                    used = usage.input_tokens_used;
                    limit = usage.input_token_limit;
                    expiresAt = usage.expires_at;
                  }
                } catch { /* ignore */ }
              }
              if (!limit) {
                const m = (e as KimiApiError).message.match(/Used ([\d,]+)\s*\/\s*([\d,]+)/);
                if (m && m[1] && m[2]) {
                  used = parseInt(m[1].replace(/,/g, ""), 10);
                  limit = parseInt(m[2].replace(/,/g, ""), 10);
                }
              }
              setEvents((es) => [
                ...es,
                { kind: "cloud_quota_exhausted", key: mkKey(), used, limit, expiresAt },
              ]);
            } else if (
              e instanceof KimiApiError &&
              (e.httpStatus === 429 || e.code === 3040 || (e.httpStatus !== undefined && e.httpStatus >= 500))
            ) {
              const err = { httpStatus: e.httpStatus, code: e.code, message: humanizeCloudflareError(e) };
              lastApiErrorRef.current = err;
              setEvents((es) => [
                ...es,
                { kind: "api_error", key: mkKey(), ...err },
              ]);
            } else {
              const displayText =
                e instanceof KimiApiError
                  ? humanizeCloudflareError(e)
                  : e.message ?? String(e);
              setEvents((es) => [
                ...es,
                { kind: "error", key: mkKey(), text: displayText },
              ]);
            }
            cleanupTurn();
          },
        },
      );
    },
    [cfg, handleSlash, updateAssistant, updateTool, saveSessionSafe, updateGatewayMeta],
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
      const trimmedFull = full.trim();
      if (!trimmedFull) return;
      const trimmedDisplay = (display ?? full).trim() || trimmedFull;

      const historyEntry = trimmedDisplay;

      if (busyRef.current) {
        const key = mkKey();
        setEvents((e) => [...e, { kind: "user", key, text: trimmedDisplay, queued: true }]);
        setQueue((q) => [...q, { full: trimmedFull, display: trimmedDisplay, key }]);
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
    [processMessage],
  );
  submitRef.current = submit;

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
      <ThemeProvider theme={theme}>
        <Onboarding
          onCancel={() => exit()}
          onDone={async (newCfg) => {
            setCfg(newCfg);
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: "configuration saved — welcome to kimiflare!" },
            ]);
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

  if (hasFullscreenModal) {
    return (
      <ModalHost
        modals={modals}
        theme={theme}
        customCommands={customCommandsRef.current}
        builtinNames={BUILTIN_COMMAND_NAMES}
        onCommandSave={handleCommandSave}
        onCommandDelete={handleCommandDelete}
        lspServers={cfg?.lspServers ?? {}}
        lspScope={lspScope}
        hasProjectDir={existsSync(join(process.cwd(), ".kimiflare"))}
        onLspSave={handleLspSave}
        themes={themeList()}
        onPickTheme={handleThemePick}
        selectedRemoteSession={selectedRemoteSession}
        onSelectRemoteSession={setSelectedRemoteSession}
        onCancelRemoteSession={handleRemoteCancel}
        onInboxOpen={openBrowser}
        getConfiguredHooks={() => {
          const out: { event: import("./hooks/types.js").HookEvent; hook: import("./hooks/types.js").HookConfig }[] = [];
          for (const ev of (["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "PreCompact"] as const)) {
            for (const h of hooksManagerRef.current.hooksFor(ev)) {
              out.push({ event: ev, hook: h });
            }
          }
          return out;
        }}
        cwd={process.cwd()}
        onHooksMutate={() => hooksManagerRef.current.reload()}
      />
    );
  }

  const hasConversation = events.some((e) => e.kind === "user" || e.kind === "assistant");

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column">
        {!hasConversation && events.length === 0 ? (
          <Welcome />
        ) : (
          <ChatView events={events} showReasoning={showReasoning} verbose={verbose} intentTier={intentTier ?? undefined} />
        )}
        {perm ? (
          <PermissionModal
            tool={perm.tool}
            args={perm.args}
            onDecide={decidePermission}
            onFeedback={(text) => {
              submitRef.current(text);
            }}
          />
        ) : limitModal || loopModal ? (
          <ModalOverlay
            modals={modals}
            onLimitResolved={() => { limitResolveRef.current = null; }}
            onLoopResolved={() => { loopResolveRef.current = null; }}
          />
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {tasks.length > 0 && (
              <TaskList
                tasks={tasks}
                startedAt={tasksStartedAt}
                tokensDelta={Math.max(0, (usage?.prompt_tokens ?? 0) - tasksStartTokens)}
              />
            )}
            {queue.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                {queue.map((q, i) => (
                  <Text key={`queue_${i}`} color={theme.info.color} dimColor={theme.info.dim}>
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
            {picker.active?.kind === "file" && (
              <FilePicker
                items={picker.fileItems}
                selectedIndex={picker.active.selected}
                query={picker.query}
                recentFiles={new Set(recentFilesRef.current.keys())}
              />
            )}
            {picker.active?.kind === "slash" && (
              <SlashPicker
                items={picker.slashItems}
                selectedIndex={picker.active.selected}
                query={picker.query}
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
              pickerActive={picker.isActive}
              onPickerUp={picker.onUp}
              onPickerDown={picker.onDown}
              onPickerSelect={picker.onSelect}
              onPickerCancel={picker.onCancel}
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
      // Disable Ink's built-in Ctrl+C → app.exit() handler. We need
      // Ctrl+C to reach our useInput handler so it can interrupt the
      // current turn (abort the scope, kill the supervisor, deny
      // pending modals) without unmounting the React tree. Without
      // this, Ink consumes Ctrl+C, exits the app mid-cleanup, the
      // agent loop and LSP servers keep the process alive in the
      // background, and the terminal is left in cooked mode showing
      // a frozen last frame with a phantom prompt below — see RF-20.
      exitOnCtrlC: false,
    },
  );
  await instance.waitUntilExit();
}
