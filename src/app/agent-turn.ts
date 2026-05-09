import { runAgentTurn } from "../agent/loop.js";
import { buildInitPrompt } from "../init/context-generator.js";
import { classifyIntent } from "../intent/classify.js";
import { KimiApiError } from "../util/errors.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeString } from "../agent/messages.js";
import {
  buildSystemPrompt,
  buildSessionPrefix,
} from "../agent/system-prompt.js";
import { ALL_TOOLS } from "../tools/executor.js";

import type React from "react";
import { compactMessages } from "../agent/compact.js";
import { compactMessages as compactCompiled } from "../agent/compaction.js";
import type { ChatMessage, Usage } from "../agent/messages.js";
import type { SessionState } from "../agent/session-state.js";
import type { ArtifactStore } from "../agent/session-state.js";
import { gatewayFromConfig } from "../app.js";
import type { Cfg } from "../app.js";
import { AbortScope } from "../util/abort-scope.js";
import type { ChatEvent } from "../ui/chat.js";
import type { ReasoningEffort } from "../config.js";
import type { ToolSpec, ToolRender } from "../tools/registry.js";
import type { MemoryManager } from "../memory/manager.js";
import type { LspManager } from "../lsp/manager.js";
import type { PermissionDecision } from "../tools/executor.js";
import type { LimitDecision } from "../ui/limit-modal.js";
import type { Mode } from "../mode.js";
import type { GatewayMeta } from "../agent/client.js";
import type { TurnPhase } from "../ui/status.js";
import type { Task } from "../tasks-state.js";
import type { DailyUsage, CostReport } from "../usage-tracker.js";

import { compactEventsVisual } from "../util/event-helpers.js";

export interface RunCompactCtx {
  cfg: Cfg | null;
  busy: boolean;
  saveSessionSafe: () => Promise<void>;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  mkKey: () => string;
  setBusy: (updater: React.SetStateAction<boolean>) => void;
  busyRef: React.MutableRefObject<boolean>;
  setTurnStartedAt: (updater: React.SetStateAction<number | null>) => void;
  setTurnPhase: (
    updater: React.SetStateAction<import("../ui/status.js").TurnPhase>,
  ) => void;
  setCurrentToolName: (updater: React.SetStateAction<string | null>) => void;
  setLastActivityAt: (updater: React.SetStateAction<number | null>) => void;
  sessionScopeRef: React.MutableRefObject<AbortScope>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  permResolveRef: React.MutableRefObject<
    ((d: import("../tools/executor.js").PermissionDecision) => void) | null
  >;
  limitResolveRef: React.MutableRefObject<
    ((d: import("../ui/limit-modal.js").LimitDecision) => void) | null
  >;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  compiledContextRef: React.MutableRefObject<boolean>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
}

export async function runCompact(ctx: RunCompactCtx): Promise<void> {
  const {
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
  } = ctx;

  if (!cfg) return;
  if (busy) {
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "can't compact while model is running",
      },
    ]);
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
        {
          kind: "error",
          key: mkKey(),
          text: `compact failed: ${(e as Error).message}`,
        },
      ]);
    }
  } finally {
    setBusy(false);
    busyRef.current = false;
    setTurnStartedAt(null);
    setTurnPhase("waiting");
    setCurrentToolName(null);
    setLastActivityAt(null);
    activeScopeRef.current = null;
    permResolveRef.current = null;
    limitResolveRef.current = null;
    pendingToolCallsRef.current.clear();
  }
}

export interface RunInitCtx {
  cfg: Cfg | null;
  busy: boolean;
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  mkKey: () => string;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  busyRef: React.MutableRefObject<boolean>;
  setTurnStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTurnPhase: React.Dispatch<React.SetStateAction<TurnPhase>>;
  setCurrentToolName: React.Dispatch<React.SetStateAction<string | null>>;
  setLastActivityAt: React.Dispatch<React.SetStateAction<number | null>>;
  sessionScopeRef: React.MutableRefObject<AbortScope>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  setCodeMode: React.Dispatch<React.SetStateAction<boolean>>;
  effortRef: React.MutableRefObject<ReasoningEffort>;
  cloudToken: string | null;
  initialCloudToken: string | null;
  cloudDeviceId: string | null;
  initialCloudDeviceId: string | null;
  mcpToolsRef: React.MutableRefObject<ToolSpec[]>;
  lspToolsRef: React.MutableRefObject<ToolSpec[]>;
  executorRef: React.MutableRefObject<
    import("../tools/executor.js").ToolExecutor
  >;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  lspManagerRef: React.MutableRefObject<LspManager>;
  updateAssistant: (
    id: number,
    fn: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>,
  ) => void;
  updateTool: (
    id: string,
    patch: Partial<Extract<ChatEvent, { kind: "tool" }>>,
  ) => void;
  activeAsstIdRef: React.MutableRefObject<number | null>;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  usageRef: React.MutableRefObject<Usage | null>;
  setUsage: React.Dispatch<React.SetStateAction<Usage | null>>;
  setSessionUsage: React.Dispatch<React.SetStateAction<DailyUsage | null>>;
  ensureSessionId: () => string;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  permResolveRef: React.MutableRefObject<
    ((d: PermissionDecision) => void) | null
  >;
  limitResolveRef: React.MutableRefObject<((d: LimitDecision) => void) | null>;
  setOverlay: React.Dispatch<React.SetStateAction<any>>;
  modeRef: React.MutableRefObject<Mode>;
  kimiMdStaleNudgedRef: React.MutableRefObject<boolean>;
  setKimiMdStale: React.Dispatch<React.SetStateAction<boolean>>;
  tasksRef: React.MutableRefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setTasksStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTasksStartTokens: React.Dispatch<React.SetStateAction<number>>;
  updateGatewayMeta: (meta: GatewayMeta) => void;
  recordUsage: (
    sessionId: string,
    usage: Usage,
    lookup?: import("../usage-tracker.js").GatewayUsageLookup,
  ) => Promise<void>;
  gatewayUsageLookupFromConfig: (
    cfg: Cfg,
    meta: GatewayMeta | null,
  ) => import("../usage-tracker.js").GatewayUsageLookup | undefined;
  getCostReport: (sessionId?: string) => Promise<CostReport>;
  isBlockedInPlanMode: (name: string) => boolean;
  isReadOnlyBash: (cmd: string) => boolean;
  recentFilesRef: React.MutableRefObject<Map<string, number>>;
  maxRecentFiles: number;
  trackRecentFile: (
    ref: React.MutableRefObject<Map<string, number>>,
    path: string,
    max: number,
  ) => void;
  cacheStableRef: React.MutableRefObject<boolean>;
  safeSave: (operation: string, promise: Promise<unknown>) => void;
  saveConfig: (cfg: Cfg) => Promise<string>;
  setCloudBudget: React.Dispatch<
    React.SetStateAction<{ remaining: number; limit: number } | null>
  >;
  isCloudQuotaExhaustedError: (e: unknown) => boolean;
  nextAssistantIdRef: React.MutableRefObject<number>;
  onIterationEnd: (
    messages: ChatMessage[],
    signal: AbortSignal,
  ) => Promise<ChatMessage[]>;
}

export interface AgentCallbacksCtx {
  nextAssistantIdRef: React.MutableRefObject<number>;
  activeAsstIdRef: React.MutableRefObject<number | null>;
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  updateAssistant: (
    id: number,
    fn: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>,
  ) => void;
  updateTool: (
    id: string,
    patch: Partial<Extract<ChatEvent, { kind: "tool" }>>,
  ) => void;
  setTurnPhase: React.Dispatch<React.SetStateAction<TurnPhase>>;
  setLastActivityAt: React.Dispatch<React.SetStateAction<number | null>>;
  setCurrentToolName: React.Dispatch<React.SetStateAction<string | null>>;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  executorRef: React.MutableRefObject<
    import("../tools/executor.js").ToolExecutor
  >;
  recentFilesRef: React.MutableRefObject<Map<string, number>>;
  maxRecentFiles: number;
  trackRecentFile: (
    ref: React.MutableRefObject<Map<string, number>>,
    path: string,
    max: number,
  ) => void;
  usageRef: React.MutableRefObject<Usage | null>;
  setUsage: React.Dispatch<React.SetStateAction<Usage | null>>;
  ensureSessionId: () => string;
  recordUsage: (
    sessionId: string,
    usage: Usage,
    lookup?: import("../usage-tracker.js").GatewayUsageLookup,
  ) => Promise<void>;
  gatewayUsageLookupFromConfig: (
    cfg: Cfg,
    meta: GatewayMeta | null,
  ) => import("../usage-tracker.js").GatewayUsageLookup | undefined;
  getCostReport: (sessionId?: string) => Promise<CostReport>;
  cfg: Cfg | null;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  updateGatewayMeta: (meta: GatewayMeta) => void;
  setSessionUsage: React.Dispatch<React.SetStateAction<DailyUsage | null>>;
  cloudToken: string | null;
  initialCloudToken: string | null;
  cloudDeviceId: string | null;
  initialCloudDeviceId: string | null;
  setCloudBudget: React.Dispatch<
    React.SetStateAction<{ remaining: number; limit: number } | null>
  >;
  modeRef: React.MutableRefObject<Mode>;
  isBlockedInPlanMode: (name: string) => boolean;
  isReadOnlyBash: (cmd: string) => boolean;
  permResolveRef: React.MutableRefObject<
    ((d: PermissionDecision) => void) | null
  >;
  setOverlay: React.Dispatch<React.SetStateAction<any>>;
  mkKey: () => string;
  limitResolveRef: React.MutableRefObject<((d: LimitDecision) => void) | null>;
  kimiMdStaleNudgedRef: React.MutableRefObject<boolean>;
  setKimiMdStale: React.Dispatch<React.SetStateAction<boolean>>;
}

export function buildAgentCallbacks(
  ctx: AgentCallbacksCtx,
): Omit<
  import("../agent/loop.js").AgentCallbacks,
  "onTasks" | "onToolLimitReached"
> {
  return {
    onAssistantStart: () => {
      const id = ctx.nextAssistantIdRef.current++;
      ctx.activeAsstIdRef.current = id;
      ctx.setTurnPhase("generating");
      ctx.setLastActivityAt(Date.now());
      ctx.setEvents((e) => [
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
    onReasoningDelta: (d) => {
      const id = ctx.activeAsstIdRef.current;
      if (id !== null)
        ctx.updateAssistant(id, (e) => ({
          reasoning: e.reasoning + d,
        }));
      ctx.setLastActivityAt(Date.now());
    },
    onTextDelta: (d) => {
      const id = ctx.activeAsstIdRef.current;
      if (id !== null) ctx.updateAssistant(id, (e) => ({ text: e.text + d }));
      ctx.setLastActivityAt(Date.now());
    },
    onAssistantFinal: () => {
      const id = ctx.activeAsstIdRef.current;
      if (id !== null) ctx.updateAssistant(id, () => ({ streaming: false }));
      ctx.setTurnPhase("waiting");
    },
    onToolCallFinalized: (call) => {
      ctx.pendingToolCallsRef.current.set(call.id, call.function.name);
      ctx.setTurnPhase("executing");
      ctx.setCurrentToolName(call.function.name);
      ctx.setLastActivityAt(Date.now());
      const spec = ctx.executorRef.current
        .list()
        .find((t) => t.name === call.function.name);
      let renderMeta: ToolRender | undefined;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
        renderMeta = spec?.render?.(args);
      } catch {
        /* ignore render failure */
      }
      if (typeof args.path === "string") {
        ctx.trackRecentFile(ctx.recentFilesRef, args.path, ctx.maxRecentFiles);
      }
      ctx.setEvents((e) => [
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
    onToolResult: (r) => {
      ctx.pendingToolCallsRef.current.delete(r.tool_call_id);
      ctx.setLastActivityAt(Date.now());
      if (ctx.pendingToolCallsRef.current.size === 0) {
        ctx.setTurnPhase("waiting");
        ctx.setCurrentToolName(null);
      }
      ctx.updateTool(r.tool_call_id, {
        status: r.ok ? "done" : "error",
        result: r.content,
      });
    },
    onUsage: (u) => {
      ctx.usageRef.current = u;
      ctx.setUsage(u);
    },
    onUsageFinal: (u, meta) => {
      const sid = ctx.ensureSessionId();
      void ctx.recordUsage(
        sid,
        u,
        ctx.gatewayUsageLookupFromConfig(
          ctx.cfg!,
          meta ?? ctx.gatewayMetaRef.current,
        ),
      );
      void ctx
        .getCostReport(sid)
        .then((report) => ctx.setSessionUsage(report.session));
      if (ctx.cfg?.cloudMode && (ctx.cloudToken ?? ctx.initialCloudToken)) {
        const token = ctx.cloudToken ?? ctx.initialCloudToken!;
        const did = ctx.cloudDeviceId ?? ctx.initialCloudDeviceId ?? undefined;
        void (async () => {
          const { fetchCloudUsage } = await import("../cloud/auth.js");
          const usage = await fetchCloudUsage(token, did);
          if (usage) {
            ctx.setCloudBudget({
              remaining: usage.remaining,
              limit: usage.input_token_limit,
            });
          }
        })();
      }
    },
    onGatewayMeta: ctx.updateGatewayMeta,
    askPermission: (req) =>
      new Promise<PermissionDecision>((resolve) => {
        if (ctx.modeRef.current === "auto") {
          resolve("allow");
          return;
        }
        if (
          ctx.modeRef.current === "plan" &&
          ctx.isBlockedInPlanMode(req.tool.name)
        ) {
          if (
            req.tool.name === "bash" &&
            typeof req.args.command === "string" &&
            ctx.isReadOnlyBash(req.args.command)
          ) {
            resolve("allow");
            return;
          }
          ctx.setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: ctx.mkKey(),
              text: `plan mode blocked ${req.tool.name}; exit plan mode to execute`,
            },
          ]);
          resolve("deny");
          return;
        }
        ctx.permResolveRef.current = resolve;
        ctx.setOverlay({
          kind: "permission",
          perm: { tool: req.tool, args: req.args, resolve },
        });
      }),
    onKimiMdStale: () => {
      if (!ctx.kimiMdStaleNudgedRef.current) {
        ctx.kimiMdStaleNudgedRef.current = true;
        ctx.setKimiMdStale(true);
        ctx.setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: ctx.mkKey(),
            text: "Project context may be stale. Run /init to refresh KIMI.md based on recent changes.",
          },
        ]);
      }
    },
  };
}

export async function runInitFn(ctx: RunInitCtx): Promise<void> {
  if (!ctx.cfg) return;
  if (ctx.busy) {
    ctx.setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: ctx.mkKey(),
        text: "can't /init while model is running",
      },
    ]);
    return;
  }
  const cwd = process.cwd();
  const { prompt, targetFilename, isRefresh } = buildInitPrompt(cwd);

  ctx.setEvents((e) => [
    ...e,
    {
      kind: "user",
      key: ctx.mkKey(),
      text: isRefresh ? `/init (refreshing ${targetFilename})` : "/init",
    },
  ]);
  ctx.messagesRef.current.push({
    role: "user",
    content: sanitizeString(prompt),
  });
  ctx.setBusy(true);
  ctx.busyRef.current = true;
  ctx.setTurnStartedAt(Date.now());
  const turnScope = ctx.sessionScopeRef.current.createChild();
  ctx.activeScopeRef.current = turnScope;

  const initClassification = classifyIntent(prompt);
  const initEffortForTier: Record<string, ReasoningEffort> = {
    light: "low",
    medium: "medium",
    heavy: "high",
  };
  const initReasoningEffort =
    initEffortForTier[initClassification.tier] ?? ctx.effortRef.current;
  const effectiveCodeMode = initClassification.tier === "heavy";
  ctx.setCodeMode(effectiveCodeMode);

  try {
    await runAgentTurn({
      accountId: ctx.cfg.accountId,
      apiToken: ctx.cfg.apiToken,
      model: ctx.cfg.model,
      gateway: gatewayFromConfig(ctx.cfg),
      messages: ctx.messagesRef.current,
      tools: [
        ...ALL_TOOLS,
        ...ctx.mcpToolsRef.current,
        ...ctx.lspToolsRef.current,
      ],
      executor: ctx.executorRef.current,
      cwd,
      signal: turnScope.signal,
      reasoningEffort: initReasoningEffort,
      intentClassification: initClassification,
      coauthor:
        ctx.cfg.coauthor !== false
          ? {
              name: ctx.cfg.coauthorName || "kimiflare",
              email: ctx.cfg.coauthorEmail || "kimiflare@proton.me",
            }
          : undefined,
      sessionId: ctx.ensureSessionId(),
      memoryManager: ctx.memoryManagerRef.current,
      githubToken: ctx.cfg.githubOAuthToken,
      codeMode: effectiveCodeMode,
      cloudMode: ctx.cfg.cloudMode,
      cloudToken: ctx.cloudToken ?? ctx.initialCloudToken ?? undefined,
      cloudDeviceId: ctx.cloudDeviceId ?? ctx.initialCloudDeviceId ?? undefined,
      onIterationEnd: ctx.onIterationEnd,
      onFileChange: (path, content) => {
        if (content) {
          ctx.lspManagerRef.current.notifyChange(path, content);
        } else {
          // For edit tool, read the file and notify with full content
          void import("node:fs/promises").then(({ readFile }) =>
            readFile(path, "utf8")
              .then((c) => ctx.lspManagerRef.current.notifyChange(path, c))
              .catch((err) => ctx.safeSave("lspNotify", Promise.reject(err))),
          );
        }
      },
      callbacks: {
        ...buildAgentCallbacks(ctx),
        askPermission: (req) =>
          new Promise<PermissionDecision>((resolve) => {
            if (ctx.modeRef.current === "auto") {
              resolve("allow");
              return;
            }
            if (
              ctx.modeRef.current === "plan" &&
              ctx.isBlockedInPlanMode(req.tool.name)
            ) {
              if (
                req.tool.name === "bash" &&
                typeof req.args.command === "string" &&
                ctx.isReadOnlyBash(req.args.command)
              ) {
                resolve("allow");
                return;
              }
              if (req.tool.name === "bash") {
                ctx.permResolveRef.current = resolve;
                ctx.setOverlay({
                  kind: "permission",
                  perm: { tool: req.tool, args: req.args, resolve },
                });
                return;
              }
              ctx.setEvents((e) => [
                ...e,
                {
                  kind: "info",
                  key: ctx.mkKey(),
                  text: `plan mode blocked ${req.tool.name}; exit plan mode to execute`,
                },
              ]);
              resolve("deny");
              return;
            }
            ctx.permResolveRef.current = resolve;
            ctx.setOverlay({
              kind: "permission",
              perm: { tool: req.tool, args: req.args, resolve },
            });
          }),
      },
    });

    if (existsSync(join(cwd, "KIMI.md"))) {
      if (ctx.cacheStableRef.current) {
        ctx.messagesRef.current[1] = {
          role: "system",
          content: buildSessionPrefix({
            cwd,
            tools: [
              ...ALL_TOOLS,
              ...ctx.mcpToolsRef.current,
              ...ctx.lspToolsRef.current,
            ],
            model: ctx.cfg.model,
            mode: ctx.modeRef.current,
          }),
        };
      } else {
        ctx.messagesRef.current[0] = {
          role: "system",
          content: buildSystemPrompt({
            cwd,
            tools: [
              ...ALL_TOOLS,
              ...ctx.mcpToolsRef.current,
              ...ctx.lspToolsRef.current,
            ],
            model: ctx.cfg.model,
            mode: ctx.modeRef.current,
          }),
        };
      }
      ctx.setEvents((e) => [
        ...e,
        {
          kind: "info",
          key: ctx.mkKey(),
          text: "KIMI.md generated; context loaded for future turns",
        },
      ]);
      // Record refresh so drift detection knows this snapshot is current
      void ctx.memoryManagerRef.current?.recordKimiMdRefresh(
        cwd,
        ctx.ensureSessionId(),
      );
      ctx.setKimiMdStale(false);
      ctx.kimiMdStaleNudgedRef.current = false;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      for (const [tcId, tcName] of ctx.pendingToolCallsRef.current) {
        ctx.messagesRef.current.push({
          role: "tool",
          tool_call_id: tcId,
          content: "(stopped)",
          name: tcName,
        });
      }
      ctx.setEvents((evts) =>
        evts.map((e) =>
          e.kind === "tool" && e.status === "running"
            ? { ...e, status: "error" as const, result: "(stopped)" }
            : e,
        ),
      );
    } else if (ctx.cfg?.cloudMode && ctx.isCloudQuotaExhaustedError(e)) {
      const token = ctx.cloudToken ?? ctx.initialCloudToken ?? undefined;
      const did = ctx.cloudDeviceId ?? ctx.initialCloudDeviceId ?? undefined;
      let used = 0;
      let limit = 0;
      let expiresAt = "";
      if (token) {
        try {
          const { fetchCloudUsage } = await import("../cloud/auth.js");
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
      ctx.setEvents((es) => [
        ...es,
        {
          kind: "cloud_quota_exhausted",
          key: ctx.mkKey(),
          used,
          limit,
          expiresAt,
        },
      ]);
    } else {
      ctx.setEvents((es) => [
        ...es,
        {
          kind: "error",
          key: ctx.mkKey(),
          text: `init failed: ${(e as Error).message}`,
        },
      ]);
    }
  } finally {
    ctx.setCodeMode(false);
    const asstId = ctx.activeAsstIdRef.current;
    if (asstId !== null)
      ctx.updateAssistant(asstId, () => ({ streaming: false }));
    ctx.setBusy(false);
    ctx.busyRef.current = false;
    ctx.setTurnStartedAt(null);
    ctx.setTurnPhase("waiting");
    ctx.setCurrentToolName(null);
    ctx.setLastActivityAt(null);
    ctx.activeAsstIdRef.current = null;
    ctx.activeScopeRef.current = null;
    ctx.permResolveRef.current = null;
    ctx.limitResolveRef.current = null;
    ctx.pendingToolCallsRef.current.clear();
  }
}
