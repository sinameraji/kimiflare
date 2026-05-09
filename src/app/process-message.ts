import type React from "react";
import type { ChatMessage, Usage, ContentPart } from "../agent/messages.js";
import type { Cfg } from "../app.js";
import type { ChatEvent } from "../ui/chat.js";
import type { ReasoningEffort } from "../config.js";
import type { GatewayMeta } from "../agent/client.js";
import type { TurnPhase } from "../ui/status.js";
import type { Task } from "../tasks-state.js";
import type { DailyUsage, CostReport } from "../usage-tracker.js";
import type { PermissionDecision } from "../tools/executor.js";
import type { LimitDecision } from "../ui/limit-modal.js";
import type { Mode } from "../mode.js";
import type { SkillRoutingResult } from "../skills/index.js";
import type { EncodedImage } from "../util/image.js";
import type { CustomCommand } from "../commands/types.js";
import { KimiApiError } from "../util/errors.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeString } from "../agent/messages.js";
import {
  buildSystemPrompt,
  buildSessionPrefix,
} from "../agent/system-prompt.js";
import { ALL_TOOLS } from "../tools/executor.js";
import { gatewayFromConfig } from "../app.js";
import { classifyIntent } from "../intent/classify.js";
import { generateSessionTitle } from "../sessions.js";
import { routeSkills } from "../skills/index.js";
import { encodeImageFile } from "../util/image.js";
import { findImagePaths } from "../util/image-paths.js";
import { renderCommand } from "../commands/renderer.js";
import { maybeLspNudge } from "../util/lsp-nudge.js";
import { recallArtifacts, shouldCompact } from "../agent/compaction.js";
import { formatRecalledArtifacts } from "../agent/session-state.js";
import { compactMessages } from "../agent/compact.js";
import { compactMessages as compactCompiled } from "../agent/compaction.js";
import { buildAgentCallbacks } from "./agent-turn.js";
import { AbortScope } from "../util/abort-scope.js";
import type { SessionState } from "../agent/session-state.js";
import type { ArtifactStore } from "../agent/session-state.js";
import type { MemoryManager } from "../memory/manager.js";
import type { LspManager } from "../lsp/manager.js";
import { TurnSupervisor } from "../agent/supervisor.js";

export interface ProcessMessageCtx {
  cfg: Cfg | null;
  handleSlash: (input: string) => boolean;
  customCommandsRef: React.MutableRefObject<CustomCommand[]>;
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  mkKey: () => string;
  trackRecentFile: (
    ref: React.MutableRefObject<Map<string, number>>,
    path: string,
    max: number,
  ) => void;
  recentFilesRef: React.MutableRefObject<Map<string, number>>;
  maxRecentFiles: number;
  maxImagesPerMessage: number;
  findImagePaths: (text: string) => string[];
  encodeImageFile: (path: string) => Promise<EncodedImage>;
  sessionStartRecallRef: React.MutableRefObject<Promise<void> | null>;
  maybeLspNudge: (
    text: string,
    lspEnabled: boolean,
    lspServers: Record<string, unknown>,
  ) => string | null;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  saveSessionSafe: () => Promise<void>;
  compiledContextRef: React.MutableRefObject<boolean>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  turnCounterRef: React.MutableRefObject<number>;
  busyRef: React.MutableRefObject<boolean>;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  setGatewayMeta: React.Dispatch<React.SetStateAction<GatewayMeta | null>>;
  setTurnStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setIntentTier: React.Dispatch<
    React.SetStateAction<"light" | "medium" | "heavy" | null>
  >;
  sessionTitleRef: React.MutableRefObject<string | null>;
  skillsDirRef: React.MutableRefObject<string | null>;
  contextLimit: number;
  setSkillsActive: React.Dispatch<React.SetStateAction<number>>;
  effortRef: React.MutableRefObject<ReasoningEffort>;
  setCodeMode: React.Dispatch<React.SetStateAction<boolean>>;
  cacheStableRef: React.MutableRefObject<boolean>;
  mcpToolsRef: React.MutableRefObject<
    import("../tools/registry.js").ToolSpec[]
  >;
  lspToolsRef: React.MutableRefObject<
    import("../tools/registry.js").ToolSpec[]
  >;
  modeRef: React.MutableRefObject<Mode>;
  nextAssistantIdRef: React.MutableRefObject<number>;
  activeAsstIdRef: React.MutableRefObject<number | null>;
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
  setSessionUsage: React.Dispatch<React.SetStateAction<DailyUsage | null>>;
  cloudToken: string | null;
  initialCloudToken: string | null;
  cloudDeviceId: string | null;
  initialCloudDeviceId: string | null;
  setCloudBudget: React.Dispatch<
    React.SetStateAction<{ remaining: number; limit: number } | null>
  >;
  isBlockedInPlanMode: (name: string) => boolean;
  isReadOnlyBash: (cmd: string) => boolean;
  permResolveRef: React.MutableRefObject<
    ((d: PermissionDecision) => void) | null
  >;
  setOverlay: React.Dispatch<React.SetStateAction<any>>;
  limitResolveRef: React.MutableRefObject<((d: LimitDecision) => void) | null>;
  kimiMdStaleNudgedRef: React.MutableRefObject<boolean>;
  setKimiMdStale: React.Dispatch<React.SetStateAction<boolean>>;
  tasksRef: React.MutableRefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setTasksStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTasksStartTokens: React.Dispatch<React.SetStateAction<number>>;
  sessionScopeRef: React.MutableRefObject<AbortScope>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  isAbortingRef: React.MutableRefObject<boolean>;
  supervisorRef: React.MutableRefObject<TurnSupervisor>;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  lspManagerRef: React.MutableRefObject<LspManager>;
  safeSave: (operation: string, promise: Promise<unknown>) => void;
  onIterationEnd: (
    messages: ChatMessage[],
    signal: AbortSignal,
  ) => Promise<ChatMessage[]>;
  isCloudQuotaExhaustedError: (e: unknown) => boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  updateGatewayMeta: (meta: GatewayMeta) => void;
  kimiMdStale: boolean;
}

export async function processMessageFn(
  ctx: ProcessMessageCtx,
  text: string,
  displayText?: string,
  opts?: { queuedKey?: string },
): Promise<void> {
  if (!ctx.cfg) return;
  let trimmed = text.trim();
  if (!trimmed) return;

  let overrideModel: string | undefined;
  let overrideEffort: ReasoningEffort | undefined;
  let display = displayText?.trim() || trimmed;

  if (trimmed.startsWith("/")) {
    if (ctx.handleSlash(trimmed)) return;
    const head = trimmed.split(/\s+/)[0]!.slice(1);
    const custom = ctx.customCommandsRef.current.find((c) => c.name === head);
    if (custom) {
      const info = (text: string) =>
        ctx.setEvents((e) => [...e, { kind: "info", key: ctx.mkKey(), text }]);
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
    if (path) ctx.trackRecentFile(ctx.recentFilesRef, path, ctx.maxRecentFiles);
  }

  const imagePaths = findImagePaths(trimmed).slice(0, ctx.maxImagesPerMessage);
  let images: string[] = [];
  let content: string | ContentPart[] = sanitizeString(trimmed);

  if (imagePaths.length > 0) {
    const encoded = await Promise.all(
      imagePaths.map(async (path) => {
        try {
          const img = await encodeImageFile(path);
          return { path, img };
        } catch (e) {
          ctx.setEvents((es) => [
            ...es,
            {
              kind: "error",
              key: ctx.mkKey(),
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
  if (ctx.sessionStartRecallRef.current) {
    await ctx.sessionStartRecallRef.current;
    ctx.sessionStartRecallRef.current = null;
  }

  if (opts?.queuedKey) {
    ctx.setEvents((evts) =>
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
    ctx.setEvents((e) => [
      ...e,
      {
        kind: "user",
        key: ctx.mkKey(),
        text: display,
        images: images.length > 0 ? images : undefined,
      },
    ]);
  }

  // LSP nudge: if user references code files and LSP is not configured
  const nudge = maybeLspNudge(
    display,
    ctx.cfg?.lspEnabled ?? false,
    ctx.cfg?.lspServers ?? {},
  );
  if (nudge) {
    ctx.setEvents((e) => [
      ...e,
      { kind: "info", key: ctx.mkKey(), text: nudge },
    ]);
  }

  ctx.messagesRef.current.push({ role: "user", content });

  // Pre-turn save: ensure session exists even if user exits mid-turn
  await ctx.saveSessionSafe();

  // Recall artifacts before sending if compiled context is enabled
  if (ctx.compiledContextRef.current) {
    const { ids: _ids, recalled } = recallArtifacts(
      ctx.messagesRef.current,
      ctx.artifactStoreRef.current,
      ctx.sessionStateRef.current,
    );
    if (recalled.length > 0) {
      const recalledText = formatRecalledArtifacts(recalled);
      ctx.messagesRef.current.push({ role: "system", content: recalledText });
      ctx.sessionStateRef.current = {
        ...ctx.sessionStateRef.current,
        artifact_index: { ...ctx.sessionStateRef.current.artifact_index },
      };
    }
  }

  // Occasional gentle nudge about /init (educational, not a warning)
  ctx.turnCounterRef.current += 1;
  if (
    ctx.turnCounterRef.current % 15 === 0 &&
    existsSync(join(process.cwd(), "KIMI.md")) &&
    !ctx.kimiMdStale
  ) {
    ctx.setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: ctx.mkKey(),
        text: "Tip: Rerunning /init occasionally helps KimiFlare stay accurate as your project evolves.",
      },
    ]);
  }

  ctx.setBusy(true);
  ctx.busyRef.current = true;
  ctx.gatewayMetaRef.current = null;
  ctx.setGatewayMeta(null);
  ctx.setTurnStartedAt(Date.now());

  const classification = classifyIntent(trimmed);
  ctx.setIntentTier(classification.tier);

  // Generate a human-readable title on first turn
  if (!ctx.sessionTitleRef.current) {
    ctx.sessionTitleRef.current = generateSessionTitle(
      trimmed,
      classification.intent,
    );
  }

  // Route skills based on intent tier
  let skillResult: SkillRoutingResult | undefined;
  try {
    skillResult = await routeSkills(ctx.skillsDirRef.current ?? "", {
      cwd: process.cwd(),
      prompt: trimmed,
      memorySnippets: [], // TODO: wire memory snippets when available
      tier: classification.tier,
      maxSkillTokens: ctx.contextLimit - 10_000, // leave headroom
    });
    ctx.setSkillsActive(skillResult.selectedSkills.length);
  } catch {
    ctx.setSkillsActive(0);
  }

  const effortForTier: Record<string, ReasoningEffort> = {
    light: "low",
    medium: "medium",
    heavy: "high",
  };
  const turnReasoningEffort =
    overrideEffort ??
    effortForTier[classification.tier] ??
    ctx.effortRef.current;
  const effectiveCodeMode = classification.tier === "heavy";
  ctx.setCodeMode(effectiveCodeMode);

  // Inject selected skills into system prompt
  const selectedSkills = skillResult?.selectedSkills.map((s) => ({
    name: s.name,
    body: s.body,
  }));
  if (ctx.cacheStableRef.current) {
    ctx.messagesRef.current[1] = {
      role: "system",
      content: buildSessionPrefix({
        cwd: process.cwd(),
        tools: [
          ...ALL_TOOLS,
          ...ctx.mcpToolsRef.current,
          ...ctx.lspToolsRef.current,
        ],
        model: ctx.cfg.model,
        mode: ctx.modeRef.current,
        selectedSkills,
      }),
    };
  } else {
    ctx.messagesRef.current[0] = {
      role: "system",
      content: buildSystemPrompt({
        cwd: process.cwd(),
        tools: [
          ...ALL_TOOLS,
          ...ctx.mcpToolsRef.current,
          ...ctx.lspToolsRef.current,
        ],
        model: ctx.cfg.model,
        mode: ctx.modeRef.current,
        selectedSkills,
      }),
    };
  }

  // Emit metadata banner
  ctx.setEvents((e) => [
    ...e,
    {
      kind: "meta",
      key: ctx.mkKey(),
      intentTier: classification.tier,
      skillsActive: skillResult?.selectedSkills.length ?? 0,
      memoryRecalled: false,
    },
  ]);

  const turnScope = ctx.sessionScopeRef.current.createChild();
  ctx.activeScopeRef.current = turnScope;

  const callbacks = {
    ...buildAgentCallbacks({
      nextAssistantIdRef: ctx.nextAssistantIdRef,
      activeAsstIdRef: ctx.activeAsstIdRef,
      setEvents: ctx.setEvents,
      updateAssistant: ctx.updateAssistant,
      updateTool: ctx.updateTool,
      setTurnPhase: ctx.setTurnPhase,
      setLastActivityAt: ctx.setLastActivityAt,
      setCurrentToolName: ctx.setCurrentToolName,
      pendingToolCallsRef: ctx.pendingToolCallsRef,
      executorRef: ctx.executorRef,
      recentFilesRef: ctx.recentFilesRef,
      maxRecentFiles: ctx.maxRecentFiles,
      trackRecentFile: ctx.trackRecentFile,
      usageRef: ctx.usageRef,
      setUsage: ctx.setUsage,
      ensureSessionId: ctx.ensureSessionId,
      recordUsage: ctx.recordUsage,
      gatewayUsageLookupFromConfig: ctx.gatewayUsageLookupFromConfig,
      getCostReport: ctx.getCostReport,
      cfg: ctx.cfg,
      gatewayMetaRef: ctx.gatewayMetaRef,
      updateGatewayMeta: ctx.updateGatewayMeta,
      setSessionUsage: ctx.setSessionUsage,
      cloudToken: ctx.cloudToken ?? null,
      initialCloudToken: ctx.initialCloudToken ?? null,
      cloudDeviceId: ctx.cloudDeviceId ?? null,
      initialCloudDeviceId: ctx.initialCloudDeviceId ?? null,
      setCloudBudget: ctx.setCloudBudget,
      modeRef: ctx.modeRef,
      isBlockedInPlanMode: ctx.isBlockedInPlanMode,
      isReadOnlyBash: ctx.isReadOnlyBash,
      permResolveRef: ctx.permResolveRef,
      setOverlay: ctx.setOverlay,
      mkKey: ctx.mkKey,
      limitResolveRef: ctx.limitResolveRef,
      kimiMdStaleNudgedRef: ctx.kimiMdStaleNudgedRef,
      setKimiMdStale: ctx.setKimiMdStale,
    }),
    onTasks: (nextTasks: Task[]) => {
      const prevEmpty = ctx.tasksRef.current.length === 0;
      const prevAllDone =
        ctx.tasksRef.current.length > 0 &&
        ctx.tasksRef.current.every((t) => t.status === "completed");
      ctx.tasksRef.current = nextTasks;
      ctx.setTasks(nextTasks);
      if ((prevEmpty || prevAllDone) && nextTasks.length > 0) {
        ctx.setTasksStartedAt(Date.now());
        ctx.setTasksStartTokens(ctx.usageRef.current?.prompt_tokens ?? 0);
      }
      if (nextTasks.length === 0) {
        ctx.setTasksStartedAt(null);
        ctx.setTasksStartTokens(0);
      }
    },
    onToolLimitReached: () =>
      new Promise<LimitDecision>((resolve) => {
        ctx.limitResolveRef.current = resolve;
        ctx.setOverlay({ kind: "limitModal", limit: 50, resolve });
      }),
  };
  const cleanupTurn = () => {
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
    ctx.isAbortingRef.current = false;
    ctx.permResolveRef.current = null;
    ctx.limitResolveRef.current = null;
    ctx.pendingToolCallsRef.current.clear();

    // Clear task list so it doesn't linger into the next turn
    ctx.setTasks([]);
    ctx.setTasksStartedAt(null);
    ctx.setTasksStartTokens(0);
    ctx.tasksRef.current = [];

    // Mark any still-running tools as interrupted
    ctx.setEvents((evts) =>
      evts.map((e) =>
        e.kind === "tool" && e.status === "running"
          ? { ...e, status: "error" as const, result: "(stopped)" }
          : e,
      ),
    );
  };

  ctx.supervisorRef.current.startTurn(
    {
      accountId: ctx.cfg.accountId,
      apiToken: ctx.cfg.apiToken,
      model: overrideModel ?? ctx.cfg.model,
      gateway: gatewayFromConfig(ctx.cfg!),
      messages: ctx.messagesRef.current,
      tools: [
        ...ALL_TOOLS,
        ...ctx.mcpToolsRef.current,
        ...ctx.lspToolsRef.current,
      ],
      executor: ctx.executorRef.current,
      cwd: process.cwd(),
      signal: turnScope.signal,
      reasoningEffort: turnReasoningEffort,
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
      keepLastImageTurns: ctx.cfg.imageHistoryTurns ?? 2,
      codeMode: effectiveCodeMode,
      cloudMode: ctx.cfg.cloudMode,
      cloudToken: ctx.cloudToken ?? ctx.initialCloudToken ?? undefined,
      cloudDeviceId: ctx.cloudDeviceId ?? ctx.initialCloudDeviceId ?? undefined,
      onIterationEnd: ctx.onIterationEnd,
      intentClassification: classification,
      selectedSkills,
      onFileChange: (path, content) => {
        if (content) {
          ctx.lspManagerRef.current.notifyChange(path, content);
        } else {
          void import("node:fs/promises").then(({ readFile }) =>
            readFile(path, "utf8")
              .then((c) => ctx.lspManagerRef.current.notifyChange(path, c))
              .catch((err) => ctx.safeSave("lspNotify", Promise.reject(err))),
          );
        }
      },
      callbacks,
    },
    {
      onDone: async () => {
        await ctx.saveSessionSafe();

        // If the turn was killed (preempted or aborted), skip expensive
        // post-turn work so the next turn can start immediately.
        if (turnScope.signal.aborted) {
          cleanupTurn();
          return;
        }

        // Auto-compact after turn when thresholds are met. With compiled
        // context on, use the heuristic compactor; otherwise fall back to the
        // LLM summarizer so users have a safety net regardless of the flag.
        if (shouldCompact({ messages: ctx.messagesRef.current })) {
          if (ctx.compiledContextRef.current) {
            const store = ctx.artifactStoreRef.current;
            const result = compactCompiled({
              messages: ctx.messagesRef.current,
              state: ctx.sessionStateRef.current,
              store,
            });
            if (result.metrics.rawTurnsRemoved > 0) {
              ctx.messagesRef.current = result.newMessages;
              ctx.sessionStateRef.current = result.newState;
              ctx.setEvents((e) => [
                ...e,
                {
                  kind: "info",
                  key: ctx.mkKey(),
                  text: `auto-compacted: ${result.metrics.estimatedTokensBefore} → ${result.metrics.estimatedTokensAfter} tokens (${result.metrics.archivedArtifacts} artifacts)`,
                },
              ]);
              await ctx.saveSessionSafe();
            }
          } else {
            try {
              const result = await compactMessages({
                accountId: ctx.cfg!.accountId,
                apiToken: ctx.cfg!.apiToken,
                model: ctx.cfg!.model,
                messages: ctx.messagesRef.current,
                signal: turnScope.signal,
                gateway: gatewayFromConfig(ctx.cfg!),
              });
              if (result.replacedCount > 0) {
                ctx.messagesRef.current = result.newMessages;
                ctx.setEvents((e) => [
                  ...e,
                  {
                    kind: "info",
                    key: ctx.mkKey(),
                    text: `auto-compacted: ${result.replacedCount} messages summarized`,
                  },
                ]);
                await ctx.saveSessionSafe();
              }
            } catch (compactErr) {
              if ((compactErr as Error).name !== "AbortError") {
                ctx.setEvents((es) => [
                  ...es,
                  {
                    kind: "info",
                    key: ctx.mkKey(),
                    text: `auto-compact failed: ${(compactErr as Error).message ?? String(compactErr)}`,
                  },
                ]);
              }
            }
          }
        }

        // After compaction, recall memories so the model retains durable anchors
        const manager = ctx.memoryManagerRef.current;
        if (manager) {
          try {
            const cwd = process.cwd();
            const queryText = ctx.sessionStateRef.current.task || cwd;
            const results = await manager.recall({
              text: queryText,
              repoPath: cwd,
              limit: 5,
            });
            if (results.length > 0) {
              const text = await manager.synthesizeRecalled(results);
              const lastSystemIdx = ctx.messagesRef.current.findLastIndex(
                (m) => m.role === "system",
              );
              const insertIdx =
                lastSystemIdx >= 0
                  ? lastSystemIdx + 1
                  : ctx.messagesRef.current.length;
              ctx.messagesRef.current.splice(insertIdx, 0, {
                role: "system",
                content: text,
              });
              ctx.setEvents((e) => [
                ...e,
                {
                  kind: "memory",
                  key: ctx.mkKey(),
                  text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} after compaction`,
                },
              ]);
              await ctx.saveSessionSafe();
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
          const did =
            ctx.cloudDeviceId ?? ctx.initialCloudDeviceId ?? undefined;
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
          const isInvalidJson400 =
            e instanceof KimiApiError &&
            e.httpStatus === 400 &&
            e.message.includes("invalid escaped character");
          if (isInvalidJson400) {
            ctx.messagesRef.current.pop();
            ctx.setEvents((es) => [
              ...es,
              {
                kind: "error",
                key: ctx.mkKey(),
                text: "API rejected request (invalid JSON in conversation history). Retrying may work; run /clear to reset if it persists.",
              },
            ]);
          } else {
            ctx.setEvents((es) => [
              ...es,
              { kind: "error", key: ctx.mkKey(), text: e.message ?? String(e) },
            ]);
          }
        }
        cleanupTurn();
      },
    },
  );
}

export interface SubmitCtx {
  busyRef: React.MutableRefObject<boolean>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  isAbortingRef: React.MutableRefObject<boolean>;
  supervisorRef: React.MutableRefObject<TurnSupervisor>;
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  mkKey: () => string;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setTasksStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTasksStartTokens: React.Dispatch<React.SetStateAction<number>>;
  tasksRef: React.MutableRefObject<Task[]>;
  setQueue: React.Dispatch<
    React.SetStateAction<Array<{ full: string; display: string; key: string }>>
  >;
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
  history: string[];
  draftInput: string;
  processMessage: (
    full: string,
    display?: string,
    opts?: { queuedKey?: string },
  ) => Promise<void>;
}

export function submitFn(ctx: SubmitCtx, full: string, display?: string): void {
  const trimmedFull = full.trim();
  if (!trimmedFull) return;
  const trimmedDisplay = (display ?? full).trim() || trimmedFull;

  const historyEntry = trimmedDisplay;

  if (ctx.busyRef.current) {
    // Preempt current turn so user input is not blocked indefinitely
    if (ctx.activeScopeRef.current && !ctx.isAbortingRef.current) {
      ctx.isAbortingRef.current = true;
      ctx.supervisorRef.current.killTurn();
      ctx.activeScopeRef.current.abort("new_message");
      ctx.setEvents((e) => [
        ...e,
        { kind: "info", key: ctx.mkKey(), text: "(preempted)" },
      ]);
      // Clear task list immediately so it doesn't keep spinning
      ctx.setTasks([]);
      ctx.setTasksStartedAt(null);
      ctx.setTasksStartTokens(0);
      ctx.tasksRef.current = [];
    }
    const key = ctx.mkKey();
    ctx.setEvents((e) => [
      ...e,
      { kind: "user", key, text: trimmedDisplay, queued: true },
    ]);
    ctx.setQueue((q) => [
      ...q,
      { full: trimmedFull, display: trimmedDisplay, key },
    ]);
    ctx.setHistory((h) =>
      h.length > 0 && h[h.length - 1] === historyEntry
        ? h
        : [...h, historyEntry],
    );
    ctx.setInput("");
    ctx.setHistoryIndex(-1);
    return;
  }

  ctx.setHistory((h) =>
    h.length > 0 && h[h.length - 1] === historyEntry ? h : [...h, historyEntry],
  );
  ctx.setInput("");
  ctx.setHistoryIndex(-1);
  ctx.processMessage(
    trimmedFull,
    trimmedDisplay !== trimmedFull ? trimmedDisplay : undefined,
  );
}
