import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";

import { runAgentTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { compactMessages } from "./agent/compact.js";
import { ToolExecutor, ALL_TOOLS, type PermissionDecision } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
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

interface Cfg {
  accountId: string;
  apiToken: string;
  model: string;
  theme?: string;
  reasoningEffort?: ReasoningEffort;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
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

const MAX_IMAGES_PER_MESSAGE = 10;

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
  const [showReasoning, setShowReasoning] = useState(false);
  const [perm, setPerm] = useState<PendingPermission | null>(null);
  const [queue, setQueue] = useState<Array<{ full: string; display: string }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");

  const [mode, setMode] = useState<Mode>("edit");
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

  const messagesRef = useRef<ChatMessage[]>([
    {
      role: "system",
      content: buildSystemPrompt({
        cwd: process.cwd(),
        tools: ALL_TOOLS,
        model: cfg?.model ?? DEFAULT_MODEL,
        mode: "edit",
      }),
    },
  ]);
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const modeRef = useRef<Mode>(mode);
  const effortRef = useRef<ReasoningEffort>(effort);
  const tasksRef = useRef<Task[]>([]);
  const usageRef = useRef<Usage | null>(null);
  const updateCheckedRef = useRef(false);
  const updateNudgedRef = useRef(false);
  const compactSuggestedRef = useRef(false);

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
    messagesRef.current[0] = {
      role: "system",
      content: buildSystemPrompt({
        cwd: process.cwd(),
        tools: ALL_TOOLS,
        model: cfg?.model ?? DEFAULT_MODEL,
        mode,
      }),
    };
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

  const saveSessionSafe = useCallback(async () => {
    if (!cfg) return;
    if (!sessionIdRef.current) {
      const firstUser = messagesRef.current.find((m) => m.role === "user");
      let firstText = "session";
      if (typeof firstUser?.content === "string") {
        firstText = firstUser.content;
      } else if (Array.isArray(firstUser?.content)) {
        const textPart = firstUser.content.find((p) => p.type === "text");
        if (textPart?.text) firstText = textPart.text;
      }
      sessionIdRef.current = makeSessionId(firstText);
    }
    try {
      await saveSession({
        id: sessionIdRef.current,
        cwd: process.cwd(),
        model: cfg.model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: messagesRef.current,
      });
    } catch {
      /* non-fatal */
    }
  }, [cfg]);

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
  });

  const updateAssistant = useCallback(
    (id: number, patch: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>) => {
      setEvents((evts) =>
        evts.map((e) =>
          e.kind === "assistant" && e.id === id ? ({ ...e, ...patch(e) } as ChatEvent) : e,
        ),
      );
    },
    [],
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
      const result = await compactMessages({
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        messages: messagesRef.current,
        signal: controller.signal,
      });
      if (result.replacedCount === 0) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "nothing to compact yet" },
        ]);
      } else {
        messagesRef.current = result.newMessages;
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `compacted ${result.replacedCount} messages into a summary`,
          },
        ]);
        await saveSessionSafe();
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
        messages: messagesRef.current,
        tools: ALL_TOOLS,
        executor: executorRef.current,
        cwd,
        signal: controller.signal,
        reasoningEffort: effortRef.current,
        coauthor:
          cfg.coauthor !== false
            ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
            : undefined,
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
        messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd,
            tools: ALL_TOOLS,
            model: cfg.model,
            mode: modeRef.current,
          }),
        };
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
  }, [cfg, busy, updateAssistant, updateTool]);

  const handleResumePick = useCallback(
    async (picked: SessionSummary | null) => {
      setResumeSessions(null);
      if (!picked) return;
      try {
        const file = await loadSession(picked.filePath);
        messagesRef.current = file.messages;
        sessionIdRef.current = file.id;
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
        messagesRef.current = [messagesRef.current[0]!];
        sessionIdRef.current = null;
        setEvents([]);
        setUsage(null);
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
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: usage
              ? `prompt ${usage.prompt_tokens} / completion ${usage.completion_tokens}`
              : "no usage yet",
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
              "  /reasoning              toggle show/hide model reasoning\n" +
              "  /clear                  clear current conversation\n" +
              "  /cost /model /update /logout /help /exit\n" +
              "keys: ctrl-c interrupt/exit · ctrl-r toggle reasoning · ctrl-o verbose · ctrl+t theme · shift+tab cycle mode · ↑/↓ history",
          },
        ]);
        return true;
      }
      return false;
    },
    [cfg, exit, usage, effort, theme, mode, openResumePicker, runCompact, runInit],
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
      setBusy(true);
      setTurnStartedAt(Date.now());

      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        await runAgentTurn({
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: cfg.model,
          messages: messagesRef.current,
          tools: ALL_TOOLS,
          executor: executorRef.current,
          cwd: process.cwd(),
          signal: controller.signal,
          reasoningEffort: effortRef.current,
          coauthor:
            cfg.coauthor !== false
              ? { name: cfg.coauthorName || "kimiflare", email: cfg.coauthorEmail || "kimiflare@proton.me" }
              : undefined,
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
            onTasks: (nextTasks) => {
              const prevEmpty = tasksRef.current.length === 0;
              tasksRef.current = nextTasks;
              setTasks(nextTasks);
              if (prevEmpty && nextTasks.length > 0) {
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
    [cfg, handleSlash, updateAssistant, updateTool, saveSessionSafe],
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
        <Welcome theme={theme} />
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
            thinking={busy}
            turnStartedAt={turnStartedAt}
            theme={theme}
            mode={mode}
            effort={effort}
            contextLimit={CONTEXT_LIMIT}
            hasUpdate={hasUpdate}
            latestVersion={latestVersion}
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
  const instance = render(<App initialCfg={cfg} initialUpdateResult={updateResult} />);
  await instance.waitUntilExit();
}
