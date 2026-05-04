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
 */

import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions, GatewayMeta } from "../agent/client.js";
import { sanitizeString } from "../agent/messages.js";
import type { ChatMessage, Usage } from "../agent/messages.js";
import type { ResearchPlan, TerminalState, Confidence } from "./types.js";

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
  const findingsText = opts.plan.findings
    .map(
      (f) =>
        `[${f.id}] ${f.confidence.toUpperCase()}: ${f.claim}\n` +
        `  Evidence: ${f.evidence.map((e) => `${e.filePath}${e.lineRange ? `:${e.lineRange[0]}-${e.lineRange[1]}` : ""}`).join(", ")}\n` +
        `${f.implications?.length ? `  Implications: ${f.implications.join("; ")}\n` : ""}` +
        `${f.unresolvedFollowups?.length ? `  Followups: ${f.unresolvedFollowups.join("; ")}\n` : ""}`,
    )
    .join("\n\n");

  const tasksText = opts.plan.tasks
    .map((t) => `- [${t.status}] ${t.question}${t.killReason ? ` (killed: ${t.killReason})` : ""}`)
    .join("\n");

  const openQuestionsText = opts.plan.openQuestions
    .filter((q) => q.status === "open")
    .map((q) => `- ${q.critical ? "(CRITICAL) " : ""}${q.question}`)
    .join("\n") || "None";

  const userContent =
    `Original query: ${opts.plan.query}\n\n` +
    `Research tasks:\n${tasksText}\n\n` +
    `Findings:\n${findingsText}\n\n` +
    `Open questions:\n${openQuestionsText}\n\n` +
    `Budget status: ${opts.plan.phases.map((p) => `${p.phase}: ${p.totalTokens} tokens`).join(", ")}\n\n` +
    `Produce the final answer with all 6 required sections.`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let content = "";
  let reasoning = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;

  const events = runKimi({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages,
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
      case "usage":
        usage = ev.usage;
        break;
      case "done":
        break;
    }
  }

  if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

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
  // Determine terminal state from plan status and findings
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

  // Try to extract confidence from synthesis text
  const confidenceMatch = content.match(/\*\*Confidence\*\*[:\-]?\s*(high|medium|low)/i);
  if (confidenceMatch) {
    confidence = confidenceMatch[1]!.toLowerCase() as Confidence;
  }

  return { terminalState, confidence };
}
