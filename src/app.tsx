import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import SelectInput from "ink-select-input";

import { runAgentTurn } from "./agent/loop.js";
import type { AiGatewayOptions, GatewayMeta } from "./agent/client.js";
import { buildSystemPrompt, buildSystemMessages, buildSessionPrefix } from "./agent/system-prompt.js";
import { AgentOrchestrator } from "./agent/orchestrator.js";
import type { AgentRole } from "./agent/agent-session.js";
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
import { ToolExecutor, ALL_TOOLS, type PermissionDecision } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import { McpManager } from "./mcp/manager.js";
import { LspManager } from "./lsp/manager.js";
import { makeLspTools } from "./tools/lsp.js";
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
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ToolRender } from "./tools/registry.js";
import { CustomTextInput } from "./ui/text-input.js";
import { checkForUpdate } from "./util/update-check.js";
import type { UpdateCheckResult } from "./util/update-check.js";
import { Onboarding } from "./ui/onboarding.js";
import { Welcome } from "./ui/welcome.js";
import { HelpMenu } from "./ui/help-menu.js";
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
import { shouldShowCreatorMessage, markCreatorMessageSeen } from "./util/state.js";
import { getAppVersion } from "./util/version.js";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { loadCustomCommands } from "./commands/loader.js";
import { renderCommand } from "./commands/renderer.js";
import type { CustomCommand } from "./commands/types.js";
import { saveCustomCommand, deleteCustomCommand } from "./commands/save.js";
import type { SaveCustomCommandOptions } from "./commands/save.js";
import { CommandWizard } from "./ui/command-wizard.js";
import { CommandPicker } from "./ui/command-picker.js";
import { CommandList } from "./ui/command-list.js";
import { LspWizard } from "./ui/lsp-wizard.js";
import { saveProjectLspConfig, type ResolvedLspConfig } from "./util/lsp-config.js";
import { maybeLspNudge } from "./util/lsp-nudge.js";
import fg from "fast-glob";
import { FilePicker, type FilePickerItem } from "./ui/file-picker.js";
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

export function filterPickerItems(items: FilePickerItem[], query: string): FilePickerItem[] {
  const q = query.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 50);
}

export function shouldOpenMentionPicker(
  input: string,
  cursorOffset: number,
  pickerCancelOffset: number | null,
): boolean {
  if (pickerCancelOffset === cursorOffset) return false;
  if (cursorOffset > 0 && input[cursorOffset - 1] === "@") {
    const beforeAt = cursorOffset - 2;
    return beforeAt < 0 || /\s/.test(input[beforeAt]!);
  }
  return false;
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
  plumbingModel?: string;
  codeMode?: boolean;
  lspEnabled?: boolean;
  lspServers?: Record<string, { command: string[]; env?: Record<string, string>; enabled?: boolean; rootPatterns?: string[] }>;
  costAttribution?: boolean;
  filePicker?: boolean;
  multiAgent?: boolean;
  agentModels?: Record<string, string>;
  agentReasoningEffort?: Record<string, ReasoningEffort>;
  orchestratorModel?: string;
  autoSwitch?: boolean;
  autoSwitchConfirm?: boolean;
  maxTurnsPerAgent?: number;
  customAgents?: { name: string; tools: string[]; model?: string; systemPrompt?: string; reasoningEffort?: ReasoningEffort }[];
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

const FEEDBACK_WORKER_URL = "https://kimiflare-feedback.sina-b35.workers.dev";

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
  child.unref();
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
  role?: AgentRole,
): ChatMessage[] {
  if (cacheStable) {
    return buildSystemMessages({ cwd: process.cwd(), tools, model, mode, role });
  }
  return [
    {
      role: "system",
      content: buildSystemPrompt({ cwd: process.cwd(), tools, model, mode, role }),
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

const BUILTIN_COMMAND_NAMES = new Set([
  "exit", "quit", "clear", "reasoning", "cost", "model", "thinking", "effort",
  "theme", "mode", "plan", "auto", "edit", "resume", "compact", "init",
  "update", "mcp", "logout", "help", "memory", "gateway", "hello", "community",
  "agent",
]);

const EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  low: "low — fastest; lightest reasoning. Best for simple Q&A, small edits, quick coordination.",
  medium: "medium — balanced (default). Solid quality on most edits, fast on trivial prompts.",
  high: "high — deepest reasoning; slowest. Best for complex debugging, architecture, multi-file refactors.",
};

function App({
  initialCfg,
  initialUpdateResult,
  initialLspScope,
  initialLspProjectPath,
}: {
  initialCfg: Cfg | null;
  initialUpdateResult?: UpdateCheckResult;
  initialLspScope: "project" | "global";
  initialLspProjectPath: string | null;
}) {
  const { exit } = useApp();
  const [cfg, setCfg] = useState<Cfg | null>(initialCfg);
  const [lspScope, setLspScope] = useState<"project" | "global">(initialLspScope);
  const [lspProjectPath, setLspProjectPath] = useState<string | null>(initialLspProjectPath);
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
  const filePickerEnabled = initialCfg?.filePicker ?? false;
  const [effort, setEffort] = useState<ReasoningEffort>(
    initialCfg?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  const [theme, setTheme] = useState<Theme>(resolveTheme(initialCfg?.theme));
  const [resumeSessions, setResumeSessions] = useState<SessionSummary[] | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [originalTheme, setOriginalTheme] = useState<Theme | null>(null);
  const [commandWizard, setCommandWizard] = useState<{ mode: "create" | "edit"; initial?: CustomCommand } | null>(null);
  const [commandPicker, setCommandPicker] = useState<{ mode: "edit" | "delete" } | null>(null);
  const [commandToDelete, setCommandToDelete] = useState<CustomCommand | null>(null);
  const [showCommandList, setShowCommandList] = useState(false);
  const [showLspWizard, setShowLspWizard] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStartedAt, setTasksStartedAt] = useState<number | null>(null);
  const [tasksStartTokens, setTasksStartTokens] = useState<number>(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(initialUpdateResult?.hasUpdate ?? false);
  const [latestVersion, setLatestVersion] = useState<string | null>(initialUpdateResult?.latestVersion ?? null);

  // File mention picker state
  const [cursorOffset, setCursorOffset] = useState(0);
  const [pickerItems, setPickerItems] = useState<FilePickerItem[]>([]);
  const [pickerSelected, setPickerSelected] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<number | null>(null);

  const cacheStableRef = useRef(initialCfg?.cacheStablePrompts !== false);
  const messagesRef = useRef<ChatMessage[]>(
    makePrefixMessages(cacheStableRef.current, cfg?.model ?? DEFAULT_MODEL, "edit", ALL_TOOLS),
  );
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const permResolveRef = useRef<((d: PermissionDecision) => void) | null>(null);
  const pendingToolCallsRef = useRef<Map<string, string>>(new Map());
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
  const lspManagerRef = useRef(new LspManager());
  const lspToolsRef = useRef<ToolSpec[]>([]);
  const lspInitRef = useRef(false);
  const memoryManagerRef = useRef<MemoryManager | null>(null);
  const sessionStartRecallRef = useRef<Promise<void> | null>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const pendingOrchestratorStateRef = useRef<Parameters<AgentOrchestrator["deserialize"]>[0] | null>(null);

  // Batched streaming delta refs to reduce React re-render frequency
  const pendingTextRef = useRef<Map<number, { text: string; reasoning: string }>>(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customCommandsRef = useRef<CustomCommand[]>([]);
  const pickerCancelRef = useRef<number | null>(null);

  // ── File mention picker logic ────────────────────────────────────────────
  const mentionState = React.useMemo(() => {
    if (pickerAnchor === null) return null;
    const query = input.slice(pickerAnchor + 1, cursorOffset);
    return { query, anchor: pickerAnchor };
  }, [input, cursorOffset, pickerAnchor]);

  const filteredPickerItems = React.useMemo(() => {
    if (!mentionState) return [];
    return filterPickerItems(pickerItems, mentionState.query);
  }, [pickerItems, mentionState]);

  // Detect @ mention opening/closing
  useEffect(() => {
    if (pickerAnchor !== null) {
      // If cursor moved before anchor, close picker
      if (cursorOffset < pickerAnchor) {
        setPickerAnchor(null);
        return;
      }
      // If the @ was deleted, close picker
      if (input[pickerAnchor] !== "@") {
        setPickerAnchor(null);
        return;
      }
      // If user typed a space inside the mention query, close picker
      const query = input.slice(pickerAnchor + 1, cursorOffset);
      if (query.includes(" ")) {
        setPickerAnchor(null);
        return;
      }
      return;
    }

    // Prevent immediate reopen after cancel at the same cursor position
    if (pickerCancelRef.current === cursorOffset) {
      pickerCancelRef.current = null;
      return;
    }

    // Look for @ just before cursor (only when feature flag is enabled)
    if (filePickerEnabled && shouldOpenMentionPicker(input, cursorOffset, pickerCancelRef.current)) {
      setPickerAnchor(cursorOffset - 1);
      setPickerSelected(0);
      // Load files lazily on first open
      if (pickerItems.length === 0) {
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
            // Sort directories first, then alphabetically
            items.sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1;
              if (!a.isDirectory && b.isDirectory) return 1;
              return a.name.localeCompare(b.name);
            });
            setPickerItems(items);
          })
          .catch(() => {
            setPickerItems([]);
          });
      }
    }
  }, [input, cursorOffset, pickerAnchor, pickerItems.length, filePickerEnabled]);

  // Clamp selected index when filtered list changes
  useEffect(() => {
    if (pickerAnchor !== null) {
      setPickerSelected((prev) => Math.min(prev, Math.max(0, filteredPickerItems.length - 1)));
    }
  }, [filteredPickerItems.length, pickerAnchor]);

  const handlePickerUp = useCallback(() => {
    setPickerSelected((i) => Math.max(0, i - 1));
  }, []);

  const handlePickerDown = useCallback(() => {
    setPickerSelected((i) => Math.min(filteredPickerItems.length - 1, i + 1));
  }, [filteredPickerItems.length]);

  const handlePickerSelect = useCallback(() => {
    if (!mentionState || filteredPickerItems.length === 0) return;
    const item = filteredPickerItems[pickerSelected];
    if (!item) return;
    const insert = item.name + (item.isDirectory ? "/" : " ");
    const newInput = input.slice(0, mentionState.anchor) + insert + input.slice(cursorOffset);
    setInput(newInput);
    setCursorOffset(mentionState.anchor + insert.length);
    setPickerAnchor(null);
  }, [mentionState, filteredPickerItems, pickerSelected, input, cursorOffset]);

  const handlePickerCancel = useCallback(() => {
    pickerCancelRef.current = cursorOffset;
    setPickerAnchor(null);
  }, [cursorOffset]);

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

      // Fire session-start recall so the model walks in with context.
      // The promise is awaited in submit() before the first user message.
      const cwd = process.cwd();
      sessionStartRecallRef.current = (async () => {
        try {
          const results = await manager.recall({ text: cwd, repoPath: cwd, limit: 5 });
          if (results.length > 0) {
            const text = await manager.synthesizeRecalled(results);
            // Insert after existing system messages, before any user messages
            const lastSystemIdx = messagesRef.current.findLastIndex((m) => m.role === "system");
            const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : messagesRef.current.length;
            messagesRef.current.splice(insertIdx, 0, { role: "system", content: text });
            setEvents((e) => [
              ...e,
              { kind: "memory", key: mkKey(), text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} about this repo` },
            ]);
          }
        } catch {
          // Non-fatal: session works fine without recalled memories
        }
      })();
    } else {
      memoryManagerRef.current?.close();
      memoryManagerRef.current = null;
    }

    void loadCustomCommands(process.cwd()).then(({ commands, warnings }) => {
      customCommandsRef.current = commands;
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
        artifactStore: cfg.multiAgent ? undefined : serializeArtifactStore(artifactStoreRef.current),
        multiAgentState: cfg.multiAgent ? orchestratorRef.current?.serialize() : undefined,
      });
    } catch {
      /* non-fatal */
    }
  }, [cfg, ensureSessionId]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      const hadPerm = permResolveRef.current !== null;
      if (hadPerm) {
        permResolveRef.current!("deny");
        permResolveRef.current = null;
        setPerm(null);
      }
      if (busy && activeControllerRef.current) {
        activeControllerRef.current.abort();
        setQueue([]);
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
      } else if (!hadPerm) {
        void lspManagerRef.current.stopAll().finally(() => exit());
      }
      return;
    }
    if (key.escape) {
      const modalOpen =
        perm !== null ||
        showHelpMenu ||
        showThemePicker ||
        showLspWizard ||
        showCommandList ||
        commandWizard !== null ||
        commandToDelete !== null ||
        resumeSessions !== null;
      if (!modalOpen && busy && activeControllerRef.current) {
        if (permResolveRef.current) {
          permResolveRef.current("deny");
          permResolveRef.current = null;
          setPerm(null);
        }
        activeControllerRef.current.abort();
        setQueue([]);
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
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
        const store = cfg?.multiAgent
          ? orchestratorRef.current?.getActiveArtifactStore() ?? artifactStoreRef.current
          : artifactStoreRef.current;
        const result = compactCompiled({
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
      permResolveRef.current = null;
      pendingToolCallsRef.current.clear();
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
        tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
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
            const role = orchestratorRef.current?.getActiveRole();
            setEvents((e) => [
              ...e,
              { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true, agentRole: role },
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
            pendingToolCallsRef.current.delete(r.tool_call_id);
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
                if (req.tool.name === "bash") {
                  // Non-whitelisted bash in plan mode: ask for temporary permission
                  permResolveRef.current = resolve;
                  setPerm({ tool: req.tool, args: req.args, resolve });
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
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        for (const [tcId, tcName] of pendingToolCallsRef.current) {
          messagesRef.current.push({
            role: "tool",
            tool_call_id: tcId,
            content: "(interrupted)",
            name: tcName,
          });
        }
        setEvents((evts) =>
          evts.map((e) => (e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const, result: "(interrupted)" } : e)),
        );
      } else {
        setEvents((es) => [
          ...es,
          { kind: "error", key: mkKey(), text: `init failed: ${(e as Error).message}` },
        ]);
      }
    } finally {
      const asstId = activeAsstIdRef.current;
      if (asstId !== null) updateAssistant(asstId, () => ({ streaming: false }));
      setBusy(false);
      setTurnStartedAt(null);
      activeAsstIdRef.current = null;
      activeControllerRef.current = null;
      permResolveRef.current = null;
      pendingToolCallsRef.current.clear();
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
        }
        if (file.artifactStore) {
          artifactStoreRef.current = deserializeArtifactStore(file.artifactStore);
        } else {
          artifactStoreRef.current = new ArtifactStore();
        }
        if (cfg?.multiAgent) {
          // Stash state so processMessage can hydrate the orchestrator with
          // proper callbacks (sharedCallbacks) instead of the no-op callbacks
          // we would have to use here during resume.
          if (file.multiAgentState) {
            pendingOrchestratorStateRef.current = file.multiAgentState;
          } else {
            // Migrate legacy session: seed the default agent with global history
            pendingOrchestratorStateRef.current = {
              activeRole: "generalist",
              agents: [{ role: "generalist", messages: file.messages, recentToolCalls: [] }],
            };
          }
        }

        // Recall memories for resumed session so the model has context
        const manager = memoryManagerRef.current;
        if (manager) {
          try {
            const cwd = process.cwd();
            const results = await manager.recall({ text: cwd, repoPath: cwd, limit: 5 });
            if (results.length > 0) {
              const text = await manager.synthesizeRecalled(results);
              const lastSystemIdx = messagesRef.current.findLastIndex((m) => m.role === "system");
              const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : messagesRef.current.length;
              messagesRef.current.splice(insertIdx, 0, { role: "system", content: text });
            }
          } catch {
            // Non-fatal
          }
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
        void lspManagerRef.current.stopAll().finally(() => exit());
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
        orchestratorRef.current = null;
        pendingOrchestratorStateRef.current = null;
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
      if (c === "/agent") {
        const sub = rest[0]?.toLowerCase() ?? "";
        if (sub === "on") {
          if (!cfg) return true;
          const next = { ...cfg, multiAgent: true, autoSwitch: true };
          setCfg(next);
          void saveConfig(next).catch(() => {});
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "multi-agent enabled. Restart session to activate orchestrator." }]);
          return true;
        }
        if (sub === "off") {
          if (!cfg) return true;
          const next = { ...cfg, multiAgent: false };
          setCfg(next);
          void saveConfig(next).catch(() => {});
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "multi-agent disabled." }]);
          return true;
        }
        if (!cfg?.multiAgent) {
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "multi-agent is disabled. Run /agent on to enable it." }]);
          return true;
        }
        if (!sub || sub === "status") {
          const role = orchestratorRef.current?.getActiveRole() ?? "generalist";
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `active agent: ${role}` }]);
          return true;
        }
        const customNames = cfg?.customAgents?.map((a) => a.name) ?? [];
        // Manual switching is reserved for custom agents only; built-in agents auto-switch
        if (customNames.includes(sub)) {
          const role = sub as AgentRole;
          const fromRole = orchestratorRef.current?.getActiveRole();
          if (fromRole === role) {
            setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `already on ${role} agent` }]);
            return true;
          }
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `switching to ${role} agent...` }]);
          void (async () => {
            try {
              const summary = await orchestratorRef.current?.handOff(role);
              if (summary) {
                setEvents((es) => [...es, { kind: "info", key: mkKey(), text: `hand-off summary: ${summary.slice(0, 200)}${summary.length > 200 ? "..." : ""}` }]);
              } else {
                setEvents((es) => [...es, { kind: "info", key: mkKey(), text: `switched to ${role} agent` }]);
              }
            } catch (err) {
              setEvents((es) => [...es, { kind: "error", key: mkKey(), text: `hand-off failed: ${(err as Error).message}` }]);
            }
          })();
          return true;
        }
        if (sub === "replay" && rest[1]) {
          const replayRole = rest[1].toLowerCase();
          const allRoles = ["research", "coding", "generalist", ...customNames];
          if (!allRoles.includes(replayRole)) {
            setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `unknown agent: ${replayRole}` }]);
            return true;
          }
          setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `replaying ${replayRole} agent turns...` }]);
          void (async () => {
            try {
              const count = await orchestratorRef.current?.replayAgent(replayRole);
              setEvents((es) => [...es, { kind: "info", key: mkKey(), text: `replayed ${count} turn(s) for ${replayRole} agent` }]);
            } catch (err) {
              setEvents((es) => [...es, { kind: "error", key: mkKey(), text: `replay failed: ${(err as Error).message}` }]);
            }
          })();
          return true;
        }
        if (sub === "diff" && rest[1] && rest[2]) {
          const roleA = rest[1].toLowerCase();
          const roleB = rest[2].toLowerCase();
          const allRoles = ["research", "coding", "generalist", ...customNames];
          if (!allRoles.includes(roleA) || !allRoles.includes(roleB)) {
            setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `unknown agent in diff command` }]);
            return true;
          }
          const msgA = orchestratorRef.current?.getLastAssistantMessage(roleA);
          const msgB = orchestratorRef.current?.getLastAssistantMessage(roleB);
          if (!msgA || !msgB) {
            setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `one or both agents have no assistant messages to compare` }]);
            return true;
          }
          void (async () => {
            try {
              const { createTwoFilesPatch } = await import("diff");
              const patch = createTwoFilesPatch(roleA, roleB, msgA, msgB, "", "", { context: 2 });
              const lines = patch.split("\n").slice(4).filter((l) => !l.startsWith("\\ No newline"));
              setEvents((e) => [
                ...e,
                { kind: "info", key: mkKey(), text: `diff: ${roleA} vs ${roleB}` },
                ...lines.map((line) => ({ kind: "info" as const, key: mkKey(), text: line })),
              ]);
            } catch (err) {
              setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `diff failed: ${(err as Error).message}` }]);
            }
          })();
          return true;
        }
        const custom = customNames.length > 0 ? ` | ${customNames.join(" | ")}` : "";
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: `usage: /agent on | off | status${custom} | replay <role> | diff <role1> <role2>` }]);
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
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "Opened voice note page in your browser. Record your message there and hit Send when you're done." },
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
      if (c === "/help") {
        setShowHelpMenu(true);
        return true;
      }
      return false;
    },
    [cfg, exit, usage, effort, theme, mode, openResumePicker, runCompact, runInit, initMcp, setCfg],
  );

  const handleHelpCommand = useCallback(
    (command: string) => {
      setShowHelpMenu(false);
      const executed = handleSlash(command);
      if (!executed) {
        setEvents((e) => [...e, { kind: "error", key: mkKey(), text: `unknown command: ${command}` }]);
      }
    },
    [handleSlash],
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
    [reloadCustomCommands, setEvents],
  );

  const processMessage = useCallback(
    async (text: string, displayText?: string) => {
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

      // Ensure session-start memory recall has settled before the first turn
      if (sessionStartRecallRef.current) {
        await sessionStartRecallRef.current;
        sessionStartRecallRef.current = null;
      }

      setEvents((e) => [...e, { kind: "user", key: mkKey(), text: display, images: images.length > 0 ? images : undefined }]);

      // LSP nudge: if user references code files and LSP is not configured
      const nudge = maybeLspNudge(display, cfg?.lspEnabled ?? false, cfg?.lspServers ?? {});
      if (nudge) {
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: nudge }]);
      }

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

      const sharedCallbacks = {
        onAssistantStart: () => {
          const id = nextAssistantId++;
          activeAsstIdRef.current = id;
          const role = orchestratorRef.current?.getActiveRole();
          setEvents((e) => [
            ...e,
            { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true, agentRole: role },
          ]);
        },
        onReasoningDelta: (d: string) => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
        },
        onTextDelta: (d: string) => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, (e) => ({ text: e.text + d }));
        },
        onAssistantFinal: () => {
          const id = activeAsstIdRef.current;
          if (id !== null) updateAssistant(id, () => ({ streaming: false }));
        },
        onToolCallFinalized: (call: import("./agent/messages.js").ToolCall) => {
          pendingToolCallsRef.current.set(call.id, call.function.name);
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
        onToolResult: (r: import("./tools/executor.js").ToolResult) => {
          pendingToolCallsRef.current.delete(r.tool_call_id);
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
          const role = cfg.multiAgent ? orchestratorRef.current?.getActiveRole() : undefined;
          void recordUsage(sid, u, gatewayUsageLookupFromConfig(cfg, meta ?? gatewayMetaRef.current), role);
          void getCostReport(sid).then((report) => setSessionUsage(report.session));
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
            permResolveRef.current = resolve;
            setPerm({ tool: req.tool, args: req.args, resolve });
          }),
      };

      try {
        if (cfg.multiAgent) {
          if (!orchestratorRef.current) {
            orchestratorRef.current = new AgentOrchestrator({
              accountId: cfg.accountId,
              apiToken: cfg.apiToken,
              model: overrideModel ?? cfg.model,
              orchestratorModel: cfg.orchestratorModel ?? cfg.plumbingModel ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
              gateway: gatewayFromConfig(cfg),
              cwd: process.cwd(),
              signal: controller.signal,
              reasoningEffort: overrideEffort ?? effortRef.current,
              coauthor:
                cfg.coauthor !== false
                  ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
                  : undefined,
              sessionId: ensureSessionId(),
              memoryManager: memoryManagerRef.current,
              keepLastImageTurns: cfg.imageHistoryTurns ?? 2,
              codeMode,
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
              executor: executorRef.current,
              mcpTools: mcpToolsRef.current,
              lspTools: lspToolsRef.current,
              autoSwitch: cfg.autoSwitch ?? false,
              autoSwitchConfirm: cfg.autoSwitchConfirm ?? false,
              onAutoSwitchSuggestion: (from, to, reason) => {
                setEvents((e) => [
                  ...e,
                  { kind: "info", key: mkKey(), text: `suggested switch: ${from} → ${to} (${reason}). Run /agent ${to} to switch.` },
                ]);
              },
              customAgents: cfg.customAgents,
            });
            if (pendingOrchestratorStateRef.current) {
              orchestratorRef.current.deserialize(pendingOrchestratorStateRef.current);
              pendingOrchestratorStateRef.current = null;
            }
            // Ensure active agent has system messages. New multi-agent sessions
            // start with empty per-agent buffers, but compactMessages (and the
            // model itself) expect a leading system message.
            const activeSession = orchestratorRef.current.getActiveSession();
            if (!activeSession.messages.some((m) => m.role === "system")) {
              const prefix = makePrefixMessages(
                cacheStableRef.current,
                overrideModel ?? cfg.model,
                modeRef.current,
                [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
                orchestratorRef.current.getActiveRole(),
              );
              activeSession.messages.unshift(...prefix);
            }
          }
          await orchestratorRef.current.runTurn({ role: "user", content });
          // Sync active agent messages to messagesRef for session saving
          const activeSession = orchestratorRef.current.getActiveSession();
          messagesRef.current = activeSession.messages.slice();
        } else {
          await runAgentTurn({
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            model: overrideModel ?? cfg.model,
            gateway: gatewayFromConfig(cfg),
            messages: messagesRef.current,
            tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
            executor: executorRef.current,
            cwd: process.cwd(),
            signal: controller.signal,
            reasoningEffort: overrideEffort ?? effortRef.current,
            coauthor:
              cfg.coauthor !== false
                ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
                : undefined,
            sessionId: ensureSessionId(),
            memoryManager: memoryManagerRef.current,
            keepLastImageTurns: cfg.imageHistoryTurns ?? 2,
            codeMode,
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
          });
        }
        await saveSessionSafe();

        // Auto-compact after turn when thresholds are met. With compiled
        // context on, use the heuristic compactor; otherwise fall back to the
        // LLM summarizer so users have a safety net regardless of the flag.
        if (shouldCompact({ messages: messagesRef.current })) {
          if (compiledContextRef.current) {
            const store = cfg?.multiAgent
              ? orchestratorRef.current?.getActiveArtifactStore() ?? artifactStoreRef.current
              : artifactStoreRef.current;
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
                signal: controller.signal,
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
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // Inject synthetic tool results for any pending tool calls so message
          // history remains valid (assistant msg with tool_calls needs 1:1 results).
          for (const [tcId, tcName] of pendingToolCallsRef.current) {
            messagesRef.current.push({
              role: "tool",
              tool_call_id: tcId,
              content: "(interrupted)",
              name: tcName,
            });
          }
          setEvents((evts) =>
            evts.map((e) => (e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const, result: "(interrupted)" } : e)),
          );
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
        const asstId = activeAsstIdRef.current;
        if (asstId !== null) updateAssistant(asstId, () => ({ streaming: false }));
        setBusy(false);
        setTurnStartedAt(null);
        activeAsstIdRef.current = null;
        activeControllerRef.current = null;
        permResolveRef.current = null;
        pendingToolCallsRef.current.clear();
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

  if (showHelpMenu) {
    return (
      <Box flexDirection="column">
        <HelpMenu
          theme={theme}
          themes={themeList().map((t) => ({ name: t.name, label: t.label }))}
          currentThemeName={theme.name}
          customCommands={customCommandsRef.current
            .filter((c) => !BUILTIN_COMMAND_NAMES.has(c.name.toLowerCase()))
            .map((c) => ({ name: c.name, description: c.description }))}
          costAttributionEnabled={cfg?.costAttribution}
          multiAgentEnabled={cfg?.multiAgent}
          onDone={() => setShowHelpMenu(false)}
          onCommand={handleHelpCommand}
        />
      </Box>
    );
  }

  if (showLspWizard) {
    return (
      <Box flexDirection="column">
        <LspWizard
          theme={theme}
          servers={cfg?.lspServers ?? {}}
          currentScope={lspScope}
          hasProjectDir={existsSync(join(process.cwd(), ".kimiflare"))}
          onDone={() => setShowLspWizard(false)}
          onSave={(servers, enabled, scope) => {
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
          }}
        />
      </Box>
    );
  }

  if (commandWizard) {
    return (
      <Box flexDirection="column">
        <CommandWizard
          theme={theme}
          mode={commandWizard.mode}
          initial={commandWizard.initial}
          existingNames={customCommandsRef.current.map((c) => c.name)}
          builtinNames={BUILTIN_COMMAND_NAMES}
          onDone={() => setCommandWizard(null)}
          onSave={handleCommandSave}
        />
      </Box>
    );
  }

  if (commandPicker) {
    return (
      <Box flexDirection="column">
        <CommandPicker
          theme={theme}
          commands={customCommandsRef.current}
          title={commandPicker.mode === "edit" ? "Edit custom command" : "Delete custom command"}
          onPick={(cmd) => {
            setCommandPicker(null);
            if (!cmd) return;
            if (commandPicker.mode === "edit") {
              setCommandWizard({ mode: "edit", initial: cmd });
            } else {
              setCommandToDelete(cmd);
            }
          }}
        />
      </Box>
    );
  }

  if (commandToDelete) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Delete /{commandToDelete.name}?
        </Text>
        <Text color={theme.info.color} dimColor>
          {commandToDelete.filepath}
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Yes, delete", value: "yes", key: "yes" },
              { label: "Cancel", value: "cancel", key: "cancel" },
            ]}
            onSelect={(item) => {
              if (item.value === "yes") {
                void handleCommandDelete(commandToDelete);
              } else {
                setCommandToDelete(null);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (showCommandList) {
    return (
      <Box flexDirection="column">
        <CommandList
          theme={theme}
          commands={customCommandsRef.current}
          onDone={() => setShowCommandList(false)}
        />
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
            permResolveRef.current = null;
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
          {pickerAnchor !== null && (
            <FilePicker
              items={filteredPickerItems}
              selectedIndex={pickerSelected}
              theme={theme}
              query={mentionState?.query ?? ""}
            />
          )}
          <Box marginTop={1}>
            <Text color={theme.accent}>› </Text>
            <CustomTextInput
              value={input}
              onChange={setInput}
              onSubmit={submit}
              enablePaste
              cursorOffset={cursorOffset}
              onCursorChange={setCursorOffset}
              pickerActive={pickerAnchor !== null}
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
  );
}

export async function renderApp(
  cfg: Cfg | null,
  updateResult?: UpdateCheckResult,
  lspScope: "project" | "global" = "global",
  lspProjectPath: string | null = null,
) {
  const instance = render(
    <App
      initialCfg={cfg}
      initialUpdateResult={updateResult}
      initialLspScope={lspScope}
      initialLspProjectPath={lspProjectPath}
    />,
    {
      incrementalRendering: true,
    },
  );
  await instance.waitUntilExit();
}
