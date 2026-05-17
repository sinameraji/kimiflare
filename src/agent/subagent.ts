/**
 * Subagent runner — wraps `runAgentTurn` for child agent invocations.
 *
 * The Agent tool calls this via `ctx.runSubagent`. The runner handles:
 *   - Depth and fanout cap enforcement (graceful typed errors when hit).
 *   - Child sessionId convention (`${parent}.sub${idx}`) so existing
 *     telemetry/memory stores partition cleanly.
 *   - AbortScope linkage to the parent turn scope.
 *   - Tool list filtering via subagent presets, intersected with the
 *     parent's mode.
 *   - Permission forwarding to the parent's callback (single UI stream).
 *
 * What the parent sees: a single string — the child's final assistant
 * message. The full child transcript is captured for later persistence
 * as an artifact (wired in a subsequent task).
 *
 * See `docs/plans/m7-subagent-primitive.md`.
 */
import { runAgentTurn, BudgetExhaustedError } from "./loop.js";
import type { AgentTurnOpts, AgentCallbacks } from "./loop.js";
import type { ChatMessage } from "./messages.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolSpec } from "../tools/registry.js";
import { ToolError } from "../tools/tool-error.js";
import { isBlockedInPlanMode, type Mode } from "../mode.js";

/**
 * Pure helper exposed for tests + reuse: compute the tool list a child
 * receives, given the parent's tool list, the chosen subagent type,
 * and the parent's mode. Mode is the OUTER constraint — preset can
 * narrow further but never widen past mode.
 */
export function decideChildTools(
  parentTools: ToolSpec[],
  subagentType: SubagentType,
  parentMode: Mode | undefined,
): ToolSpec[] {
  const modeBlock = parentMode === "plan" ? isBlockedInPlanMode : () => false;
  return filterToolsForSubagent(subagentType, parentTools, modeBlock);
}
import { logger } from "../util/logger.js";
import { recordUsage } from "../usage-tracker.js";
import {
  filterToolsForSubagent,
  getPreset,
  isValidSubagentType,
  type SubagentType,
} from "../subagents/presets.js";

const PER_TURN_FANOUT_CAP = 8;
const PER_SESSION_FANOUT_CAP = 25;
const MAX_DEPTH = 2;

/** Per-session count of subagents spawned. Lives at module scope so it
 *  survives across turns within the same parent session. */
const sessionSubagentCounts = new Map<string, number>();

export function _resetSubagentCountsForTests(): void {
  sessionSubagentCounts.clear();
}

export function getSubagentCount(sessionId: string | undefined): number {
  return sessionSubagentCounts.get(sessionId ?? "default") ?? 0;
}

export interface SubagentArgs {
  description: string;
  prompt: string;
  subagent_type: SubagentType;
  /** Optional plan task ID this subagent is satisfying. Used by the
   *  memory extractor and (eventually) the load-bearing plan tools. */
  task_id?: string;
}

export interface SubagentResult {
  /** Final assistant message from the child, presented to the parent. */
  summary: string;
  /** Full message history of the child turn — used to persist a
   *  transcript artifact on the parent. */
  transcript: ChatMessage[];
  /** Child sessionId so the parent can correlate telemetry. */
  childSessionId: string;
  /** How many tool calls the child made. */
  toolCallCount: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** ID of the transcript artifact stored on the parent's executor
   *  (so the parent model can `expand_artifact` to inspect details).
   *  Omitted when no parent executor is available (rare; SDK case). */
  transcriptArtifactId?: string;
}

function renderTranscript(transcript: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of transcript) {
    if (msg.role === "user" && typeof msg.content === "string") {
      lines.push(`### USER\n${msg.content}`);
    } else if (msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : "";
      const reasoning = msg.reasoning_content ?? "";
      const calls = msg.tool_calls?.map((tc) => `→ ${tc.function.name}(${tc.function.arguments})`).join("\n") ?? "";
      lines.push(
        `### ASSISTANT${reasoning ? `\n[reasoning]\n${reasoning}\n[/reasoning]` : ""}${text ? `\n${text}` : ""}${calls ? `\n${calls}` : ""}`,
      );
    } else if (msg.role === "tool") {
      lines.push(`### TOOL ${msg.name ?? ""}\n${typeof msg.content === "string" ? msg.content : ""}`);
    }
  }
  return lines.join("\n\n");
}

/**
 * Build the closure that the executor passes through `ToolContext.runSubagent`
 * to the `Agent` tool. Captures the parent's API config, model, memory
 * manager, tool list, etc.
 *
 * The child's `AbortSignal` is a fresh controller wired to the parent
 * signal — when the parent aborts (Ctrl+C / supervisor kill / explicit
 * cancel) the child cancels too. When the child completes normally we
 * tear down the listener so we don't leak.
 */
export function makeSubagentRunner(parent: AgentTurnOpts): (args: SubagentArgs) => Promise<SubagentResult> {
  let perTurnCount = 0;
  const depth = parent.subagentDepth ?? 0;
  const parentSessionId = parent.sessionId ?? "default";

  return async function runSubagent(args: SubagentArgs): Promise<SubagentResult> {
    // Validate type.
    if (!isValidSubagentType(args.subagent_type)) {
      throw new ToolError({
        code: "invalid_args",
        message: `Unknown subagent_type "${String(args.subagent_type)}". Valid: general | explore | plan.`,
        suggestion: "use one of: general, explore, plan",
      });
    }
    if (typeof args.prompt !== "string" || args.prompt.trim().length === 0) {
      throw new ToolError({
        code: "invalid_args",
        message: "Agent requires a non-empty `prompt`.",
      });
    }

    // Depth cap.
    if (depth >= MAX_DEPTH) {
      throw new ToolError({
        code: "policy_rejection",
        message: `Subagent depth cap (${MAX_DEPTH}) reached. Children cannot spawn further children beyond depth ${MAX_DEPTH}.`,
        suggestion: "synthesize the child's findings into your own response instead",
      });
    }

    // Atomic check-and-reserve for both fanout caps. We do this as the
    // very first thing after validation — BEFORE any setup or await
    // boundary — so concurrent dispatches from code mode
    // (`Promise.all([Agent(...), Agent(...), ...])`) cannot race past
    // the cap. JS single-thread guarantees the check+increment block
    // is atomic; reserving up-front means future refactors that add an
    // await before setup don't accidentally break the invariant.
    if (perTurnCount >= PER_TURN_FANOUT_CAP) {
      throw new ToolError({
        code: "policy_rejection",
        message: `Per-turn subagent cap (${PER_TURN_FANOUT_CAP}) reached. Synthesize the existing children's reports into your answer.`,
        suggestion: "stop spawning children and write the final answer",
      });
    }
    const sessionCountBefore = sessionSubagentCounts.get(parentSessionId) ?? 0;
    if (sessionCountBefore >= PER_SESSION_FANOUT_CAP) {
      throw new ToolError({
        code: "policy_rejection",
        message: `Per-session subagent cap (${PER_SESSION_FANOUT_CAP}) reached.`,
        suggestion: "wrap up this session and start a new one if you need more child work",
      });
    }
    // Reserve our slot atomically. From here on, even if we abort early,
    // the counters reflect that this dispatch happened.
    const childIdx = perTurnCount;
    perTurnCount++;
    const sessionCount = sessionCountBefore + 1;
    sessionSubagentCounts.set(parentSessionId, sessionCount);

    const preset = getPreset(args.subagent_type);
    const childSessionId = `${parentSessionId}.sub${sessionCount}`;

    // Intersect preset tool filter with mode-imposed blocks.
    const childTools = decideChildTools(parent.tools, args.subagent_type, parent.mode);

    // Build child message history: just the system prompt is owned by
    // `runAgentTurn` (it'll add it). We supply the narrow task prompt.
    const childMessages: ChatMessage[] = [
      { role: "user", content: args.prompt },
    ];

    // Each child gets a fresh executor so its artifact store doesn't
    // pollute the parent's `expand_artifact` view.
    const childExecutor = new ToolExecutor(childTools);

    // Child AbortController wired to the parent's signal so Ctrl+C
    // cascades for free.
    const childAbort = new AbortController();
    const parentAbortListener = () => {
      childAbort.abort(parent.signal.reason ?? "parent_aborted");
    };
    if (parent.signal.aborted) {
      childAbort.abort(parent.signal.reason ?? "parent_already_aborted");
    } else {
      parent.signal.addEventListener("abort", parentAbortListener, { once: true });
    }

    // Narrow callbacks: most are suppressed so we don't spam the parent
    // UI with streaming child reasoning. askPermission flows through
    // unchanged (parent UI handles it). onWarning is forwarded so the
    // user still sees safety-relevant notes. Tool start/result hooks
    // are suppressed in v1; the UI surfaces the child as one
    // collapsible event handled by the Agent tool's `render`.
    let childToolCallCount = 0;
    const childTranscript: ChatMessage[] = childMessages.slice();
    const childCallbacks: AgentCallbacks = {
      askPermission: parent.callbacks.askPermission,
      onWarning: parent.callbacks.onWarning,
      onToolWillExecute: () => {
        childToolCallCount++;
      },
      onAssistantFinal: (msg) => {
        childTranscript.push(msg);
      },
      onToolResult: (result) => {
        childTranscript.push({
          role: "tool",
          tool_call_id: result.tool_call_id,
          content: result.content,
          name: result.name,
        });
      },
      // M7.1: record child token usage with parentSessionId so /cost can
      // roll children under parents. Gateway-side reconciliation is
      // skipped for children in v1 (local cost estimate only).
      onUsageFinal: (usage) => {
        void recordUsage(childSessionId, usage, undefined, { parentSessionId });
      },
    };

    const childOpts: AgentTurnOpts = {
      accountId: parent.accountId,
      apiToken: parent.apiToken,
      model: parent.model,
      messages: childMessages,
      tools: childTools,
      executor: childExecutor,
      cwd: parent.cwd,
      signal: childAbort.signal,
      callbacks: childCallbacks,
      maxToolIterations: preset.maxToolIterations,
      maxInputTokens: preset.maxInputTokens,
      reasoningEffort: preset.defaultReasoningEffort,
      codeMode: preset.defaultCodeMode,
      coauthor: parent.coauthor,
      sessionId: childSessionId,
      parentSessionId,
      subagentDepth: depth + 1,
      githubToken: parent.githubToken,
      gateway: parent.gateway,
      memoryManager: parent.memoryManager,
      skillsDb: parent.skillsDb,
      skillRoutingConfig: parent.skillRoutingConfig,
      mode: parent.mode,
      cloudMode: parent.cloudMode,
      cloudToken: parent.cloudToken,
      cloudDeviceId: parent.cloudDeviceId,
      shell: parent.shell,
      cacheStable: parent.cacheStable,
    };

    logger.info("subagent.start", {
      sessionId: parentSessionId,
      childSessionId,
      type: args.subagent_type,
      depth: depth + 1,
      task_id: args.task_id,
      description: args.description,
      childIdx,
    });

    const startedAt = Date.now();
    try {
      await runAgentTurn(childOpts);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        // Treat as a graceful synthesis — the child's last assistant
        // message is still useful even if budget ran out.
        logger.warn("subagent.budget_exhausted", {
          childSessionId,
          err: e.message,
        });
      } else {
        const err = e as Error;
        logger.warn("subagent.aborted", {
          childSessionId,
          error: err.message ?? String(e),
        });
        throw new ToolError({
          code: "unknown",
          message: `Subagent (${args.subagent_type}) failed: ${err.message ?? String(e)}`,
          cause: e,
        });
      }
    } finally {
      // Detach our listener so we don't leak. If the parent later
      // aborts, the child has already returned so the cascade is moot.
      parent.signal.removeEventListener("abort", parentAbortListener);
    }

    const durationMs = Date.now() - startedAt;

    // The child's final assistant message is the summary the parent sees.
    const lastAssistant = [...childMessages]
      .reverse()
      .find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0);
    const summary =
      lastAssistant && typeof lastAssistant.content === "string"
        ? lastAssistant.content
        : "(subagent produced no final message)";

    // Persist the full transcript on the parent's executor artifact
    // store so the parent model can pull it back via `expand_artifact`.
    // The summary alone is what the parent sees inline; the transcript
    // is the audit trail. Best-effort: if the parent has no artifact
    // store (e.g. SDK consumers using a custom executor), we skip this.
    let transcriptArtifactId: string | undefined;
    try {
      const transcriptText =
        `# Subagent transcript — Agent(${args.subagent_type})\n` +
        `Description: ${args.description}\n` +
        `Child session: ${childSessionId}\n` +
        `Duration: ${durationMs}ms · Tool calls: ${childToolCallCount}\n\n` +
        renderTranscript(childTranscript);
      const exec = parent.executor as unknown as {
        storeArtifact?: (s: string) => string;
      };
      if (typeof exec.storeArtifact === "function") {
        transcriptArtifactId = exec.storeArtifact(transcriptText);
      }
    } catch (e) {
      logger.warn("subagent.transcript_store_failed", {
        childSessionId,
        err: (e as Error).message,
      });
    }

    logger.info("subagent.complete", {
      sessionId: parentSessionId,
      childSessionId,
      type: args.subagent_type,
      depth: depth + 1,
      task_id: args.task_id,
      toolCallCount: childToolCallCount,
      durationMs,
      summaryChars: summary.length,
      transcriptArtifactId,
    });

    return {
      summary,
      transcript: childTranscript,
      childSessionId,
      toolCallCount: childToolCallCount,
      durationMs,
      transcriptArtifactId,
    };
  };
}
