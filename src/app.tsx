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
import { encodeImageFile, type EncodedImage } from "./util/image.js";
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
import type { CustomCommand, SlashItem } from "./commands/types.js";
import {
  BUILTIN_COMMANDS,
  BUILTIN_COMMAND_NAMES,
} from "./commands/builtins.js";

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
import { saveProjectLspConfig } from "./util/lsp-config.js";
import { maybeLspNudge } from "./util/lsp-nudge.js";
import fg from "fast-glob";
import { FilePicker, type FilePickerItem } from "./ui/file-picker.js";
import { SlashPicker } from "./ui/slash-picker.js";
import { fuzzyFilter } from "./util/fuzzy.js";

/**
 * Build a comprehensive ignore list for the @ file mention picker.
 * Combines common noise patterns (dependencies, build output, caches, etc.)
 * with patterns read from the project's .gitignore file.
 *
 * All hardcoded patterns use the `** /` prefix so they match at any depth
 * (e.g. `** /node_modules/ *` catches both root and nested node_modules).
 */
import {
  buildFilePickerIgnoreList,
  filterPickerItems,
  shouldOpenMentionPicker,
  shouldOpenSlashPicker,
  insertSlashCommand,
  trackRecentFile,
} from "./util/file-picker.js";
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
import { createUiUpdaters } from "./app/ui-updates.js";
import { handleSlash as slashHandleSlash } from "./app/slash-commands.js";

type ActivePicker =
  | { kind: "file"; anchor: number; selected: number }
  | { kind: "slash"; anchor: number; selected: number };

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

const nextAssistantIdRef = useRef(1);
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

  // Picker state — single popup at a time (file mention or slash command).
  const [cursorOffset, setCursorOffset] = useState(0);
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [filePickerItems, setFilePickerItems] = useState<FilePickerItem[]>([]);
  const filePickerLoadedRef = useRef(false);
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
  const sessionScopeRef = useRef<AbortScope>(new AbortScope());
  const activeScopeRef = useRef<AbortScope | null>(null);
  const supervisorRef = useRef<TurnSupervisor>(new TurnSupervisor());
  const isAbortingRef = useRef(false);
  const lastEscapeAtRef = useRef(0);
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
  const pickerCancelRef = useRef<number | null>(null);
  const recentFilesRef = useRef<Map<string, number>>(new Map());
  const MAX_RECENT_FILES = 10;

  // ── Picker logic (file mention `@` and slash command `/`) ──────────────
  // Depend on stable fields (kind, anchor) — not the activePicker reference,
  // which churns on every arrow-key press.
  const pickerAnchor = activePicker?.anchor ?? null;
  const pickerKind = activePicker?.kind ?? null;
  const pickerQuery = React.useMemo(() => {
    if (pickerAnchor === null) return null;
    return input.slice(pickerAnchor + 1, cursorOffset);
  }, [input, cursorOffset, pickerAnchor]);

  const filteredFileItems = React.useMemo(() => {
    if (pickerKind !== "file" || pickerQuery === null) return [];
    const items = filterPickerItems(filePickerItems, pickerQuery).slice();
    return items.sort((a, b) => {
      const aRecent = recentFilesRef.current.get(a.name) ?? 0;
      const bRecent = recentFilesRef.current.get(b.name) ?? 0;
      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      if (aRecent && bRecent) return bRecent - aRecent;
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [pickerKind, filePickerItems, pickerQuery]);

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

  const filteredSlashItems = React.useMemo(() => {
    if (pickerKind !== "slash" || pickerQuery === null) return [];
    return fuzzyFilter(allSlashCommands, pickerQuery, (c) => c.name).slice(
      0,
      50,
    );
  }, [pickerKind, allSlashCommands, pickerQuery]);

  useEffect(() => {
    if (activePicker !== null) {
      const trigger = activePicker.kind === "file" ? "@" : "/";
      if (cursorOffset < activePicker.anchor) {
        setActivePicker(null);
        return;
      }
      if (input[activePicker.anchor] !== trigger) {
        setActivePicker(null);
        return;
      }
      // Whitespace ends the token (start of args for slash, end of mention for @).
      const query = input.slice(activePicker.anchor + 1, cursorOffset);
      if (/\s/.test(query)) {
        setActivePicker(null);
        return;
      }
      return;
    }

    // Drop sticky-cancel once the cursor moves away from the cancel offset.
    if (pickerCancelRef.current === cursorOffset) {
      pickerCancelRef.current = null;
      return;
    }

    if (
      filePickerEnabled &&
      shouldOpenMentionPicker(input, cursorOffset, pickerCancelRef.current)
    ) {
      setActivePicker({ kind: "file", anchor: cursorOffset - 1, selected: 0 });
      if (!filePickerLoadedRef.current) {
        filePickerLoadedRef.current = true;
        const cwd = process.cwd();
        void fg("**/*", {
          cwd,
          ignore: buildFilePickerIgnoreList(cwd),
          dot: false,
          absolute: false,
          onlyFiles: false,
          markDirectories: true,
        } as fg.Options)
          .then((entries) => {
            const strings = (entries as string[]).slice(0, 300);
            const items: FilePickerItem[] = strings.map((e) => ({
              name: e.endsWith("/") ? e.slice(0, -1) : e,
              isDirectory: e.endsWith("/"),
            }));
            items.sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1;
              if (!a.isDirectory && b.isDirectory) return 1;
              return a.name.localeCompare(b.name);
            });
            setFilePickerItems(items);
          })
          .catch(() => {
            setFilePickerItems([]);
          });
      }
      return;
    }

    if (shouldOpenSlashPicker(input, cursorOffset, pickerCancelRef.current)) {
      setActivePicker({ kind: "slash", anchor: cursorOffset - 1, selected: 0 });
      return;
    }
  }, [input, cursorOffset, activePicker, filePickerEnabled]);

  // Clamp selected index when filtered list shrinks below the current selection.
  useEffect(() => {
    if (activePicker?.kind !== "file") return;
    const max = Math.max(0, filteredFileItems.length - 1);
    if (activePicker.selected > max) {
      setActivePicker({ ...activePicker, selected: max });
    }
  }, [filteredFileItems.length, activePicker]);

  useEffect(() => {
    if (activePicker?.kind !== "slash") return;
    const max = Math.max(0, filteredSlashItems.length - 1);
    if (activePicker.selected > max) {
      setActivePicker({ ...activePicker, selected: max });
    }
  }, [filteredSlashItems.length, activePicker]);

  const handlePickerUp = useCallback(() => {
    setActivePicker((p) => {
      if (!p) return null;
      const next = Math.max(0, p.selected - 1);
      return next === p.selected ? p : { ...p, selected: next };
    });
  }, []);

  const handlePickerDown = useCallback(() => {
    setActivePicker((p) => {
      if (!p) return null;
      const max =
        p.kind === "file"
          ? Math.max(0, filteredFileItems.length - 1)
          : Math.max(0, filteredSlashItems.length - 1);
      const next = Math.min(max, p.selected + 1);
      return next === p.selected ? p : { ...p, selected: next };
    });
  }, [filteredFileItems.length, filteredSlashItems.length]);

  const handlePickerSelect = useCallback(() => {
    if (!activePicker) return;
    if (activePicker.kind === "file") {
      const item = filteredFileItems[activePicker.selected];
      if (!item) return;
      trackRecentFile(recentFilesRef, item.name, MAX_RECENT_FILES);
      const insert = item.name + (item.isDirectory ? "/" : " ");
      const newInput =
        input.slice(0, activePicker.anchor) +
        insert +
        input.slice(cursorOffset);
      setInput(newInput);
      setCursorOffset(activePicker.anchor + insert.length);
      setActivePicker(null);
      return;
    }
    // slash
    const item = filteredSlashItems[activePicker.selected];
    if (!item) return;
    const { value } = insertSlashCommand(input, activePicker.anchor, item.name);
    setActivePicker(null);
    submitRef.current(value);
  }, [
    activePicker,
    filteredFileItems,
    filteredSlashItems,
    input,
    cursorOffset,
  ]);

  const handlePickerCancel = useCallback(() => {
    pickerCancelRef.current = cursorOffset;
    setActivePicker(null);
  }, [cursorOffset]);

  // Close any open picker when a modal takes over the input. Without this,
  // picker state would survive the modal and re-render on close.
  useEffect(() => {
    const modalActive =
      commandWizard !== null ||
      overlay.kind === "commandPicker" ||
      overlay.kind === "commandDelete" ||
      overlay.kind === "commandList" ||
      showLspWizard ||
      resumeSessions !== null ||
      checkpointSession !== null ||
      overlay.kind === "permission" ||
      overlay.kind === "limitModal";
    if (modalActive && activePicker !== null) {
      setActivePicker(null);
    }
  }, [
    commandWizard,
    overlay,
    showLspWizard,
    resumeSessions,
    checkpointSession,
    activePicker,
  ]);

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

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
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
        // Save session so interrupted turn is not lost
        void saveSessionSafe();
        // Clear task list immediately so it doesn't keep spinning
        setTasks([]);
        setTasksStartedAt(null);
        setTasksStartTokens(0);
        tasksRef.current = [];
      } else if (!hadPerm && !hadLimit) {
        void lspManagerRef.current.stopAll().finally(() => exit());
      }
      return;
    }
    if (key.escape) {
      const now = Date.now();
      const modalOpen =
        overlay.kind === "permission" ||
        overlay.kind === "limitModal" ||
        showLspWizard ||
        overlay.kind === "commandList" ||
        commandWizard !== null ||
        overlay.kind === "commandDelete" ||
        resumeSessions !== null ||
        checkpointSession !== null ||
        overlay.kind === "themePicker";
      if (
        !modalOpen &&
        busyRef.current &&
        activeScopeRef.current &&
        !isAbortingRef.current &&
        now - lastEscapeAtRef.current > 500
      ) {
        lastEscapeAtRef.current = now;
        isAbortingRef.current = true;
        supervisorRef.current.killTurn();
        if (permResolveRef.current) {
          permResolveRef.current("deny");
          permResolveRef.current = null;
          setOverlay({ kind: "none" });
        }
        if (limitResolveRef.current) {
          limitResolveRef.current("stop");
          limitResolveRef.current = null;
          setOverlay({ kind: "none" });
        }
        activeScopeRef.current.abort("user_stopped");
        setQueue([]);
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "(interrupted)" },
        ]);
        // Clear task list immediately so it doesn't keep spinning
        setTasks([]);
        setTasksStartedAt(null);
        setTasksStartTokens(0);
        tasksRef.current = [];
        return;
      }
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
  });

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

  const doResumeSession = useCallback(
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
          const { prompt: rendered, warnings } = await renderCommand(
            custom,
            trimmed,
            {
              cwd: process.cwd(),
            },
          );
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
          if (parts.length > 0)
            info(`command '${custom.name}' → ${parts.join(", ")} (this turn)`);
          if (custom.mode)
            info(
              `note: mode override (${custom.mode}) is not yet wired; current mode applies`,
            );
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

      const imagePaths = findImagePaths(trimmed).slice(
        0,
        MAX_IMAGES_PER_MESSAGE,
      );
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
                {
                  kind: "error",
                  key: mkKey(),
                  text: `failed to encode image ${path}: ${(e as Error).message}`,
                },
              ]);
              return null;
            }
          }),
        );
        const valid = encoded.filter(
          (x): x is { path: string; img: EncodedImage } => x !== null,
        );
        if (valid.length > 0) {
          images = valid.map((v) => v.img.filename);
          const parts: ContentPart[] = [
            { type: "text", text: sanitizeString(trimmed) },
            ...valid.map((v) => ({
              type: "image_url" as const,
              image_url: { url: v.img.dataUrl },
            })),
          ];
          content = parts;
        }
      }

      // Ensure session-start memory recall has settled before the first turn
      if (sessionStartRecallRef.current) {
        await sessionStartRecallRef.current;
        sessionStartRecallRef.current = null;
      }

      if (opts?.queuedKey) {
        setEvents((evts) =>
          evts.map((e) =>
            e.kind === "user" && e.key === opts.queuedKey
              ? {
                  ...e,
                  text: display,
                  images: images.length > 0 ? images : undefined,
                  queued: false,
                }
              : e,
          ),
        );
      } else {
        setEvents((e) => [
          ...e,
          {
            kind: "user",
            key: mkKey(),
            text: display,
            images: images.length > 0 ? images : undefined,
          },
        ]);
      }

      // LSP nudge: if user references code files and LSP is not configured
      const nudge = maybeLspNudge(
        display,
        cfg?.lspEnabled ?? false,
        cfg?.lspServers ?? {},
      );
      if (nudge) {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: nudge }]);
      }

      messagesRef.current.push({ role: "user", content });

      // Pre-turn save: ensure session exists even if user exits mid-turn
      await saveSessionSafe();

      // Recall artifacts before sending if compiled context is enabled
      if (compiledContextRef.current) {
        const { ids: _ids, recalled } = recallArtifacts(
          messagesRef.current,
          artifactStoreRef.current,
          sessionStateRef.current,
        );
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
          {
            kind: "info",
            key: mkKey(),
            text: "Tip: Rerunning /init occasionally helps KimiFlare stay accurate as your project evolves.",
          },
        ]);
      }

      setBusy(true);
      busyRef.current = true;
      gatewayMetaRef.current = null;
      setGatewayMeta(null);
      setTurnStartedAt(Date.now());

      const classification = classifyIntent(trimmed);
      setIntentTier(classification.tier);

      // Generate a human-readable title on first turn
      if (!sessionTitleRef.current) {
        sessionTitleRef.current = generateSessionTitle(
          trimmed,
          classification.intent,
        );
      }

      // Route skills based on intent tier
      let skillResult: SkillRoutingResult | undefined;
      try {
        skillResult = await routeSkills(skillsDirRef.current, {
          cwd: process.cwd(),
          prompt: trimmed,
          memorySnippets: [], // TODO: wire memory snippets when available
          tier: classification.tier,
          maxSkillTokens: CONTEXT_LIMIT - 10_000, // leave headroom
        });
        setSkillsActive(skillResult.selectedSkills.length);
      } catch {
        setSkillsActive(0);
      }

      const effortForTier: Record<string, ReasoningEffort> = {
        light: "low",
        medium: "medium",
        heavy: "high",
      };
      const turnReasoningEffort =
        overrideEffort ??
        effortForTier[classification.tier] ??
        effortRef.current;
      const effectiveCodeMode = classification.tier === "heavy";
      setCodeMode(effectiveCodeMode);

      // Inject selected skills into system prompt
      const selectedSkills = skillResult?.selectedSkills.map((s) => ({
        name: s.name,
        body: s.body,
      }));
      if (cacheStableRef.current) {
        messagesRef.current[1] = {
          role: "system",
          content: buildSessionPrefix({
            cwd: process.cwd(),
            tools: [
              ...ALL_TOOLS,
              ...mcpToolsRef.current,
              ...lspToolsRef.current,
            ],
            model: cfg.model,
            mode: modeRef.current,
            selectedSkills,
          }),
        };
      } else {
        messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd: process.cwd(),
            tools: [
              ...ALL_TOOLS,
              ...mcpToolsRef.current,
              ...lspToolsRef.current,
            ],
            model: cfg.model,
            mode: modeRef.current,
            selectedSkills,
          }),
        };
      }

      // Emit metadata banner
      setEvents((e) => [
        ...e,
        {
          kind: "meta",
          key: mkKey(),
          intentTier: classification.tier,
          skillsActive: skillResult?.selectedSkills.length ?? 0,
          memoryRecalled: false,
        },
      ]);

      const turnScope = sessionScopeRef.current.createChild();
      activeScopeRef.current = turnScope;

      const sharedCallbacks = {
        onAssistantStart: () => {
          const id = nextAssistantIdRef.current++;
          activeAsstIdRef.current = id;
          setTurnPhase("generating");
          setLastActivityAt(Date.now());
          setEvents((e) => [
            ...e,
            {
              kind: "assistant",
              key: `asst_${id}`,
              id,
              text: "",
              reasoning: "",
              streaming: true,
            },
          ]);
        },
        onReasoningDelta: (d: string) => {
          const id = activeAsstIdRef.current;
          if (id !== null)
            updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
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
          const spec = executorRef.current
            .list()
            .find((t) => t.name === call.function.name);
          let renderMeta: ToolRender | undefined;
          try {
            const args = call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {};
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
              startedAt: Date.now(),
            },
          ]);
        },
        onToolResult: (r: import("./tools/executor.js").ToolResult) => {
          pendingToolCallsRef.current.delete(r.tool_call_id);
          setLastActivityAt(Date.now());
          if (pendingToolCallsRef.current.size === 0) {
            setTurnPhase("waiting");
            setCurrentToolName(null);
          }
          updateTool(r.tool_call_id, {
            status: r.ok ? "done" : "error",
            result: r.content,
          });
        },
        onUsage: (u: Usage) => {
          usageRef.current = u;
          setUsage(u);
        },
        onUsageFinal: (u: Usage, meta?: GatewayMeta) => {
          const sid = ensureSessionId();
          void recordUsage(
            sid,
            u,
            gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current),
          );
          void getCostReport(sid).then((report) =>
            setSessionUsage(report.session),
          );
          // Refresh cloud budget so remaining tokens update in real time
          if (cfg?.cloudMode && (cloudToken ?? initialCloudToken)) {
            const token = cloudToken ?? initialCloudToken!;
            const did = cloudDeviceId ?? initialCloudDeviceId;
            void (async () => {
              const { fetchCloudUsage } = await import("./cloud/auth.js");
              const usage = await fetchCloudUsage(token, did);
              if (usage) {
                setCloudBudget({
                  remaining: usage.remaining,
                  limit: usage.input_token_limit,
                });
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
        askPermission: (req: import("./tools/executor.js").PermissionRequest) =>
          new Promise<PermissionDecision>((resolve) => {
            if (modeRef.current === "auto") {
              resolve("allow");
              return;
            }
            if (
              modeRef.current === "plan" &&
              isBlockedInPlanMode(req.tool.name)
            ) {
              if (
                req.tool.name === "bash" &&
                typeof req.args.command === "string" &&
                isReadOnlyBash(req.args.command)
              ) {
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
            permResolveRef.current = resolve;
            setOverlay({
              kind: "permission",
              perm: { tool: req.tool, args: req.args, resolve },
            });
          }),
        onToolLimitReached: () =>
          new Promise<LimitDecision>((resolve) => {
            limitResolveRef.current = resolve;
            setOverlay({ kind: "limitModal", limit: 50, resolve });
          }),
        onKimiMdStale: () => {
          if (!kimiMdStaleNudgedRef.current) {
            kimiMdStaleNudgedRef.current = true;
            setKimiMdStale(true);
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: "Project context may be stale. Run /init to refresh KIMI.md based on recent changes.",
              },
            ]);
          }
        },
      };

      const cleanupTurn = () => {
        setCodeMode(false);
        const asstId = activeAsstIdRef.current;
        if (asstId !== null)
          updateAssistant(asstId, () => ({ streaming: false }));
        setBusy(false);
        busyRef.current = false;
        setTurnStartedAt(null);
        setTurnPhase("waiting");
        setCurrentToolName(null);
        setLastActivityAt(null);
        activeAsstIdRef.current = null;
        activeScopeRef.current = null;
        isAbortingRef.current = false;
        permResolveRef.current = null;
        limitResolveRef.current = null;
        pendingToolCallsRef.current.clear();

        // Clear task list so it doesn't linger into the next turn
        setTasks([]);
        setTasksStartedAt(null);
        setTasksStartTokens(0);
        tasksRef.current = [];

        // Mark any still-running tools as interrupted
        setEvents((evts) =>
          evts.map((e) =>
            e.kind === "tool" && e.status === "running"
              ? { ...e, status: "error" as const, result: "(stopped)" }
              : e,
          ),
        );
      };

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
              ? {
                  name: cfg.coauthorName || "kimiflare",
                  email: cfg.coauthorEmail || "kimiflare@proton.me",
                }
              : undefined,
          sessionId: ensureSessionId(),
          memoryManager: memoryManagerRef.current,
          githubToken: cfg.githubOAuthToken,
          keepLastImageTurns: cfg.imageHistoryTurns ?? 2,
          codeMode: effectiveCodeMode,
          cloudMode: cfg.cloudMode,
          cloudToken: cloudToken ?? initialCloudToken,
          cloudDeviceId: cloudDeviceId ?? initialCloudDeviceId,
          onIterationEnd,
          intentClassification: classification,
          selectedSkills,
          onFileChange: (path, content) => {
            if (content) {
              lspManagerRef.current.notifyChange(path, content);
            } else {
              void import("node:fs/promises").then(({ readFile }) =>
                readFile(path, "utf8")
                  .then((c) => lspManagerRef.current.notifyChange(path, c))
                  .catch((err) => safeSave("lspNotify", Promise.reject(err))),
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
              if (compiledContextRef.current) {
                const store = artifactStoreRef.current;
                const result = compactCompiled({
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
                  const result = await compactMessages({
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
                const results = await manager.recall({
                  text: queryText,
                  repoPath: cwd,
                  limit: 5,
                });
                if (results.length > 0) {
                  const text = await manager.synthesizeRecalled(results);
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
                evts.map((e) =>
                  e.kind === "tool" && e.status === "running"
                    ? { ...e, status: "error" as const, result: "(stopped)" }
                    : e,
                ),
              );
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
                } catch {
                  /* ignore */
                }
              }
              if (!limit) {
                const m = (e as KimiApiError).message.match(
                  /Used ([\d,]+)\s*\/\s*([\d,]+)/,
                );
                if (m && m[1] && m[2]) {
                  used = parseInt(m[1].replace(/,/g, ""), 10);
                  limit = parseInt(m[2].replace(/,/g, ""), 10);
                }
              }
              setEvents((es) => [
                ...es,
                {
                  kind: "cloud_quota_exhausted",
                  key: mkKey(),
                  used,
                  limit,
                  expiresAt,
                },
              ]);
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
                  { kind: "error", key: mkKey(), text: e.message ?? String(e) },
                ]);
              }
            }
            cleanupTurn();
          },
        },
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
      const trimmedFull = full.trim();
      if (!trimmedFull) return;
      const trimmedDisplay = (display ?? full).trim() || trimmedFull;

      const historyEntry = trimmedDisplay;

      if (busyRef.current) {
        // Preempt current turn so user input is not blocked indefinitely
        if (activeScopeRef.current && !isAbortingRef.current) {
          isAbortingRef.current = true;
          supervisorRef.current.killTurn();
          activeScopeRef.current.abort("new_message");
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "(preempted)" },
          ]);
          // Clear task list immediately so it doesn't keep spinning
          setTasks([]);
          setTasksStartedAt(null);
          setTasksStartTokens(0);
          tasksRef.current = [];
        }
        const key = mkKey();
        setEvents((e) => [
          ...e,
          { kind: "user", key, text: trimmedDisplay, queued: true },
        ]);
        setQueue((q) => [
          ...q,
          { full: trimmedFull, display: trimmedDisplay, key },
        ]);
        setHistory((h) =>
          h.length > 0 && h[h.length - 1] === historyEntry
            ? h
            : [...h, historyEntry],
        );
        setInput("");
        setHistoryIndex(-1);
        return;
      }

      setHistory((h) =>
        h.length > 0 && h[h.length - 1] === historyEntry
          ? h
          : [...h, historyEntry],
      );
      setInput("");
      setHistoryIndex(-1);
      processMessage(
        trimmedFull,
        trimmedDisplay !== trimmedFull ? trimmedDisplay : undefined,
      );
    },
    [processMessage],
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
