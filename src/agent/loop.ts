import { runKimi } from "./client.js";
import type { AiGatewayOptions, GatewayMeta } from "./client.js";
import { toOpenAIToolDefs, type ToolSpec } from "../tools/registry.js";
import type { ToolExecutor, PermissionAsker, ToolResult } from "../tools/executor.js";
import { sanitizeString, stableStringify, stripOldImages } from "./messages.js";
import type { ChatMessage, ToolCall, Usage } from "./messages.js";
import type { Task } from "../tools/registry.js";
import type { MemoryManager } from "../memory/manager.js";
import type { HybridResult } from "../memory/schema.js";
import { logTurnDebug, analyzePrompt } from "../cost-debug.js";
import { EXTRACTORS } from "../memory/extractors.js";
import { stripHistoricalReasoning } from "./strip-reasoning.js";
import { generateTypeScriptApi, runInSandbox } from "../code-mode/index.js";
import { estimatePromptTokens } from "./artifact-compaction.js";
import { logger } from "../util/logger.js";
import { selectSkills } from "../skills/router.js";
import type { SemanticSkillRoutingResult } from "../skills/types.js";
import type Database from "better-sqlite3";
import { buildSystemPrompt, buildSessionPrefix } from "./system-prompt.js";
import { getModelOrInfer } from "../models/registry.js";
import type { Mode } from "../mode.js";

export interface AgentCallbacks {
  onAssistantStart?: () => void;
  onReasoningDelta?: (text: string) => void;
  onTextDelta?: (text: string) => void;
  onToolCallStart?: (index: number, id: string, name: string) => void;
  onToolCallArgs?: (index: number, delta: string) => void;
  onToolCallFinalized?: (call: ToolCall) => void;
  /** Called right before a tool call is handed to the executor for actual execution.
   *  Fires after onToolCallFinalized, one at a time, as tools are dequeued. */
  onToolWillExecute?: (toolCallId: string, name: string) => void;
  onUsage?: (usage: Usage) => void;
  onUsageFinal?: (usage: Usage, gatewayMeta?: GatewayMeta) => void;
  onGatewayMeta?: (meta: GatewayMeta) => void;
  onAssistantFinal?: (msg: ChatMessage) => void;
  onToolResult?: (result: ToolResult) => void;
  onTasks?: (tasks: Task[]) => void;
  /** Called once per session when the sandbox falls back to node:vm. */
  onWarning?: (message: string) => void;
  /** Called when a tool's content was truncated before being shown to the model.
   *  `artifactId`, when present, points at the full raw bytes in the artifact store. */
  onTruncation?: (info: { tool: string; toolCallId: string; rawBytes: number; reducedBytes: number; artifactId?: string }) => void;
  askPermission: PermissionAsker;
  /** Called when the tool-call iteration limit is reached. Return "continue" to
   *  reset the counter and keep going, or "stop" to end the turn immediately. */
  onToolLimitReached?: () => Promise<"continue" | "stop">;
  /** Called when the agent is detected repeating identical tool calls (loop). Return "continue" to
   *  reset the guardrail and keep going, "synthesize" to ask the agent to conclude without tools,
   *  or "stop" to end the turn immediately. */
  onLoopDetected?: () => Promise<"continue" | "stop" | "synthesize">;
  /** Called when accumulated high-signal memories suggest KIMI.md may be stale. */
  onKimiMdStale?: () => void;
  /** Called when session-start memory recall succeeds and memories are injected. */
  onMemoryRecalled?: (count: number) => void;
  /** Called when semantic skill routing completes. */
  onSkillsSelected?: (result: SemanticSkillRoutingResult) => void;
  /** Called after pre-turn setup (memory + skills) to emit the meta banner. */
  onMetaBanner?: (info: { intentTier: string; skillsActive: number; memoryRecalled: boolean }) => void;
}

export interface AgentTurnOpts {
  accountId: string;
  apiToken: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  executor: ToolExecutor;
  cwd: string;
  signal: AbortSignal;
  callbacks: AgentCallbacks;
  maxToolIterations?: number;
  temperature?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  coauthor?: { name: string; email: string };
  sessionId?: string;
  githubToken?: string;
  gateway?: AiGatewayOptions;
  /** Drop image_url parts from user messages older than this many turns. */
  keepLastImageTurns?: number;
  memoryManager?: MemoryManager | null;
  /** Enable Code Mode: present tools as a TypeScript API and execute generated code in a sandbox. */
  codeMode?: boolean;
  /** Called after write/edit tools succeed so LSP document sync can fire. */
  onFileChange?: (path: string, content: string) => void;
  /** When true, hitting the tool-call limit resets the counter and appends a continue message instead of throwing. */
  continueOnLimit?: boolean;
  /** Cumulative prompt token budget. When exceeded, a final synthesis turn is run and then BudgetExhaustedError is thrown. */
  maxInputTokens?: number;
  /** Intent classification result for this turn, for telemetry. */
  intentClassification?: { intent: string; tier: "light" | "medium" | "heavy"; rawScore: number; confidence: number };
  /** Skills injected into the system prompt for this turn. */
  selectedSkills?: { name: string; body: string }[];
  /**
   * M6.1: lifecycle hooks for events the loop owns (`Stop` at clean
   * turn end). PreToolUse / PostToolUse hooks live on the
   * `ToolExecutor` itself, so they fire for every executor caller
   * (standard loop, code-mode sandbox, init, SDK, print mode)
   * automatically — no need to thread `hooks` through to those.
   */
  hooks?: import("../hooks/manager.js").HooksManager;
  /** Called after each tool-iteration cycle to allow external compaction or state management.
   *  Return the (possibly mutated) messages array. */
  onIterationEnd?: (messages: ChatMessage[], signal: AbortSignal) => Promise<ChatMessage[]>;
  cloudMode?: boolean;
  cloudToken?: string;
  cloudDeviceId?: string;
  /** Per-provider API keys (BYOK) forwarded to AI Gateway. */
  providerKeys?: Partial<Record<"workers-ai" | "anthropic" | "openai" | "google" | "openai-compatible", string>>;
  /** Per-provider alias names referencing CF Secrets Store entries (fire-and-forget BYOK). */
  providerKeyAliases?: Partial<Record<"workers-ai" | "anthropic" | "openai" | "google" | "openai-compatible", string>>;
  /** Whether to use Cloudflare Unified Billing for models that support it. */
  unifiedBilling?: boolean;
  /** Shell override for the bash tool. If omitted, the tool auto-detects based on platform. */
  shell?: string;
  /** Session-start memory recall promise. If provided, awaited at turn start and injected into messages. */
  sessionStartRecall?: Promise<HybridResult[]>;
  /** Skills DB for semantic skill routing. */
  skillsDb?: Database.Database;
  /** Config for skill routing. */
  skillRoutingConfig?: {
    accountId: string;
    apiToken: string;
    embeddingModel?: string;
    gateway?: AiGatewayOptions;
    cloudMode?: boolean;
    cloudToken?: string;
    cloudDeviceId?: string;
    maxSkillTokens?: number;
  };
  /** Current mode for system prompt. */
  mode?: Mode;
  /** Whether to use cache-stable prompt assembly (dual system messages). */
  cacheStable?: boolean;
  /** Abort the API stream if no data arrives for this many milliseconds. Default 60000.
   *  Cold Workers AI calls after tool use can exceed the default — bump this for
   *  long-running embeddings / image-heavy turns. */
  idleTimeoutMs?: number;
  /** Once the first byte arrives, tighten the idle timeout to this value.
   *  Default 30000 — a live stream stalling mid-flight should surface fast. */
  postFirstByteIdleTimeoutMs?: number;
}

export class BudgetExhaustedError extends Error {
  constructor(message = "Cumulative input token budget exhausted") {
    super(message);
    this.name = "BudgetExhaustedError";
  }
}

export class AgentLoopError extends Error {
  constructor(message = "Agent got stuck repeating the same tool calls") {
    super(message);
    this.name = "AgentLoopError";
  }
}

const codeModeApiCache = new Map<string, string>();

/** Per-session sliding window of turn indices where a high-signal memory landed.
 *  We fire `onKimiMdStale` when >=DRIFT_THRESHOLD events fall inside
 *  DRIFT_WINDOW recent turns. Replaces the older count-with-decay scheme
 *  which almost never fired on long sessions (RF-2 / OP-8). */
const driftEvents = new Map<string, number[]>();
const DRIFT_WINDOW = 10;
const DRIFT_THRESHOLD = 3;

export function _resetDriftEventsForTests(): void {
  driftEvents.clear();
}

/** Per-session count of fire-and-forget memory-extraction errors. Exposed via
 *  `getMemoryExtractionErrorCount` for a future `/memory health` surface. */
const memoryExtractionErrorCounts = new Map<string, number>();

export function getMemoryExtractionErrorCount(sessionId: string | undefined): number {
  return memoryExtractionErrorCounts.get(sessionId ?? "default") ?? 0;
}

export function _resetMemoryExtractionErrorCountsForTests(): void {
  memoryExtractionErrorCounts.clear();
}

/** Per-session web-fetch history. Lifted from per-turn so a research spiral
 *  split across multiple turns still trips the guardrail. */
const sessionWebFetchHistory = new Map<string, { url: string; domain: string }[]>();
/** Hard soft-cap of total web fetches per session before we nudge for synthesis. */
const SESSION_WEB_FETCH_CAP = 25;

function getSessionWebFetchHistory(sessionId: string | undefined): { url: string; domain: string }[] {
  const key = sessionId ?? "default";
  let arr = sessionWebFetchHistory.get(key);
  if (!arr) {
    arr = [];
    sessionWebFetchHistory.set(key, arr);
  }
  return arr;
}

/** Test/embed hook: clears session web-fetch state. Not exported in the public API. */
export function _resetSessionWebFetchHistoryForTests(): void {
  sessionWebFetchHistory.clear();
}

function isHighSignalMemory(memory: {
  topicKey: string;
  category: string;
  importance: number;
}): boolean {
  return (
    memory.topicKey === "project_dependencies" ||
    memory.topicKey === "project_tsconfig" ||
    memory.topicKey === "project_entry_point" ||
    memory.category === "instruction" ||
    memory.category === "preference" ||
    (memory.category === "event" && memory.importance >= 3)
  );
}

/** Fraction of the model's context window we'll let the prompt occupy before
 *  refusing the call. Leaves headroom for the response. */
const PROMPT_TOKEN_SOFT_LIMIT_RATIO = 0.92;

/** Max characters for a single tool result message before truncation.
 *  ~10k chars ≈ 2,500 tokens — generous but prevents runaway growth. */
const MAX_TOOL_CONTENT_CHARS = 10_000;

function extractLastUserText(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  if (typeof lastUser.content === "string") return lastUser.content;
  if (Array.isArray(lastUser.content)) {
    return lastUser.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
      } else {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }
    }),
  ]);
}

export async function runAgentTurn(opts: AgentTurnOpts): Promise<void> {
  const turnStart = performance.now();
  logger.info("turn:start", { sessionId: opts.sessionId, codeMode: opts.codeMode ?? false });
  const max = opts.maxToolIterations ?? 50;
  const codeMode = opts.codeMode ?? false;

  // M6.1: fire the Stop hook on any clean exit (turn ended normally,
  // user opted to stop on loop/limit). Skipped on abort/throw because
  // those aren't "the agent finished its turn." Inline at each return
  // site below — three of them in this function.
  const fireStopHook = async (): Promise<void> => {
    if (opts.signal.aborted) return;
    if (!opts.hooks?.hasEnabledHooks("Stop")) return;
    try {
      await opts.hooks.fire(
        "Stop",
        { event: "Stop", session_id: opts.sessionId ?? null, cwd: opts.cwd },
        null,
      );
    } catch {
      // best-effort — must not crash turn cleanup
    }
  };

  // --- Pre-turn async work (memory recall + skill routing, in parallel) ---
  const preTurnStart = performance.now();
  let memoryRecalledCount = 0;
  let skillResult: SemanticSkillRoutingResult | undefined;

  const lastUserPrompt = extractLastUserText(opts.messages);
  const userPromptPreview = lastUserPrompt.slice(0, 200);

  // Light + trivially short prompts skip skill routing entirely. These almost
  // never benefit from injected skills and the embeddings round-trip dominates
  // their wall-clock time. Threshold is conservative — anything substantive
  // crosses 40 chars quickly.
  const skipSkillRouting =
    opts.intentClassification?.tier === "light" &&
    lastUserPrompt.length < 40;

  const recallPromise: Promise<{ text: string; count: number } | null> =
    opts.sessionStartRecall && opts.memoryManager
      ? (async () => {
          const results = await opts.sessionStartRecall!;
          if (results.length === 0 || !opts.memoryManager) return null;
          const text = await opts.memoryManager.synthesizeRecalled(results, opts.signal);
          return { text, count: results.length };
        })()
      : Promise.resolve(null);

  const skillsPromise: Promise<SemanticSkillRoutingResult | undefined> =
    opts.skillsDb && opts.skillRoutingConfig && opts.intentClassification && lastUserPrompt && !skipSkillRouting
      ? selectSkills(
          {
            prompt: lastUserPrompt,
            tier: opts.intentClassification.tier,
            maxSkillTokens: opts.skillRoutingConfig.maxSkillTokens ?? 250_000 - 10_000,
          },
          {
            db: opts.skillsDb,
            accountId: opts.skillRoutingConfig.accountId,
            apiToken: opts.skillRoutingConfig.apiToken,
            embeddingModel: opts.skillRoutingConfig.embeddingModel,
            gateway: opts.skillRoutingConfig.gateway,
            cloudMode: opts.skillRoutingConfig.cloudMode,
            cloudToken: opts.skillRoutingConfig.cloudToken,
            cloudDeviceId: opts.skillRoutingConfig.cloudDeviceId,
          },
        )
      : Promise.resolve(undefined);

  const [recallSettled, skillsSettled] = await Promise.allSettled([
    raceWithSignal(recallPromise, opts.signal),
    raceWithSignal(skillsPromise, opts.signal),
  ]);

  // Propagate abort; swallow other failures (both paths are non-fatal).
  for (const settled of [recallSettled, skillsSettled]) {
    if (
      settled.status === "rejected" &&
      settled.reason instanceof DOMException &&
      settled.reason.name === "AbortError"
    ) {
      throw settled.reason;
    }
  }

  if (recallSettled.status === "fulfilled" && recallSettled.value) {
    const { text, count } = recallSettled.value;
    const lastSystemIdx = opts.messages.findLastIndex((m) => m.role === "system");
    const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : opts.messages.length;
    opts.messages.splice(insertIdx, 0, { role: "system", content: text });
    memoryRecalledCount = count;
    opts.callbacks.onMemoryRecalled?.(count);
  }

  if (skillsSettled.status === "fulfilled" && skillsSettled.value) {
    skillResult = skillsSettled.value;
    opts.callbacks.onSkillsSelected?.(skillResult);

    const allTools = opts.tools;
    if (opts.cacheStable) {
      opts.messages[1] = {
        role: "system",
        content: buildSessionPrefix({
          cwd: opts.cwd,
          tools: allTools,
          model: opts.model,
          mode: opts.mode,
          skillContext: skillResult.skillContext,
        }),
      };
    } else {
      opts.messages[0] = {
        role: "system",
        content: buildSystemPrompt({
          cwd: opts.cwd,
          tools: allTools,
          model: opts.model,
          mode: opts.mode,
          skillContext: skillResult.skillContext,
        }),
      };
    }
  }

  if (opts.signal.aborted) {
    throw new DOMException("aborted", "AbortError");
  }

  const preTurnMs = Math.round(performance.now() - preTurnStart);

  opts.callbacks.onMetaBanner?.({
    intentTier: opts.intentClassification?.tier ?? "medium",
    skillsActive: skillResult?.sectionCount ?? 0,
    memoryRecalled: memoryRecalledCount > 0,
  });

  let toolDefs: ReturnType<typeof toOpenAIToolDefs>;
  let codeModeApiString = "";

  if (codeMode) {
    const toolsKey = stableStringify(opts.tools);
    const cached = codeModeApiCache.get(toolsKey);
    if (cached) {
      codeModeApiString = cached;
    } else {
      codeModeApiString = generateTypeScriptApi(opts.tools);
      codeModeApiCache.set(toolsKey, codeModeApiString);
    }
    toolDefs = [
      {
        type: "function",
        function: {
          name: "execute_code",
          description:
            `Write and execute TypeScript code to accomplish your task.\n\n` +
            `Available APIs:\n${codeModeApiString}\n\n` +
            `Use console.log() to return results. Only console.log output will be sent back to you.`,
          parameters: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "TypeScript code to execute. Use the api object to call available tools.",
              },
              reasoning: {
                type: "string",
                description: "Brief reasoning about what the code does.",
              },
            },
            required: ["code"],
            additionalProperties: false,
          },
        },
      },
    ];
  } else {
    toolDefs = toOpenAIToolDefs(opts.tools);
  }

  let turn = 0;
  let lastUsage: Usage | null = null;

  // Anti-loop guardrail: track recent tool call signatures to detect thrashing
  const recentToolCalls: string[] = [];
  const LOOP_WINDOW = 8;
  const LOOP_THRESHOLD = 2; // 3rd identical call triggers the guardrail

  // Web-fetch anti-loop: domain counts and the total now span the session,
  // so a research spiral split across turns still trips the guardrail.
  // (RF-3 / OP-6.) The per-turn ceiling stays in place for hot-path bursts.
  const webFetchHistory = getSessionWebFetchHistory(opts.sessionId);
  let webFetchesThisTurn = 0;
  const MAX_WEB_FETCH_PER_TURN = 5;
  const WEB_FETCH_DOMAIN_THRESHOLD = 2; // 3rd fetch to same domain triggers warning

  let cumulativePromptTokens = 0;
  let iter = 0;
  let budgetExhausted = false;
  let loopExhausted = false;

  while (true) {
    // Budget enforcement: before starting a new turn, if we've already hit the
    // limit, run one final synthesis turn and then signal budget exhaustion.
    if (budgetExhausted) {
      opts.messages.push({
        role: "system",
        content:
          "You have reached the cumulative input token budget for this session. " +
          "Please synthesize your findings and provide a final summary of what was accomplished.",
      });
    }

    if (loopExhausted) {
      opts.messages.push({
        role: "system",
        content:
          "You have repeatedly called the same tools with identical arguments and are stuck in a loop. " +
          "Please synthesize what you know from the conversation history and provide a final answer.",
      });
    }

    if (iter >= max) {
      if (opts.callbacks.onToolLimitReached) {
        const decision = await opts.callbacks.onToolLimitReached();
        if (decision === "continue") {
          opts.messages.push({
            role: "system",
            content:
              "You have reached the tool-call limit for this session. " +
              "The counter has been reset so you can continue working. Please proceed with your task.",
          });
          iter = 0;
        } else {
          await fireStopHook();
          return;
        }
      } else if (opts.continueOnLimit) {
        opts.messages.push({
          role: "system",
          content:
            "You have reached the tool-call limit for this session. " +
            "The counter has been reset so you can continue working. Please proceed with your task.",
        });
        iter = 0;
      } else {
        throw new Error(`kimiflare: tool iteration limit reached (${max})`);
      }
    }

    iter++;
    turn++;
    const previousMessages = opts.messages.slice();
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let content = "";
    let reasoning = "";
    let gatewayMeta: GatewayMeta | undefined;
    opts.callbacks.onAssistantStart?.();

    const stripReasoning = process.env.KIMIFLARE_STRIP_REASONING === "1";
    const shadowStrip = process.env.KIMIFLARE_SHADOW_STRIP === "1";
    const keepLastRaw = process.env.KIMIFLARE_REASONING_KEEP_LAST;
    const keepLast = keepLastRaw ? parseInt(keepLastRaw, 10) : 1;

    let apiMessages = opts.messages;
    let shadowStripMetrics:
      | { originalApproxTokens: number; strippedApproxTokens: number; savingsPct: number }
      | undefined;

    if (stripReasoning || shadowStrip) {
      const stripped = stripHistoricalReasoning(opts.messages, {
        keepLast: Number.isNaN(keepLast) ? 1 : keepLast,
      });
      if (shadowStrip) {
        const originalSections = analyzePrompt(opts.messages);
        const strippedSections = analyzePrompt(stripped);
        const originalApproxTokens = originalSections.reduce(
          (sum, s) => sum + s.approxTokens,
          0,
        );
        const strippedApproxTokens = strippedSections.reduce(
          (sum, s) => sum + s.approxTokens,
          0,
        );
        shadowStripMetrics = {
          originalApproxTokens,
          strippedApproxTokens,
          savingsPct:
            originalApproxTokens > 0
              ? Math.round(
                  ((originalApproxTokens - strippedApproxTokens) / originalApproxTokens) * 100,
                )
              : 0,
        };
      }
      if (stripReasoning) {
        apiMessages = stripped;
      }
    }

    if (opts.keepLastImageTurns !== undefined) {
      apiMessages = stripOldImages(apiMessages, opts.keepLastImageTurns);
    }

    const promptTokens = estimatePromptTokens(apiMessages);
    const ctxWindow = getModelOrInfer(opts.model).contextWindow;
    const maxPromptTokens = Math.floor(ctxWindow * PROMPT_TOKEN_SOFT_LIMIT_RATIO);
    if (promptTokens > maxPromptTokens) {
      throw new Error(
        `kimiflare: context window exceeded (~${promptTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} tokens). ` +
          `Run /compact to summarize older turns, or /clear to start fresh.`,
      );
    }

    logger.debug("turn:api_request", { sessionId: opts.sessionId, messageCount: apiMessages.length });
    // Cloudflare AI Gateway caps cf-aig-metadata at 5 keys. Keep the most
    // queryable signals: feature + sessionId for tracing, tier/cm/skl for
    // routing analysis from the dashboard. turnIdx is dropped here (still
    // available in cost-debug.jsonl).
    const turnGateway = opts.gateway
      ? {
          ...opts.gateway,
          metadata: {
            ...(opts.gateway.metadata ?? {}),
            feature: "chat",
            ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
            tier: opts.intentClassification?.tier ?? "medium",
            cm: codeMode ? "1" : "0",
            skl: String(skillResult?.sectionCount ?? 0),
          },
        }
      : undefined;
    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages: apiMessages,
      tools: toolDefs,
      signal: opts.signal,
      temperature: opts.temperature,
      maxCompletionTokens: opts.maxCompletionTokens,
      reasoningEffort: opts.reasoningEffort,
      sessionId: opts.sessionId,
      gateway: turnGateway,
      cloudMode: opts.cloudMode,
      cloudToken: opts.cloudToken,
      cloudDeviceId: opts.cloudDeviceId,
      providerKeys: opts.providerKeys,
      providerKeyAliases: opts.providerKeyAliases,
      unifiedBilling: opts.unifiedBilling,
      idleTimeoutMs: opts.idleTimeoutMs ?? 60_000,
      postFirstByteIdleTimeoutMs: opts.postFirstByteIdleTimeoutMs,
    });

    let gotFirstChunk = false;
    for await (const ev of events) {
      if (!gotFirstChunk) {
        gotFirstChunk = true;
        logger.debug("turn:api_first_chunk", { sessionId: opts.sessionId });
      }
      switch (ev.type) {
        case "gateway_meta":
          gatewayMeta = ev.meta;
          opts.callbacks.onGatewayMeta?.(ev.meta);
          break;
        case "reasoning":
          reasoning += ev.delta;
          opts.callbacks.onReasoningDelta?.(ev.delta);
          break;
        case "text":
          content += ev.delta;
          opts.callbacks.onTextDelta?.(ev.delta);
          break;
        case "tool_call_start":
          opts.callbacks.onToolCallStart?.(ev.index, ev.id, ev.name);
          break;
        case "tool_call_args":
          opts.callbacks.onToolCallArgs?.(ev.index, ev.argsDelta);
          break;
        case "tool_call_complete": {
          const safeArgs = validateToolArguments(ev.arguments);
          const call: ToolCall = {
            id: ev.id,
            type: "function",
            function: { name: ev.name, arguments: safeArgs },
          };
          toolCalls.push(call);
          opts.callbacks.onToolCallFinalized?.(call);
          break;
        }
        case "usage":
          lastUsage = ev.usage;
          opts.callbacks.onUsage?.(ev.usage);
          break;
        case "done":
          break;
      }
    }

    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

    if (lastUsage) {
      opts.callbacks.onUsageFinal?.(lastUsage, gatewayMeta);
      cumulativePromptTokens += lastUsage.prompt_tokens;
      // Flip the budget flag regardless of whether this turn produced tool
      // calls — a long pure-text turn past the cap should still trip the
      // limit. The no-tools branch below short-circuits to BudgetExhaustedError
      // instead of an extra synthesis turn. (RF-5 / OP-9.)
      if (
        !budgetExhausted &&
        opts.maxInputTokens !== undefined &&
        opts.maxInputTokens > 0 &&
        cumulativePromptTokens >= opts.maxInputTokens
      ) {
        budgetExhausted = true;
      }
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: content ? sanitizeString(content) : null,
      ...(reasoning ? { reasoning_content: sanitizeString(reasoning) } : {}),
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((tc) => ({
              ...tc,
              function: {
                name: tc.function.name,
                arguments: sanitizeString(tc.function.arguments),
              },
            })),
          }
        : {}),
    };
    opts.messages.push(assistantMsg);
    opts.callbacks.onAssistantFinal?.(assistantMsg);

    if (toolCalls.length === 0) {
      if (opts.sessionId && lastUsage) {
        void logTurnDebug({
          sessionId: opts.sessionId,
          turn,
          messages: opts.messages,
          previousMessages,
          toolResults,
          usage: lastUsage,
          shadowStrip: shadowStripMetrics,
          durationMs: Math.round(performance.now() - turnStart),
          intentClassification: opts.intentClassification,
          codeMode: opts.codeMode,
          selectedSkills: opts.selectedSkills,
          userPromptPreview,
          preTurnMs,
          memoryRecalled: memoryRecalledCount > 0,
        });
      }
      if (budgetExhausted) {
        throw new BudgetExhaustedError();
      }
      logger.info("turn:complete", { sessionId: opts.sessionId, durationMs: Math.round(performance.now() - turnStart) });
      await fireStopHook();
      return;
    }

    let blockedCount = 0;
    for (const tc of toolCalls) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

      // Anti-loop guardrail
      const loopSignature = `${tc.function.name}:${stableStringify(tc.function.arguments)}`;
      const loopCount = recentToolCalls.filter((s) => s === loopSignature).length;
      if (loopCount >= LOOP_THRESHOLD) {
        const warning = `Loop detected: you have called ${tc.function.name} with the same arguments multiple times in a row. Consider a different approach.`;
        const loopResult: ToolResult = {
          tool_call_id: tc.id,
          name: tc.function.name,
          content: warning,
          ok: false,
        };
        toolResults.push(loopResult);
        opts.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: sanitizeString(warning),
          name: tc.function.name,
        });
        opts.callbacks.onToolResult?.(loopResult);
        recentToolCalls.push(loopSignature);
        if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
        blockedCount++;
        continue;
      }

      // Web-fetch spiral guardrail
      if (tc.function.name === "web_fetch") {
        const args = JSON.parse(tc.function.arguments || "{}") as { url?: string };
        const url = args.url || "";
        try {
          const domain = new URL(url).hostname;
          const domainCount = webFetchHistory.filter((h) => h.domain === domain).length;
          const totalSessionFetches = webFetchHistory.length;

          if (webFetchesThisTurn >= MAX_WEB_FETCH_PER_TURN) {
            const warning = `Research budget exceeded: you have already made ${MAX_WEB_FETCH_PER_TURN} web requests this turn. Synthesize what you have learned instead of fetching more pages.`;
            const budgetResult: ToolResult = {
              tool_call_id: tc.id,
              name: "web_fetch",
              content: warning,
              ok: false,
            };
            toolResults.push(budgetResult);
            opts.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: sanitizeString(warning),
              name: "web_fetch",
            });
            opts.callbacks.onToolResult?.(budgetResult);
            recentToolCalls.push(loopSignature);
            if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
            blockedCount++;
            continue;
          }

          if (totalSessionFetches >= SESSION_WEB_FETCH_CAP) {
            const warning = `Session research budget exceeded: ${totalSessionFetches} web fetches across this session. Synthesize what you have learned from prior fetches instead of starting another page.`;
            const sessionCapResult: ToolResult = {
              tool_call_id: tc.id,
              name: "web_fetch",
              content: warning,
              ok: false,
            };
            toolResults.push(sessionCapResult);
            opts.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: sanitizeString(warning),
              name: "web_fetch",
            });
            opts.callbacks.onToolResult?.(sessionCapResult);
            recentToolCalls.push(loopSignature);
            if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
            blockedCount++;
            continue;
          }

          if (domainCount >= WEB_FETCH_DOMAIN_THRESHOLD) {
            const warning = `Loop detected: you have fetched from ${domain} multiple times. Consider a different approach or synthesize existing findings.`;
            const loopResult: ToolResult = {
              tool_call_id: tc.id,
              name: "web_fetch",
              content: warning,
              ok: false,
            };
            toolResults.push(loopResult);
            opts.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: sanitizeString(warning),
              name: "web_fetch",
            });
            opts.callbacks.onToolResult?.(loopResult);
            recentToolCalls.push(loopSignature);
            if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
            blockedCount++;
            continue;
          }

          webFetchHistory.push({ url, domain });
          webFetchesThisTurn++;
        } catch {
          // Invalid URL, let it fail normally
        }
      }

      if (codeMode && tc.function.name === "execute_code") {
        const args = JSON.parse(tc.function.arguments || "{}") as { code?: string; reasoning?: string };
        const code = args.code || "";

        const sandboxResult = await runInSandbox({
          code,
          tools: opts.tools,
          executor: opts.executor,
          askPermission: opts.callbacks.askPermission,
          ctx: { cwd: opts.cwd, signal: opts.signal, onTasks: opts.callbacks.onTasks, coauthor: opts.coauthor, memoryManager: opts.memoryManager, sessionId: opts.sessionId, githubToken: opts.githubToken },
          timeoutMs: 30000,
          memoryLimitMB: 128,
        });

        // Emit individual tool results from inside the script
        for (const stc of sandboxResult.toolCalls) {
          const toolResult: ToolResult = {
            tool_call_id: tc.id,
            name: stc.name,
            content: stc.result,
            ok: true,
          };
          toolResults.push(toolResult);
          opts.callbacks.onToolResult?.(toolResult);
        }

        // Surface sandbox warnings (e.g. isolated-vm fallback) as a separate UI notice
        if (sandboxResult.warnings && sandboxResult.warnings.length > 0) {
          for (const w of sandboxResult.warnings) {
            opts.callbacks.onWarning?.(w);
          }
        }

        let resultContent = sandboxResult.error
          ? `Error: ${sandboxResult.error}\n\nOutput:\n${sandboxResult.output}`
          : sandboxResult.output;
        if (resultContent.length > MAX_TOOL_CONTENT_CHARS) {
          const rawBytes = resultContent.length;
          resultContent =
            resultContent.slice(0, MAX_TOOL_CONTENT_CHARS) +
            `\n\n[truncated: ${rawBytes - MAX_TOOL_CONTENT_CHARS} chars omitted]`;
          opts.callbacks.onTruncation?.({
            tool: "execute_code",
            toolCallId: tc.id,
            rawBytes,
            reducedBytes: resultContent.length,
          });
        }

        const result: ToolResult = {
          tool_call_id: tc.id,
          name: "execute_code",
          content: resultContent,
          ok: !sandboxResult.error,
        };
        toolResults.push(result);
        opts.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: sanitizeString(resultContent),
          name: "execute_code",
        });
        opts.callbacks.onToolResult?.(result);
        recentToolCalls.push(loopSignature);
        if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
      } else {
        opts.callbacks.onToolWillExecute?.(tc.id, tc.function.name);
        logger.debug("turn:tool_start", { sessionId: opts.sessionId, tool: tc.function.name, toolCallId: tc.id });

        // M6.1: PreToolUse / PostToolUse fire inside `executor.run`
        // (see src/tools/executor.ts). The executor owns them so every
        // caller — standard loop, code-mode sandbox, init turn, SDK,
        // CLI print mode — gets the same behavior automatically.
        // A vetoed PreToolUse returns a synthetic policy_rejection
        // ToolResult; the loop treats it the same as any other failed
        // call (pushes the rejection text as a tool message so the
        // model sees the reason).
        const result = await opts.executor.run(
          { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
          opts.callbacks.askPermission,
          {
            cwd: opts.cwd,
            signal: opts.signal,
            onTasks: opts.callbacks.onTasks,
            coauthor: opts.coauthor,
            memoryManager: opts.memoryManager,
            sessionId: opts.sessionId,
            githubToken: opts.githubToken,
            shell: opts.shell,
            intentTier: opts.intentClassification?.tier,
          },
          opts.onFileChange,
        );
        if (!result.ok && result.errorCode === "policy_rejection") {
          logger.warn("hook:vetoed_tool_call", {
            sessionId: opts.sessionId,
            tool: tc.function.name,
            toolCallId: tc.id,
          });
        }
        let content = result.content;
        if (content.length > MAX_TOOL_CONTENT_CHARS) {
          const rawBytes = content.length;
          content =
            content.slice(0, MAX_TOOL_CONTENT_CHARS) +
            `\n\n[truncated: ${rawBytes - MAX_TOOL_CONTENT_CHARS} chars omitted]`;
          opts.callbacks.onTruncation?.({
            tool: tc.function.name,
            toolCallId: tc.id,
            rawBytes,
            reducedBytes: content.length,
            artifactId: result.artifactId,
          });
        }
        logger.debug("turn:tool_end", { sessionId: opts.sessionId, tool: tc.function.name, toolCallId: tc.id, ok: result.ok });
        if (!result.ok && result.errorCode) {
          // M2.1: surface the classified failure mode in the structured
          // log so the M5.1 + M5.2 sinks can answer "which tools fail
          // most, and how?" without parsing message strings.
          logger.warn("tool:error_classified", {
            sessionId: opts.sessionId,
            tool: tc.function.name,
            toolCallId: tc.id,
            code: result.errorCode,
            recoverable: result.recoverable,
          });
        }
        toolResults.push(result);
        opts.messages.push({
          role: "tool",
          tool_call_id: result.tool_call_id,
          content: sanitizeString(content),
          name: result.name,
        });
        opts.callbacks.onToolResult?.(result);

        // Auto-extract memories from tool results
        if (opts.memoryManager) {
          let filePath: string | undefined;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
            filePath = toolArgs.path as string | undefined;
          } catch {
            // ignore parse errors
          }

          // Find the preceding assistant message for intent context
          const lastAssistant = [...opts.messages].reverse().find(
            (m) => m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0
          );
          const assistantMessage = lastAssistant?.content ?? "";

          const llmOpts = opts.memoryManager.getExtractionLlmOpts();

          // Capture turn at IIFE creation so the sliding-window drift
          // detector below is anchored to when the memory was extracted,
          // not whatever value `turn` has when the await chain settles.
          const turnAtMemoryCommit = turn;
          for (const extractor of EXTRACTORS) {
            if (extractor.match(tc.function.name, filePath)) {
              void (async () => {
                try {
                  const memory = await extractor.extract(result.content, filePath, {
                    toolArgs: { ...toolArgs, _toolName: tc.function.name },
                    assistantMessage: typeof assistantMessage === "string" ? assistantMessage : "",
                    llmOpts: {
                      ...llmOpts,
                      signal: opts.signal,
                    },
                  });
                  if (memory) {
                    await opts.memoryManager!.remember(
                      memory.content,
                      memory.category,
                      memory.importance,
                      opts.cwd,
                      opts.sessionId ?? "unknown",
                      opts.signal,
                      undefined,
                      memory.topicKey,
                    );

                    // Real-time drift detection — sliding window:
                    // fire `onKimiMdStale` when >=DRIFT_THRESHOLD high-signal
                    // memories land within DRIFT_WINDOW turns. Clustered
                    // changes = drift; spread-out changes = incremental work
                    // and aren't worth nagging about. (RF-2 / OP-8.)
                    if (isHighSignalMemory(memory)) {
                      const sid = opts.sessionId ?? "default";
                      const events = driftEvents.get(sid) ?? [];
                      events.push(turnAtMemoryCommit);
                      const cutoff = turnAtMemoryCommit - DRIFT_WINDOW + 1;
                      const recent = events.filter((t) => t >= cutoff);
                      driftEvents.set(sid, recent);
                      if (recent.length >= DRIFT_THRESHOLD) {
                        // Wrapped defensively: a throwing callback inside
                        // this fire-and-forget IIFE would become an
                        // unhandled rejection (process-fatal under Node's
                        // default --unhandled-rejections=throw).
                        try {
                          opts.callbacks.onKimiMdStale?.();
                        } catch (cbErr) {
                          logger.debug("memory:onKimiMdStale_threw", {
                            sessionId: opts.sessionId,
                            error: cbErr instanceof Error ? cbErr.message : String(cbErr),
                          });
                        }
                        driftEvents.set(sid, []);
                      }
                    }
                  }
                } catch (err) {
                  // Auto-extraction must never break the turn, but a silent
                  // swallow hides systemic failures (bad embedding endpoint,
                  // DB lock, schema mismatch). Track per session and surface
                  // through onWarning so /memory health (and SDK consumers)
                  // can see something is wrong.
                  const sid = opts.sessionId ?? "default";
                  const next = (memoryExtractionErrorCounts.get(sid) ?? 0) + 1;
                  memoryExtractionErrorCounts.set(sid, next);
                  const msg = err instanceof Error ? err.message : String(err);
                  logger.debug("memory:extract_error", {
                    sessionId: opts.sessionId,
                    tool: tc.function.name,
                    count: next,
                    error: msg,
                  });
                  // Only emit the user-visible warning on the first failure
                  // per session — repeated errors stay in the counter.
                  // Wrapped defensively for the same reason as the
                  // onKimiMdStale fire above.
                  if (next === 1) {
                    try {
                      opts.callbacks.onWarning?.(
                        `[memory] auto-extraction failed (${msg}). Subsequent failures will be counted silently; check /memory health.`,
                      );
                    } catch (cbErr) {
                      logger.debug("memory:onWarning_threw", {
                        sessionId: opts.sessionId,
                        error: cbErr instanceof Error ? cbErr.message : String(cbErr),
                      });
                    }
                  }
                }
              })();
            }
          }
        }

        recentToolCalls.push(loopSignature);
        if (recentToolCalls.length > LOOP_WINDOW) recentToolCalls.shift();
      }
    }

    if (blockedCount === toolCalls.length && toolCalls.length > 0) {
      loopExhausted = true;
    }

    // (Drift accumulator decay was removed in OP-8 — drift detection is
    // now a sliding window over recent turns, not a decaying counter.)

    // Allow external compaction / state management between iterations
    if (opts.onIterationEnd) {
      opts.messages = await opts.onIterationEnd(opts.messages, opts.signal);
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
    }

    if (opts.sessionId && lastUsage) {
      void logTurnDebug({
        sessionId: opts.sessionId,
        turn,
        messages: opts.messages,
        previousMessages,
        toolResults,
        usage: lastUsage,
        shadowStrip: shadowStripMetrics,
        durationMs: Math.round(performance.now() - turnStart),
        intentClassification: opts.intentClassification,
        codeMode: opts.codeMode,
        selectedSkills: opts.selectedSkills,
        userPromptPreview,
        preTurnMs,
        memoryRecalled: memoryRecalledCount > 0,
      });
    }

    if (budgetExhausted) {
      throw new BudgetExhaustedError();
    }
    if (loopExhausted) {
      if (opts.callbacks.onLoopDetected) {
        const decision = await opts.callbacks.onLoopDetected();
        if (decision === "continue") {
          opts.messages.push({
            role: "system",
            content:
              "You were stuck calling the same tools with identical arguments. " +
              "The guardrail has been reset so you can continue. Try a different approach.",
          });
          loopExhausted = false;
          recentToolCalls.length = 0;
          continue;
        }
        if (decision === "synthesize") {
          opts.messages.push({
            role: "system",
            content:
              "You were stuck calling the same tools with identical arguments. " +
              "Please synthesize and conclude your findings so far. Do not call any more tools.",
          });
          loopExhausted = false;
          recentToolCalls.length = 0;
          continue;
        }
        await fireStopHook();
        return;
      }
      throw new AgentLoopError();
    }
  }
}

function validateToolArguments(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}
