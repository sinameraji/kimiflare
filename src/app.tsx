import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";

import { runAgentTurn, AgentLoopError } from "./agent/loop.js";
import { TurnSupervisor } from "./agent/supervisor.js";
import type { AiGatewayOptions, GatewayMeta } from "./agent/client.js";
import { buildSystemPrompt, buildSystemMessages, buildSessionPrefix } from "./agent/system-prompt.js";
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
import { makeLspTools } from "./tools/lsp.js";
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
import { existsSync, statSync } from "node:fs";
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
import {
  selectSkills,
  indexSkills,
  initSkillsSchema,
  type SemanticSkillRoutingResult,
} from "./skills/index.js";
import { openMemoryDb, getMemoryDb } from "./memory/db.js";
import { listAllSkills, createSkill, deleteSkill, setSkillEnabled, findSkillFile } from "./skills/manager.js";
import {
  loadSession,
  addCheckpoint,
  generateSessionTitle,
  type Checkpoint,
} from "./sessions.js";
import { unlink } from "node:fs/promises";
import { execSync } from "node:child_process";
import { encodeImageFile, isImagePath, type EncodedImage } from "./util/image.js";
import { recordUsage, getCostReport, formatCostReport, formatGatewaySection, formatFeatureBreakdown, getSessionGatewayLogs, usageEvents } from "./usage-tracker.js";
import type { GatewayUsageLookup, DailyUsage } from "./usage-tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { RETENTION } from "./storage-limits.js";
import { shouldShowCreatorMessage, markCreatorMessageSeen } from "./util/state.js";
import { getAppVersion } from "./util/version.js";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { loadCustomCommands } from "./commands/loader.js";
import { renderCommand } from "./commands/renderer.js";
import type { CustomCommand, SlashItem } from "./commands/types.js";
import { BUILTIN_COMMANDS, BUILTIN_COMMAND_NAMES } from "./commands/builtins.js";
import { saveCustomCommand, deleteCustomCommand } from "./commands/save.js";
import type { SaveCustomCommandOptions } from "./commands/save.js";
import { buildInitPrompt } from "./init/context-generator.js";
import { ThemeProvider } from "./ui/theme-context.js";
import { resolveTheme, themeList, themeNames, DEFAULT_THEME_NAME } from "./ui/theme.js";
import { loadAndMergeThemes } from "./ui/theme-loader.js";
import type { Theme } from "./ui/theme.js";
import { saveProjectLspConfig, type ResolvedLspConfig } from "./util/lsp-config.js";
import { maybeLspNudge } from "./util/lsp-nudge.js";
import fg from "fast-glob";
import { FilePicker, type FilePickerItem } from "./ui/file-picker.js";
import { SlashPicker } from "./ui/slash-picker.js";
import { usePickerController } from "./ui/use-picker-controller.js";
import { useModalHost } from "./ui/use-modal-host.js";
import { ModalHost, ModalOverlay } from "./ui/modal-host.js";
import { useSessionManager } from "./ui/use-session-manager.js";
import { readFileSync } from "node:fs";

/**
 * Build a comprehensive ignore list for the @ file mention picker.
 * Combines common noise patterns (dependencies, build output, caches, etc.)
 * with patterns read from the project's .gitignore file.
 *
 * All hardcoded patterns use the `** /` prefix so they match at any depth
 * (e.g. `** /node_modules/ *` catches both root and nested node_modules).
 */
const MAX_GITIGNORE_SIZE = 1 * 1024 * 1024; // 1 MB

export function buildFilePickerIgnoreList(cwd: string): string[] {
  const hardcoded = [
    // Dependencies
    "**/node_modules/**",
    "**/vendor/**",
    "**/.bundle/**",
    "**/bower_components/**",
    // Version control
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",
    // Build / output directories
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/public/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.svelte-kit/**",
    "**/.vercel/**",
    "**/.netlify/**",
    "**/target/**",
    "**/bin/**",
    "**/obj/**",
    "**/Debug/**",
    "**/Release/**",
    "**/.gradle/**",
    // Caches
    "**/.cache/**",
    "**/.parcel-cache/**",
    "**/.turbo/**",
    "**/.eslintcache",
    "**/.stylelintcache",
    "**/.rpt2_cache/**",
    "**/.rts2_cache/**",
    // Temporary
    "**/tmp/**",
    "**/temp/**",
    "**/*.tmp",
    // Coverage
    "**/coverage/**",
    "**/.nyc_output/**",
    // OS files
    "**/.DS_Store",
    "**/Thumbs.db",
    // Logs
    "**/*.log",
    "**/logs/**",
    // Lock files (auto-generated, usually huge)
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lockb",
    "**/Cargo.lock",
    "**/Gemfile.lock",
    "**/composer.lock",
    "**/Pipfile.lock",
    "**/poetry.lock",
    "**/go.sum",
    // Minified / source maps
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    // kimiflare internal
    "**/.kimiflare/**",
    // IDE (usually not relevant to mention)
    "**/.idea/**",
  ];

  // Try to read .gitignore for project-specific ignores.
  // Gitignore patterns are relative to the repo root and may match at any
  // depth. We approximate that by prefixing with `** /`. Patterns that
  // already start with `*` or `/` are handled carefully.
  const gitignorePatterns: string[] = [];
  try {
    const gitignorePath = join(cwd, ".gitignore");
    const stats = statSync(gitignorePath);
    if (stats.size > MAX_GITIGNORE_SIZE) {
      // Guardrail 1.4: skip oversized .gitignore files
      return hardcoded;
    }
    const content = readFileSync(gitignorePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Skip negation patterns — fast-glob ignore doesn't support them
      if (trimmed.startsWith("!")) continue;

      let pattern = trimmed;
      const isAnchored = pattern.startsWith("/");
      const isDir = pattern.endsWith("/");

      // Remove leading slash for processing
      if (isAnchored) pattern = pattern.slice(1);
      // Remove trailing slash for processing
      if (isDir) pattern = pattern.slice(0, -1);

      // Skip patterns that are already wildcards or empty
      if (!pattern) continue;

      if (isAnchored) {
        // Anchored patterns only match at root, so keep them relative to cwd
        gitignorePatterns.push(isDir ? pattern + "/**" : pattern);
      } else {
        // Unanchored patterns match at any depth — prepend `**/`
        gitignorePatterns.push(isDir ? "**/" + pattern + "/**" : "**/" + pattern);
      }
    }
  } catch {
    // No .gitignore found — that's fine
  }

  return [...hardcoded, ...gitignorePatterns];
}

interface Cfg {
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

function gatewayFromConfig(cfg: Cfg): AiGatewayOptions | undefined {
  if (process.env.KIMIFLARE_DISABLE_AI_GATEWAY === "1") return undefined;
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
  if (process.env.KIMIFLARE_DISABLE_AI_GATEWAY === "1") return undefined;
  if (!cfg.aiGatewayId || !meta) return undefined;
  return {
    accountId: cfg.accountId,
    apiToken: cfg.apiToken,
    gatewayId: cfg.aiGatewayId,
    meta,
  };
}

const FEEDBACK_WORKER_URL = "https://hello.kimiflare.com";

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function detectGitHubRepo(cachedRepo?: string): { owner: string; name: string } | null {
  if (cachedRepo) {
    const parts = cachedRepo.split("/");
    if (parts.length === 2) return { owner: parts[0]!, name: parts[1]! };
  }
  try {
    const remoteUrl = execSync("git remote get-url origin", { cwd: process.cwd(), encoding: "utf8" }).trim();
    const httpsMatch = remoteUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1]!, name: httpsMatch[2]! };
    const sshMatch = remoteUrl.match(/github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1]!, name: sshMatch[2]! };
  } catch {
    // not a git repo or no origin remote
  }
  return null;
}

function detectGitBranch(): string | null {
  try {
    return execSync("git branch --show-current", { cwd: process.cwd(), encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function trackRecentFile(ref: React.MutableRefObject<Map<string, number>>, path: string, max = 10): void {
  ref.current.set(path, Date.now());
  if (ref.current.size > max) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [p, t] of ref.current) {
      if (t < oldestTime) {
        oldestTime = t;
        oldest = p;
      }
    }
    if (oldest) ref.current.delete(oldest);
  }
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

  // Extract quoted paths first (e.g. "/path/to/my image.png")
  const quotedRegex = /"([^"]+)"|'([^']+)'/g;
  let match;
  while ((match = quotedRegex.exec(text)) !== null) {
    const path = match[1] ?? match[2];
    if (path && isImagePath(path) && existsSync(path)) {
      paths.push(path);
    }
  }

  // Process remaining text, handling backslash-escaped spaces
  const remaining = text.replace(/"[^"]+"|'[^']+'/g, "");
  const ESCAPED_SPACE = "\u0000";
  const processed = remaining.replace(/\\ /g, ESCAPED_SPACE);

  for (const token of processed.split(/\s+/)) {
    const clean = token
      .replace(new RegExp(ESCAPED_SPACE, "g"), " ")
      .replace(/^["']|["',;:!?]$/g, "")
      .replace(/[.,;:!?]$/, "");
    if (clean && isImagePath(clean) && existsSync(clean) && !paths.includes(clean)) {
      paths.push(clean);
    }
  }

  return paths;
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
  const [busy, setBusy] = useState(false);
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
  const [showReasoning, setShowReasoning] = useState(false);
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStartedAt, setTasksStartedAt] = useState<number | null>(null);
  const [tasksStartTokens, setTasksStartTokens] = useState<number>(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnPhase, setTurnPhase] = useState<import("./ui/status.js").TurnPhase>("waiting");
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
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
  const supervisorRef = useRef<TurnSupervisor>(new TurnSupervisor());
  const isAbortingRef = useRef(false);
  const lastEscapeAtRef = useRef(0);
  /** Holds the latest Ctrl+C interrupt logic so the SIGINT handler can delegate to it. */
  const sigintHandlerRef = useRef<(() => void) | null>(null);
  const limitResolveRef = useRef<((d: LimitDecision) => void) | null>(null);
  const loopResolveRef = useRef<((d: LoopDecision) => void) | null>(null);
  const pendingToolCallsRef = useRef<Map<string, string>>(new Map());
  const modeRef = useRef<Mode>(mode);
  const effortRef = useRef<ReasoningEffort>(effort);
  const tasksRef = useRef<Task[]>([]);
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
  const busyRef = useRef(busy);
  const memoryManagerRef = useRef<MemoryManager | null>(null);
  const sessionStartRecallRef = useRef<Promise<import("./memory/schema.js").HybridResult[]> | null>(null);
  const kimiMdStaleNudgedRef = useRef(false);
  const turnCounterRef = useRef(0);

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
    const entries = await fg("**/*", {
      cwd,
      ignore: buildFilePickerIgnoreList(cwd),
      dot: false,
      absolute: false,
      onlyFiles: false,
      markDirectories: true,
    } as fg.Options);
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
      const dbPath = cfg.memoryDbPath ?? join(process.cwd(), ".kimiflare", "memory.db");
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
        const total = result.oldDeleted + result.excessDeleted + result.duplicatesMerged;
        if (total > 0) {
          setEvents((e) => [
            ...e,
            { kind: "memory", key: mkKey(), text: `memory cleanup: removed ${total} stale entries` },
          ]);
        }
      });
      void manager.backfill(process.cwd()).then((fixed) => {
        if (fixed > 0) {
          setEvents((e) => [
            ...e,
            { kind: "memory", key: mkKey(), text: `memory backfill: embedded ${fixed} un-vectorized entries` },
          ]);
        }
      });

      // Fire session-start recall in the background so results are ready by the
      // time the first turn starts. Synthesis and injection happen inside
      // runAgentTurn so they are covered by the turn's abort signal.
      const cwd = process.cwd();
      sessionStartRecallRef.current = manager.recall({ text: cwd, repoPath: cwd, limit: 5 });

      // Session-start drift check (Trigger A): if KIMI.md exists and high-signal
      // memories have been learned since the last refresh, mark as stale.
      if (existsSync(join(cwd, "KIMI.md"))) {
        const lastRefresh = manager.getLastKimiMdRefreshTime(cwd);
        const driftCount = manager.countHighSignalMemoriesSince(cwd, lastRefresh);
        if (driftCount >= 5) {
          setKimiMdStale(true);
        }
      }
    } else {
      memoryManagerRef.current?.close();
      memoryManagerRef.current = null;
    }

    // Initialize skills index (independent of memory feature flag)
    const skillDbPath = cfg.memoryDbPath ?? join(process.cwd(), ".kimiflare", "memory.db");
    const skillDb = getMemoryDb() ?? openMemoryDb(skillDbPath);
    initSkillsSchema(skillDb);
    void indexSkills({
      cwd: process.cwd(),
      db: skillDb,
      accountId: cfg.accountId,
      apiToken: cfg.apiToken,
      gateway: gatewayFromConfig(cfg),
      embeddingModel: cfg.memoryEmbeddingModel,
      cloudMode: cfg.cloudMode,
      cloudToken: cloudToken ?? initialCloudToken,
      cloudDeviceId: cloudDeviceId ?? initialCloudDeviceId,
    }).then((result) => {
      if (result.indexed > 0) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `indexed ${result.indexed} skill${result.indexed === 1 ? "" : "s"}` },
        ]);
      }
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `skill index error: ${err}` }]);
        }
      }
    });

    void loadCustomCommands(process.cwd()).then(({ commands, warnings }) => {
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
    if (!cfg?.mcpServers || mcpInitRef.current) return;
    mcpInitRef.current = true;
    const manager = mcpManagerRef.current;
    let totalTools = 0;
    for (const [name, server] of Object.entries(cfg.mcpServers)) {
      if (server.enabled === false) continue;
      try {
        if (server.type === "local" && server.command && server.command.length > 0) {
          await manager.addLocalServer(name, server.command, server.env, {
            timeoutMs: server.timeoutMs,
          });
        } else if (server.type === "remote" && server.url) {
          await manager.addRemoteServer(name, server.url, server.headers, {
            timeoutMs: server.timeoutMs,
          });
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
            tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
            model: cfg.model ?? DEFAULT_MODEL,
            mode: modeRef.current,
          }),
        };
      } else {
        messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd: process.cwd(),
            tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
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

  const initLsp = useCallback(async () => {
    if (!cfg?.lspEnabled || !cfg?.lspServers || lspInitRef.current) {
      if (lspInitRef.current) return;
      if (!cfg?.lspEnabled) {
        setEvents((es) => [...es, { kind: "info", key: mkKey(), text: "LSP is disabled. Enable it in config to use language servers." }]);
      } else if (!cfg?.lspServers || Object.keys(cfg.lspServers).length === 0) {
        setEvents((es) => [...es, { kind: "info", key: mkKey(), text: "LSP reload complete — no servers configured." }]);
      }
      return;
    }
    lspInitRef.current = true;
    const manager = lspManagerRef.current;
    let totalServers = 0;
    for (const [name, server] of Object.entries(cfg.lspServers)) {
      if (server.enabled === false) continue;
      try {
        await manager.startServer(name, server, process.cwd());
        totalServers++;
      } catch (e) {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `LSP server "${name}" failed: ${(e as Error).message}` },
        ]);
      }
    }
    if (totalServers > 0) {
      const tools = makeLspTools(manager);
      for (const tool of tools) {
        executorRef.current.register(tool);
      }
      lspToolsRef.current = tools;
      if (cacheStableRef.current) {
        messagesRef.current[1] = {
          role: "system",
          content: buildSessionPrefix({
            cwd: process.cwd(),
            tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
            model: cfg.model ?? DEFAULT_MODEL,
            mode: modeRef.current,
          }),
        };
      } else {
        messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd: process.cwd(),
            tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
            model: cfg.model ?? DEFAULT_MODEL,
            mode: modeRef.current,
          }),
        };
      }
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: `LSP ready — ${totalServers} server${totalServers === 1 ? "" : "s"} active` },
      ]);
    } else {
      setEvents((e) => [
        ...e,
        { kind: "info", key: mkKey(), text: "LSP reload complete — no servers started (check config or enabled status)." },
      ]);
    }
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

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      logger.info("input:ctrl+c", {
        busy: busyRef.current,
        hasActiveScope: activeScopeRef.current !== null,
        isAborting: isAbortingRef.current,
        hasPerm: hasPendingPermission(),
        hasLimit: limitResolveRef.current !== null,
      });
      const hadPerm = denyPendingPermission();
      const hadLimit = limitResolveRef.current !== null;
      const hadLoop = loopResolveRef.current !== null;
      if (hadLimit) {
        limitResolveRef.current!("stop");
        limitResolveRef.current = null;
        setLimitModal(null);
      }
      if (hadLoop) {
        loopResolveRef.current!("stop");
        loopResolveRef.current = null;
        setLoopModal(null);
      }
      if (busyRef.current && activeScopeRef.current && !isAbortingRef.current) {
        isAbortingRef.current = true;
        supervisorRef.current.killTurn();
        activeScopeRef.current.abort("user_stopped");
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
        // Mark all in-flight tool events as cancelled
        for (const [toolId] of pendingToolCallsRef.current) {
          updateTool(toolId, { status: "cancelled" });
        }
        pendingToolCallsRef.current.clear();
        // Save session so interrupted turn is not lost
        void saveSessionSafe();
        // Clear task list immediately so it doesn't keep spinning
        setTasks([]);
        setTasksStartedAt(null);
        setTasksStartTokens(0);
        tasksRef.current = [];
      } else if (!hadPerm && !hadLimit && !hadLoop) {
        logger.info("input:ctrl+c:exiting");
        void lspManagerRef.current.stopAll().finally(() => exit());
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
        isAbortingRef.current = true;
        supervisorRef.current.killTurn();
        denyPendingPermission();
        if (limitResolveRef.current) {
          limitResolveRef.current("stop");
          limitResolveRef.current = null;
          setLimitModal(null);
        }
        if (loopResolveRef.current) {
          loopResolveRef.current("stop");
          loopResolveRef.current = null;
          setLoopModal(null);
        }
        activeScopeRef.current.abort("user_stopped");
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
        // Mark all in-flight tool events as cancelled
        for (const [toolId] of pendingToolCallsRef.current) {
          updateTool(toolId, { status: "cancelled" });
        }
        pendingToolCallsRef.current.clear();
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
    const hadPerm = denyPendingPermission();
    const hadLimit = limitResolveRef.current !== null;
    const hadLoop = loopResolveRef.current !== null;
    if (hadLimit) {
      limitResolveRef.current!("stop");
      limitResolveRef.current = null;
      setLimitModal(null);
    }
    if (hadLoop) {
      loopResolveRef.current!("stop");
      loopResolveRef.current = null;
      setLoopModal(null);
    }
    if (busyRef.current && activeScopeRef.current && !isAbortingRef.current) {
      isAbortingRef.current = true;
      supervisorRef.current.killTurn();
      activeScopeRef.current.abort("user_stopped");
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
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
    busyRef.current = true;
    setTurnStartedAt(Date.now());
    const turnScope = sessionScopeRef.current.createChild();
    activeScopeRef.current = turnScope;
    try {
      if (compiledContextRef.current) {
        const store = artifactStoreRef.current;
        const result = compactMessagesViaArtifacts({
          messages: messagesRef.current,
          state: sessionStateRef.current,
          store,
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
        const result = await summarizeMessagesViaLlm({
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: cfg.model,
          messages: messagesRef.current,
          signal: turnScope.signal,
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
      logger.info("runCompact:finally");
      setBusy(false);
      busyRef.current = false;
      setTurnStartedAt(null);
      setTurnPhase("waiting");
      setCurrentToolName(null);
      setLastActivityAt(null);
      activeScopeRef.current = null;
      isAbortingRef.current = false;
      clearPermissionResolveRef();
      limitResolveRef.current = null;
      pendingToolCallsRef.current.clear();
    }
  }, [cfg, busy, saveSessionSafe]);

  const runInit = useCallback(async () => {
    if (!cfg) return;
    if (busy) {
      setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /init while model is running" }]);
      return;
    }
    const cwd = process.cwd();
    const { prompt, targetFilename, isRefresh } = buildInitPrompt(cwd);

    setEvents((e) => [...e, { kind: "user", key: mkKey(), text: isRefresh ? `/init (refreshing ${targetFilename})` : "/init" }]);
    messagesRef.current.push({ role: "user", content: sanitizeString(prompt) });
    setBusy(true);
    busyRef.current = true;
    setTurnStartedAt(Date.now());
    const turnScope = sessionScopeRef.current.createChild();
    activeScopeRef.current = turnScope;

    const initClassification = classifyIntent(prompt);
    const initEffortForTier: Record<string, ReasoningEffort> = {
      light: "low",
      medium: "medium",
      heavy: "high",
    };
    const initReasoningEffort = initEffortForTier[initClassification.tier] ?? effortRef.current;
    const effectiveCodeMode = initClassification.tier === "heavy";
    setCodeMode(effectiveCodeMode);

    try {
      await runAgentTurn({
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        gateway: gatewayFromConfig(cfg),
        messages: messagesRef.current,
        tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
        executor: executorRef.current,
        cwd,
        signal: turnScope.signal,
        reasoningEffort: initReasoningEffort,
        intentClassification: initClassification,
        coauthor:
          cfg.coauthor !== false
            ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
            : undefined,
        sessionId: ensureSessionId(),
        memoryManager: memoryManagerRef.current,
        githubToken: cfg.githubOAuthToken,
        codeMode: effectiveCodeMode,
        cloudMode: cfg.cloudMode,
        cloudToken: cloudToken ?? initialCloudToken,
        cloudDeviceId: cloudDeviceId ?? initialCloudDeviceId,
        shell: cfg.shell,
        onIterationEnd,
        onFileChange: (path, content) => {
          if (content) {
            lspManagerRef.current.notifyChange(path, content);
          } else {
            // For edit tool, read the file and notify with full content
            void import("node:fs/promises").then(({ readFile }) =>
              readFile(path, "utf8")
                .then((c) => lspManagerRef.current.notifyChange(path, c))
                .catch(() => {}),
            );
          }
        },
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
            pendingToolCallsRef.current.set(call.id, call.function.name);
            const spec = executorRef.current.list().find((t) => t.name === call.function.name);
            let renderMeta: ToolRender | undefined;
            let args: Record<string, unknown> = {};
            try {
              args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              renderMeta = spec?.render?.(args);
            } catch {
              /* ignore */
            }
            // Track file paths from read/edit/write/grep tools for recent-files boost
            if (typeof args.path === "string") {
              trackRecentFile(recentFilesRef, args.path, MAX_RECENT_FILES);
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
          onToolWillExecute: (id: string) => {
            setTurnPhase("executing");
            setCurrentToolName(pendingToolCallsRef.current.get(id) ?? null);
            setLastActivityAt(Date.now());
            updateTool(id, { status: "running", startedAt: Date.now() });
          },
          onToolResult: (r) => {
            pendingToolCallsRef.current.delete(r.tool_call_id);
            setLastActivityAt(Date.now());
            if (pendingToolCallsRef.current.size === 0) {
              setTurnPhase("waiting");
              setCurrentToolName(null);
            }
            const isDenied = typeof r.content === "string" && r.content.startsWith("Permission denied");
            updateTool(r.tool_call_id, { status: isDenied ? "rejected" : r.ok ? "done" : "error", result: r.content });
          },
          onWarning: (msg) => {
            setEvents((e) => [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: msg,
              },
            ]);
          },
          onUsage: (u) => {
            usageRef.current = u;
            setUsage(u);
          },
          onUsageFinal: (u, meta) => {
            const sid = ensureSessionId();
            void recordUsage(sid, u, gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current));
            void getCostReport(sid).then((report) => setSessionUsage(report.session));
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
          askPermission: (req) => askForPermission(req, { promptOnBlockedBash: true }),
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
        },
      });

      if (existsSync(join(cwd, "KIMI.md"))) {
        if (cacheStableRef.current) {
          messagesRef.current[1] = {
            role: "system",
            content: buildSessionPrefix({
              cwd,
              tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
              model: cfg.model,
              mode: modeRef.current,
            }),
          };
        } else {
          messagesRef.current[0] = {
            role: "system",
            content: buildSystemPrompt({
              cwd,
              tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
              model: cfg.model,
              mode: modeRef.current,
            }),
          };
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "KIMI.md generated; context loaded for future turns" },
        ]);
        // Record refresh so drift detection knows this snapshot is current
        void memoryManagerRef.current?.recordKimiMdRefresh(cwd, ensureSessionId());
        setKimiMdStale(false);
        kimiMdStaleNudgedRef.current = false;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
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
      } else if (e instanceof AgentLoopError) {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: "The agent got stuck repeating the same actions. Here's what we know so far." },
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
            : `init failed: ${(e as Error).message}`;
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: displayText },
        ]);
      }
    } finally {
      logger.info("runInit:finally");
      setCodeMode(false);
      const asstId = activeAsstIdRef.current;
      if (asstId !== null) updateAssistant(asstId, () => ({ streaming: false }));
      setBusy(false);
      busyRef.current = false;
      setTurnStartedAt(null);
      setTurnPhase("waiting");
      setCurrentToolName(null);
      setLastActivityAt(null);
      activeAsstIdRef.current = null;
      activeScopeRef.current = null;
      isAbortingRef.current = false;
      clearPermissionResolveRef();
      limitResolveRef.current = null;
      loopResolveRef.current = null;
      setLoopModal(null);
      pendingToolCallsRef.current.clear();
    }
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

  const handleSlash = useCallback(
    (cmd: string): boolean => {
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
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "can't /clear while model is running — press Esc to interrupt first" }]);
          return true;
        }
        if (cacheStableRef.current && messagesRef.current.length >= 2) {
          messagesRef.current = [messagesRef.current[0]!, messagesRef.current[1]!];
        } else {
          messagesRef.current = [messagesRef.current[0]!];
        }
        resetSession();
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
            { kind: "info", key: mkKey(), text: `reasoning: ${next ? "shown" : "hidden"}` },
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
                const { reconcileWithCloudflare } = await import("./cost-attribution/reconcile.js");
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
              const { getCategoryReportText } = await import("./cost-attribution/tui-report.js");
              const catReport = await getCategoryReportText(sessionIdRef.current ?? undefined);
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
              { kind: "error", key: mkKey(), text: `cost report failed: ${(err as Error).message}` },
            ]);
          });
        return true;
      }
      if (c === "/shell") {
        if (!cfg) return true;
        const valid = ["auto", "bash", "cmd", "powershell"];
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
        if (cfg.cloudMode) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "AI Gateway is managed by Kimiflare Cloud" }]);
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
            // Tack on the live cache-hit ratio for the current session — derived
            // from the cf-aig-cache-status headers we've collected so far.
            const sid = sessionIdRef.current;
            if (sid) {
              void getCostReport(sid).then((report) => {
                const req = report.session.gatewayRequests ?? 0;
                if (req === 0) return;
                const cached = report.session.gatewayCachedRequests ?? 0;
                const pct = ((cached / req) * 100).toFixed(1);
                setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: mkKey(),
                    text: `cache hits (session): ${cached}/${req} (${pct}%)`,
                  },
                ]);
              }).catch(() => {});
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
      if (c === "/theme") {
        if (!arg) {
          setShowThemePicker(true);
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
        setCfg((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, theme: next.name };
          void saveConfig(updated).catch(() => {});
          return updated;
        });
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `theme: ${next.label} — restart to apply` },
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
      if (c === "/skills") {
        const sub = rest[0]?.toLowerCase() ?? "";
        const subRest = rest.slice(1).join(" ").trim();

        if (sub === "list" || sub === "") {
          void listAllSkills(process.cwd()).then((all) => {
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
          }).catch((err) => {
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
          void createSkill({ name, scope: "project", cwd: process.cwd() }).then((result) => {
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `created skill '${name}' → ${result.filepath}` },
              { kind: "info", key: mkKey(), text: `edit the file to add your instructions` },
            ]);
          }).catch((err) => {
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
          void findSkillFile(name, process.cwd()).then((filepath) => {
            if (!filepath) {
              setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `skill '${name}' not found` }]);
              return;
            }
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `skill '${name}' → ${filepath}` },
              { kind: "info", key: mkKey(), text: `open it in your editor to make changes` },
            ]);
          }).catch((err) => {
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
          void deleteSkill(name, process.cwd()).then((result) => {
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `deleted skill '${name}' (${result.filepath})` }]);
          }).catch((err) => {
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
          void setSkillEnabled(name, true, process.cwd()).then((result) => {
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `enabled skill '${name}' (${result.filepath})` }]);
          }).catch((err) => {
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
          void setSkillEnabled(name, false, process.cwd()).then((result) => {
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `disabled skill '${name}' (${result.filepath})` }]);
          }).catch((err) => {
            setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `failed to disable skill: ${(err as Error).message}` }]);
          });
          return true;
        }

        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "usage: /skills list | add <name> | edit <name> | delete <name> | enable <name> | disable <name>" },
        ]);
        return true;
      }
      if (c === "/memory") {
        if (!cfg) return true;
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
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "memory is disabled. Use /memory on to enable it, or set KIMIFLARE_MEMORY_ENABLED=1" }]);
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
      }
      if (c === "/resume") {
        void openResumePicker();
        return true;
      }
      if (c === "/checkpoint") {
        const label = rest.join(" ").trim() || `checkpoint ${new Date().toLocaleString()}`;
        const turnIndex = messagesRef.current.length;
        if (turnIndex === 0) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "nothing to checkpoint yet" }]);
          return true;
        }
        const cp: Checkpoint = {
          id: `cp_${Date.now()}`,
          label,
          turnIndex,
          timestamp: new Date().toISOString(),
          sessionState: compiledContextRef.current ? sessionStateRef.current : undefined,
          artifactStore: serializeArtifactStore(artifactStoreRef.current),
        };
        void (async () => {
          try {
            ensureSessionId();
            const { sessionsDir } = await import("./sessions.js");
            const filePath = join(sessionsDir(), `${sessionIdRef.current}.json`);
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
      }
      if (c === "/checkpoints") {
        const currentId = sessionIdRef.current;
        if (!currentId) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no active session" }]);
          return true;
        }
        void (async () => {
          try {
            const { sessionsDir } = await import("./sessions.js");
            const file = await loadSession(join(sessionsDir(), `${currentId}.json`));
            const cps = file.checkpoints ?? [];
            if (cps.length === 0) {
              setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "no checkpoints in this session" }]);
              return;
            }
            const lines = ["checkpoints:", ...cps.map((cp, i) => `  ${i + 1}. "${cp.label}" — turn ${cp.turnIndex} · ${new Date(cp.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`)];
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
      if (c === "/lsp") {
        if (arg === "list") {
          const servers = lspManagerRef.current.listActive();
          const scopeLine = lspScope === "project" && lspProjectPath
            ? ` (project: ${lspProjectPath})`
            : " (global config)";
          if (servers.length === 0) {
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `no LSP servers active${scopeLine}` },
            ]);
          } else {
            const lines = servers.map((s) => `  ${s.id} (${s.rootUri}) — ${s.state}, ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`);
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
          for (const tool of lspToolsRef.current) {
            executorRef.current.unregister(tool.name);
          }
          lspToolsRef.current = [];
          lspInitRef.current = false;
          void initLsp().catch((e) => {
            setEvents((es) => [...es, { kind: "error", key: mkKey(), text: `LSP reload failed: ${(e as Error).message}` }]);
          });
          return true;
        }
        if (arg === "scope") {
          const scopeText = lspScope === "project" && lspProjectPath
            ? `project scope: ${lspProjectPath}`
            : "global scope: ~/.config/kimiflare/config.json";
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: scopeText },
          ]);
          return true;
        }
        if (arg === "config" || arg === "") {
          setShowLspWizard(true);
          return true;
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "usage: /lsp list | reload | scope | config" },
        ]);
        return true;
      }
      if (c === "/hello") {
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
              { kind: "info", key: mkKey(), text: "Opened voice note page in your browser. Record your message there and hit Send when you're done." },
            ]);
          }
        })();
        return true;
      }
      if (c === "/inbox") {
        setShowInboxModal(true);
        return true;
      }
      if (c === "/report") {
        const err = lastApiErrorRef.current;
        if (!err) {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "No recent API error to report." },
          ]);
          return true;
        }
        const note = rest.join(" ").trim();
        const isSend = note.toLowerCase() === "send" || note.toLowerCase().startsWith("send ");
        if (!isSend) {
          const preview = [
            "Report preview:",
            `  Error: ${err.message}`,
            err.httpStatus !== undefined ? `  HTTP ${err.httpStatus}` : "",
            err.code !== undefined ? `  Code: ${err.code}` : "",
            note ? `  Note: ${note}` : "",
            "",
            "Type `/report send` to submit or `/report send <note>` to add context.",
          ].filter(Boolean).join("\n");
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: preview }]);
          return true;
        }
        const userNote = note.slice(4).trim() || undefined;
        const payload = buildReport({
          errorMessage: err.message,
          httpStatus: err.httpStatus,
          errorCode: err.code,
          sessionId: sessionIdRef.current ?? undefined,
          userNote,
          model: cfg?.model,
          cloudMode: cfg?.cloudMode,
        });
        void sendReport(payload, cfg?.cloudToken).then((result) => {
          setEvents((e) => [
            ...e,
            { kind: result.ok ? "info" : "error", key: mkKey(), text: result.message },
          ]);
          if (result.ok) {
            lastApiErrorRef.current = null;
          }
        });
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "Sending report…" },
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
      if (c === "/command") {
        const sub = rest[0]?.toLowerCase() ?? "";
        if (sub === "create") {
          setCommandWizard({ mode: "create" });
          return true;
        }
        if (sub === "edit") {
          setCommandPicker({ mode: "edit" });
          return true;
        }
        if (sub === "delete") {
          setCommandPicker({ mode: "delete" });
          return true;
        }
        if (sub === "list") {
          setShowCommandList(true);
          return true;
        }
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "usage: /command create | edit | delete | list" },
        ]);
        return true;
      }
      if (c === "/remote") {
        if (arg === "status" || arg === "cancel") {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `Use \`kimiflare remote ${arg}\` from your shell.` },
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
            { kind: "info", key: mkKey(), text: "Could not detect GitHub repo. Run from a repo with a GitHub remote, or set githubRepo in config." },
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

            const { loadConfig: reloadConfig } = await import("./config.js");
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

            const { loadConfig: reloadConfig } = await import("./config.js");
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
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `Session started: ${data.sessionId}` },
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
                  { kind: "info", key: mkKey(), text: String(event.text ?? "") },
                ]);
              } else if (event.type === "tool_call") {
                setEvents((e) => [
                  ...e,
                  { kind: "info", key: mkKey(), text: `→ ${String(event.name ?? "")}` },
                ]);
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
                setEvents((e) => [
                  ...e,
                  { kind: "error", key: mkKey(), text: `Remote error: ${message}` },
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
              { kind: "error", key: mkKey(), text: `Failed: ${err instanceof Error ? err.message : String(err)}` },
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
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: lines.join("\n") }]);
        return true;
      }
      return false;
    },
    [cfg, exit, usage, theme, mode, openResumePicker, runCompact, runInit, initMcp, setCfg, setShowRemoteDashboard, setSelectedRemoteSession],
  );

  const handleCommandSave = useCallback(
    async (opts: SaveCustomCommandOptions) => {
      setCommandWizard(null);
      try {
        // If editing and name changed, delete the old file first
        if (commandWizard?.mode === "edit" && commandWizard.initial && commandWizard.initial.name !== opts.name) {
          await deleteCustomCommand(commandWizard.initial);
        }
        const result = await saveCustomCommand(opts);
        await reloadCustomCommands();
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `saved /${opts.name} → ${result.filepath}` },
        ]);
      } catch (err) {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: `failed to save /${opts.name}: ${(err as Error).message}` },
        ]);
      }
    },
    [commandWizard, reloadCustomCommands, setEvents],
  );

  const handleCommandDelete = useCallback(
    async (cmd: CustomCommand) => {
      setCommandToDelete(null);
      try {
        await deleteCustomCommand(cmd);
        await reloadCustomCommands();
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `deleted /${cmd.name} (${cmd.filepath})` },
        ]);
      } catch (err) {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: `failed to delete /${cmd.name}: ${(err as Error).message}` },
        ]);
      }
    },
    [reloadCustomCommands, setEvents, setCommandToDelete],
  );

  const handleLspSave = useCallback(
    (
      servers: NonNullable<Cfg["lspServers"]>,
      enabled: boolean,
      scope: "project" | "global",
    ) => {
      setCfg((c) => (c ? { ...c, lspEnabled: enabled, lspServers: servers } : c));
      setLspScope(scope);
      if (scope === "project") {
        void saveProjectLspConfig(process.cwd(), { lspEnabled: enabled, lspServers: servers })
          .then((path) => {
            setLspProjectPath(path);
            setEvents((e) => [
              ...e,
              { kind: "info", key: mkKey(), text: `LSP config saved to project (${path}). Run /lsp reload to apply.` },
            ]);
          })
          .catch(() => {
            setEvents((e) => [
              ...e,
              { kind: "error", key: mkKey(), text: "Failed to save project LSP config." },
            ]);
          });
      } else if (cfg) {
        void saveConfig({ ...cfg, lspEnabled: enabled, lspServers: servers }).catch(() => {});
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `LSP config saved to global config. Run /lsp reload to apply.` },
        ]);
      }
      setShowLspWizard(false);
    },
    [cfg, setCfg, setEvents, setShowLspWizard],
  );

  const handleRemoteCancel = useCallback(
    async (session: RemoteSession) => {
      try {
        const { cancelRemoteSession } = await import("./remote/worker-client.js");
        await cancelRemoteSession(session.workerUrl, session.sessionId);
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `Cancelled session ${session.sessionId}` },
        ]);
      } catch (err) {
        setEvents((e) => [
          ...e,
          { kind: "error", key: mkKey(), text: `Failed to cancel: ${err instanceof Error ? err.message : String(err)}` },
        ]);
      }
      setSelectedRemoteSession(null);
      setShowRemoteDashboard(false);
    },
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

      setBusy(true);
      busyRef.current = true;
      gatewayMetaRef.current = null;
      setGatewayMeta(null);
      setTurnStartedAt(Date.now());

      const classification = classifyIntent(trimmed);
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
          const id = nextAssistantId++;
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
        setBusy(false);
        busyRef.current = false;
        setTurnStartedAt(null);
        setTurnPhase("waiting");
        setCurrentToolName(null);
        setLastActivityAt(null);
        activeAsstIdRef.current = null;
        activeScopeRef.current = null;
        isAbortingRef.current = false;
        clearPermissionResolveRef();
        limitResolveRef.current = null;
        loopResolveRef.current = null;
        setLoopModal(null);
        pendingToolCallsRef.current.clear();

        // Clear task list so it doesn't linger into the next turn
        setTasks([]);
        setTasksStartedAt(null);
        setTasksStartTokens(0);
        tasksRef.current = [];

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
