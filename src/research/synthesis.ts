/**
 * Synthesis Dispatcher — Generates the final answer from research findings.
 *
 * Must always produce:
 * 1. Direct answer
 * 2. Evidence summary
 * 3. Confidence
 * 4. What was checked
 * 5. What remains unknown
 * 6. Suggested next action
 *
 * When findings are large, synthesis uses the read tool to access the ledger
 * file directly instead of stuffing everything into the prompt. This prevents
 * context-window overflow and lets the model navigate the evidence itself.
 */

import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions, GatewayMeta } from "../agent/client.js";
import { toOpenAIToolDefs } from "../tools/registry.js";
import { readTool } from "../tools/read.js";
import { sanitizeString } from "../agent/messages.js";
import type { ChatMessage, ToolCall, Usage } from "../agent/messages.js";
import type { ResearchPlan, TerminalState, Confidence } from "./types.js";
import { ledgerPath } from "./ledger.js";

/** Threshold: if findings exceed this many tokens, switch to ledger-reading mode. */
const FINDINGS_INLINE_THRESHOLD = 80_000;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildCompactFindingsSummary(findings: ResearchPlan["findings"]): string {
  return findings
    .map(
      (f) =>
        `[${f.id}] ${f.confidence.toUpperCase()}: ${f.claim}\n` +
        `  Files: ${f.evidence.map((e) => e.filePath).join(", ")}`,
    )
    .join("\n\n");
}

const SYNTHESIS_SYSTEM_PROMPT =
  `You are a synthesis assistant. Combine research findings into a single coherent answer to the user's original query.

Rules:
- Preserve file names and key identifiers from the findings.
- Organize by theme or component, not by worker.
- If findings conflict, note the discrepancy.
- Be thorough but concise.
- Cite findings by their ID.
- Do not hallucinate files or code that were not in the findings.

Your response MUST include these 6 sections:

1. **Direct Answer** — Answer the user's query directly.
2. **Evidence Summary** — List the key files and line ranges that support the answer.
3. **Confidence** — high, medium, or low. Explain why.
4. **What Was Checked** — Briefly describe the scope of the research.
5. **What Remains Unknown** — List any open questions or gaps.
6. **Suggested Next Action** — What should the user do next?`;

export interface SynthesisOpts {
  plan: ResearchPlan;
  accountId: string;
  apiToken: string;
  model: string;
  signal: AbortSignal;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
}

export interface SynthesisOutput {
  content: string;
  terminalState: TerminalState;
  confidence: Confidence;
  usage: Usage;
  gatewayMeta?: GatewayMeta;
}

export async function runSynthesis(opts: SynthesisOpts): Promise<SynthesisOutput> {
  if (opts.plan.findings.length === 0) {
    return {
      content:
        `## Research Completed — No Findings\n\n` +
        `The research transaction ran but produced no validated findings. ` +
        `This usually means the worker explored the codebase but either:\n` +
        `- Did not discover anything relevant to the query\n` +
        `- Its findings failed ledger validation (check the research ledger for details)\n` +
        `- The task scope was too narrow or the codebase lacks the expected information\n\n` +
        `**Tasks attempted:** ${opts.plan.tasks.length}\n` +
        `**Tasks completed:** ${opts.plan.tasks.filter((t) => t.status === "done").length}\n` +
        `**Open questions remaining:** ${opts.plan.openQuestions.filter((q) => q.status === "open").length}\n\n` +
        `**Suggested next action:** Try a more specific query, or check the research ledger at \`${ledgerPath(opts.plan.turnId)}\` for worker notes and rejection reasons.`,
      terminalState: "NOT_FOUND",
      confidence: "low",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  const findingsSummary = buildCompactFindingsSummary(opts.plan.findings);
  const findingsTokens = approxTokens(findingsSummary);
  const ledgerFilePath = ledgerPath(opts.plan.turnId);

  // Decide mode: inline (small) or ledger-reading (large)
  const useLedgerMode = findingsTokens > FINDINGS_INLINE_THRESHOLD;

  const tasksText = opts.plan.tasks
    .map((t) => `- [${t.status}] ${t.question}${t.killReason ? ` (killed: ${t.killReason})` : ""}`)
    .join("\n");

  const openQuestionsText = opts.plan.openQuestions
    .filter((q) => q.status === "open")
    .map((q) => `- ${q.critical ? "(CRITICAL) " : ""}${q.question}`)
    .join("\n") || "None";

  let userContent: string;
  if (useLedgerMode) {
    userContent =
      `Original query: ${opts.plan.query}\n\n` +
      `Research tasks:\n${tasksText}\n\n` +
      `This research produced ${opts.plan.findings.length} findings. ` +
      `The full ledger (including all findings, evidence, and metadata) is available at:\n` +
      `${ledgerFilePath}\n\n` +
      `Use the read tool to access the ledger file. You may read it in sections if it is large.\n\n` +
      `Open questions:\n${openQuestionsText}\n\n` +
      `Budget status: ${opts.plan.phases.map((p) => `${p.phase}: ${p.totalTokens} tokens`).join(", ")}\n\n` +
      `Produce the final answer with all 6 required sections.`;
  } else {
    userContent =
      `Original query: ${opts.plan.query}\n\n` +
      `Research tasks:\n${tasksText}\n\n` +
      `Findings:\n${findingsSummary}\n\n` +
      `Open questions:\n${openQuestionsText}\n\n` +
      `Budget status: ${opts.plan.phases.map((p) => `${p.phase}: ${p.totalTokens} tokens`).join(", ")}\n\n` +
      `Produce the final answer with all 6 required sections.`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let content = "";
  let reasoning = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;

  // In ledger mode, give the model up to 3 tool iterations to read the ledger.
  const maxToolIterations = useLedgerMode ? 3 : 1;
  const toolDefs = useLedgerMode ? toOpenAIToolDefs([readTool]) : [];

  for (let iter = 0; iter < maxToolIterations; iter++) {
    const toolCalls: ToolCall[] = [];

    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      signal: opts.signal,
      reasoningEffort: opts.reasoningEffort ?? "medium",
      sessionId: opts.sessionId,
      gateway: opts.gateway,
    });

    for await (const ev of events) {
      switch (ev.type) {
        case "gateway_meta":
          gatewayMeta = ev.meta;
          break;
        case "reasoning":
          reasoning += ev.delta;
          break;
        case "text":
          content += ev.delta;
          break;
        case "tool_call_complete": {
          const safeArgs = ev.arguments.trim() ? ev.arguments : "{}";
          toolCalls.push({
            id: ev.id,
            type: "function",
            function: { name: ev.name, arguments: safeArgs },
          });
          break;
        }
        case "usage":
          usage = ev.usage;
          break;
        case "done":
          break;
      }
    }

    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

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
    messages.push(assistantMsg);

    if (toolCalls.length === 0) {
      break;
    }

    // Execute read tool calls
    for (const tc of toolCalls) {
      if (tc.function.name === "read") {
        try {
          const parsed = JSON.parse(tc.function.arguments) as { path?: string; offset?: number; limit?: number };
          if (!parsed.path) throw new Error("missing path");
          const result = await readTool.run(
            { path: parsed.path, offset: parsed.offset, limit: parsed.limit },
            { cwd: process.cwd() },
          );
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: sanitizeString(result as string),
            name: tc.function.name,
          });
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "Error: failed to read file",
            name: tc.function.name,
          });
        }
      } else {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: tool ${tc.function.name} is not available during synthesis.`,
          name: tc.function.name,
        });
      }
    }
  }

  const { terminalState, confidence } = inferTerminalState(opts.plan, content);

  return {
    content: sanitizeString(content),
    terminalState,
    confidence,
    usage,
    gatewayMeta,
  };
}

function inferTerminalState(plan: ResearchPlan, content: string): { terminalState: TerminalState; confidence: Confidence } {
  const hasFindings = plan.findings.length > 0;
  const hasCriticalOpen = plan.openQuestions.some((q) => q.status === "open" && q.critical);
  const allTasksDone = plan.tasks.every((t) => t.status === "done" || t.status === "killed" || t.status === "failed");
  const budgetExhausted = plan.status === "aborted" || plan.phases.reduce((s, p) => s + p.totalTokens, 0) > plan.budget.maxInputTokens * 0.95;

  let terminalState: TerminalState;
  let confidence: Confidence = "medium";

  if (budgetExhausted) {
    terminalState = "BUDGET_EXHAUSTED";
    confidence = "low";
  } else if (!hasFindings) {
    terminalState = "NOT_FOUND";
    confidence = "low";
  } else if (hasCriticalOpen) {
    terminalState = "LIKELY_ANSWER";
    confidence = "medium";
  } else if (allTasksDone) {
    terminalState = "ANSWER_FOUND";
    confidence = "high";
  } else {
    terminalState = "LIKELY_ANSWER";
    confidence = "medium";
  }

  const confidenceMatch = content.match(/\*\*Confidence\*\*[:\-]?\s*(high|medium|low)/i);
  if (confidenceMatch) {
    confidence = confidenceMatch[1]!.toLowerCase() as Confidence;
  }

  return { terminalState, confidence };
}
