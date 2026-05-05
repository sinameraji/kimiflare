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
 * When findings exceed the model's context window, synthesis automatically
 * falls back to a two-stage map-reduce: partial summaries per chunk,
 * then a final synthesis on the summaries. This mirrors the compaction
 * pattern used by the main agent loop.
 */

import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions, GatewayMeta } from "../agent/client.js";
import { sanitizeString } from "../agent/messages.js";
import type { ChatMessage, Usage } from "../agent/messages.js";
import type { ResearchPlan, TerminalState, Confidence, Finding } from "./types.js";
import { ledgerPath } from "./ledger.js";

/** Hard ceiling for a single synthesis prompt in tokens.
 *  kimi-k2.6 has a 262k context window; we reserve ~16k for completion
 *  and ~6k for overhead, leaving ~240k for input. We cap synthesis at
 *  200k to stay well within safe territory. */
const SYNTHESIS_MAX_PROMPT_TOKENS = 200_000;

/** Target size for a partial-synthesis chunk. */
const CHUNK_TARGET_TOKENS = 150_000;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildFindingsText(findings: Finding[], compact: boolean): string {
  if (compact) {
    return findings
      .map(
        (f) =>
          `[${f.id}] ${f.confidence.toUpperCase()}: ${f.claim}\n` +
          `  Files: ${f.evidence.map((e) => e.filePath).join(", ")}`,
      )
      .join("\n\n");
  }
  return findings
    .map(
      (f) =>
        `[${f.id}] ${f.confidence.toUpperCase()}: ${f.claim}\n` +
        `  Evidence: ${f.evidence.map((e) => `${e.filePath}${e.lineRange ? `:${e.lineRange[0]}-${e.lineRange[1]}` : ""}`).join(", ")}\n` +
        `${f.implications?.length ? `  Implications: ${f.implications.join("; ")}\n` : ""}` +
        `${f.unresolvedFollowups?.length ? `  Followups: ${f.unresolvedFollowups.join("; ")}\n` : ""}`,
    )
    .join("\n\n");
}

function buildUserContent(plan: ResearchPlan, findingsText: string, note?: string): string {
  const tasksText = plan.tasks
    .map((t) => `- [${t.status}] ${t.question}${t.killReason ? ` (killed: ${t.killReason})` : ""}`)
    .join("\n");

  const openQuestionsText = plan.openQuestions
    .filter((q) => q.status === "open")
    .map((q) => `- ${q.critical ? "(CRITICAL) " : ""}${q.question}`)
    .join("\n") || "None";

  const noteLine = note ? `\n${note}\n` : "";

  return (
    `Original query: ${plan.query}\n\n` +
    `Research tasks:\n${tasksText}\n\n` +
    `Findings:\n${findingsText}\n` +
    noteLine +
    `\nOpen questions:\n${openQuestionsText}\n\n` +
    `Budget status: ${plan.phases.map((p) => `${p.phase}: ${p.totalTokens} tokens`).join(", ")}\n\n` +
    `Produce the final answer with all 6 required sections.`
  );
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

const PARTIAL_SYNTHESIS_SYSTEM_PROMPT =
  `You are a research summarizer. Given a subset of research findings, produce a dense summary that preserves:
- Key claims and their confidence levels
- File paths and line ranges mentioned
- Any conflicts or discrepancies between findings

Format as short bullet points. Be extremely concise. Aim for ~300-600 tokens.`;

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

  // Pre-flight prompt sizing: if findings exceed the context window,
  // use two-stage synthesis (chunk → partial summaries → final).
  const findingsText = buildFindingsText(opts.plan.findings, false);
  const userContent = buildUserContent(opts.plan, findingsText);
  const promptTokens = approxTokens(SYNTHESIS_SYSTEM_PROMPT) + approxTokens(userContent);

  if (promptTokens > SYNTHESIS_MAX_PROMPT_TOKENS) {
    return runChunkedSynthesis(opts);
  }

  return runSingleSynthesis(opts, userContent);
}

async function runSingleSynthesis(
  opts: SynthesisOpts,
  userContent: string,
  terminalStatePlan?: ResearchPlan,
): Promise<SynthesisOutput> {
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

  const planForState = terminalStatePlan ?? opts.plan;
  const { terminalState, confidence } = inferTerminalState(planForState, content);

  return {
    content: sanitizeString(content),
    terminalState,
    confidence,
    usage,
    gatewayMeta,
  };
}

async function runChunkedSynthesis(opts: SynthesisOpts): Promise<SynthesisOutput> {
  // Sort findings by confidence (highest first) so the most important
  // evidence is preserved in the first chunks.
  const confidenceOrder: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const sortedFindings = [...opts.plan.findings].sort(
    (a, b) => confidenceOrder[b.confidence] - confidenceOrder[a.confidence],
  );

  // Greedy chunking: pack findings into chunks under CHUNK_TARGET_TOKENS.
  const chunks: Finding[][] = [];
  let currentChunk: Finding[] = [];
  let currentTokens = 0;
  const overheadTokens = approxTokens(PARTIAL_SYNTHESIS_SYSTEM_PROMPT) + 500;

  for (const finding of sortedFindings) {
    const findingTokens = approxTokens(buildCompactFinding(finding));
    if (
      currentTokens + findingTokens > CHUNK_TARGET_TOKENS - overheadTokens &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(finding);
    currentTokens += findingTokens;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Run partial synthesis on each chunk (sequential to control cost).
  let totalUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const chunkSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const chunkPlan: ResearchPlan = {
      ...opts.plan,
      findings: chunk,
    };

    const partialResult = await runPartialSynthesis({
      ...opts,
      plan: chunkPlan,
      chunkIndex: i,
      totalChunks: chunks.length,
    });

    chunkSummaries.push(partialResult.content);
    totalUsage.prompt_tokens += partialResult.usage.prompt_tokens;
    totalUsage.completion_tokens += partialResult.usage.completion_tokens;
    totalUsage.total_tokens += partialResult.usage.total_tokens;
  }

  // Build synthetic findings from chunk summaries.
  const summaryFindings: Finding[] = chunkSummaries.map((summary, i) => ({
    id: `chunk-${i}`,
    taskId: "synthesis",
    workerId: "synthesis",
    claim: summary,
    evidence: [],
    confidence: "high",
    createdAt: new Date().toISOString(),
  }));

  const summaryPlan: ResearchPlan = {
    ...opts.plan,
    findings: summaryFindings,
  };

  // Run final synthesis on the summaries.
  const summaryFindingsText = buildFindingsText(summaryFindings, false);
  const summaryUserContent = buildUserContent(
    summaryPlan,
    summaryFindingsText,
    `[Note: This synthesis is based on ${chunks.length} chunk summaries due to large research volume.]`,
  );

  const finalResult = await runSingleSynthesis(
    { ...opts, plan: summaryPlan },
    summaryUserContent,
    opts.plan, // use original plan for terminal-state inference
  );

  totalUsage.prompt_tokens += finalResult.usage.prompt_tokens;
  totalUsage.completion_tokens += finalResult.usage.completion_tokens;
  totalUsage.total_tokens += finalResult.usage.total_tokens;

  return {
    ...finalResult,
    usage: totalUsage,
  };
}

function buildCompactFinding(finding: Finding): string {
  return `[${finding.id}] ${finding.confidence.toUpperCase()}: ${finding.claim}\n  Files: ${finding.evidence.map((e) => e.filePath).join(", ")}`;
}

interface PartialSynthesisOpts extends SynthesisOpts {
  chunkIndex: number;
  totalChunks: number;
}

async function runPartialSynthesis(opts: PartialSynthesisOpts): Promise<SynthesisOutput> {
  const findingsText = buildFindingsText(opts.plan.findings, true);
  const userContent = `Summarize these research findings (chunk ${opts.chunkIndex + 1} of ${opts.totalChunks}):\n\n${findingsText}`;

  const messages: ChatMessage[] = [
    { role: "system", content: PARTIAL_SYNTHESIS_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let content = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;

  const events = runKimi({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages,
    signal: opts.signal,
    reasoningEffort: "low", // cheap and fast for partial summaries
    sessionId: opts.sessionId,
    gateway: opts.gateway,
  });

  for await (const ev of events) {
    switch (ev.type) {
      case "gateway_meta":
        gatewayMeta = ev.meta;
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

  return {
    content: sanitizeString(content),
    terminalState: "LIKELY_ANSWER",
    confidence: "medium",
    usage,
    gatewayMeta,
  };
}

function inferTerminalState(
  plan: ResearchPlan,
  content: string,
): { terminalState: TerminalState; confidence: Confidence } {
  const hasFindings = plan.findings.length > 0;
  const hasCriticalOpen = plan.openQuestions.some((q) => q.status === "open" && q.critical);
  const allTasksDone = plan.tasks.every(
    (t) => t.status === "done" || t.status === "killed" || t.status === "failed",
  );
  const budgetExhausted =
    plan.status === "aborted" ||
    plan.phases.reduce((s, p) => s + p.totalTokens, 0) > plan.budget.maxInputTokens * 0.95;

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
