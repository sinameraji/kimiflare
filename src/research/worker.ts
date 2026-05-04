/**
 * Worker — Bounded evidence-gathering subprocess for research transactions.
 *
 * A single worker answers one ResearchTask. It is read-only, budgeted,
 * and cannot mutate the ledger directly. It uses structured tool calls
 * to communicate findings back to the orchestrator.
 */

import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions, GatewayMeta } from "../agent/client.js";
import { toOpenAIToolDefs, type ToolSpec } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { PermissionAsker, ToolResult } from "../tools/executor.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { readTool } from "../tools/read.js";
import { sanitizeString } from "../agent/messages.js";
import type { ChatMessage, ToolCall, Usage } from "../agent/messages.js";
import type { ResearchTask, Finding, Confidence } from "./types.js";

// ---------------------------------------------------------------------------
// Ledger tools — workers use these to communicate back to the orchestrator.
// These are "fake" tools: they don't touch the filesystem. The orchestrator
// intercepts their output and appends to the ledger.
// ---------------------------------------------------------------------------

interface RecordFindingArgs {
  claim: string;
  evidence: Array<{ filePath: string; lineRange?: [number, number]; excerpt?: string }>;
  confidence: Confidence;
  implications?: string[];
  unresolvedFollowups?: string[];
}

const recordFindingTool: ToolSpec<RecordFindingArgs> = {
  name: "record_finding",
  description:
    "Record a factual finding with evidence. Use this when you have discovered something relevant to the task question.",
  parameters: {
    type: "object",
    properties: {
      claim: { type: "string", description: "Concise factual statement of what you found." },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            lineRange: { type: "array", items: { type: "number" } },
            excerpt: { type: "string", description: "≤ 200 chars" },
          },
          required: ["filePath"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      implications: { type: "array", items: { type: "string" } },
      unresolvedFollowups: { type: "array", items: { type: "string" } },
    },
    required: ["claim", "evidence", "confidence"],
  },
  needsPermission: false,
  async run(args) {
    return JSON.stringify({ type: "record_finding", ...args });
  },
};

interface ProposeFollowupArgs {
  question: string;
  description?: string;
  priority?: number;
  suggestedFiles?: string[];
}

const proposeFollowupTool: ToolSpec<ProposeFollowupArgs> = {
  name: "propose_followup_task",
  description:
    "Propose a new research task based on what you discovered. The orchestrator will approve or reject it based on budget.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      description: { type: "string" },
      priority: { type: "number", minimum: 1, maximum: 5 },
      suggestedFiles: { type: "array", items: { type: "string" } },
    },
    required: ["question"],
  },
  needsPermission: false,
  async run(args) {
    return JSON.stringify({ type: "propose_followup_task", ...args });
  },
};

interface RequestFileArgs {
  filePath: string;
  purpose: string;
}

const requestFileTool: ToolSpec<RequestFileArgs> = {
  name: "request_file",
  description:
    "Request permission to read a file. The orchestrator checks if another worker already holds a lease. If granted, you may proceed to read it.",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      purpose: { type: "string" },
    },
    required: ["filePath", "purpose"],
  },
  needsPermission: false,
  async run(args) {
    return JSON.stringify({ type: "request_file", ...args });
  },
};

interface MarkUnknownArgs {
  reason: string;
  missingContext?: string;
}

const markUnknownTool: ToolSpec<MarkUnknownArgs> = {
  name: "mark_unknown",
  description:
    "Mark this task as unanswerable with the information currently available. Use this when you cannot find the answer after reasonable exploration.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string" },
      missingContext: { type: "string" },
    },
    required: ["reason"],
  },
  needsPermission: false,
  async run(args) {
    return JSON.stringify({ type: "mark_unknown", ...args });
  },
};

const WORKER_TOOLS = [readTool, globTool, grepTool, recordFindingTool, proposeFollowupTool, requestFileTool, markUnknownTool];

const WORKER_SYSTEM_PROMPT =
  `You are a research worker. Your job is to answer ONE specific question by exploring files in a codebase.

Rules:
- Use read, glob, and grep to explore files.
- Use record_finding to document what you discover.
- Use propose_followup_task if you discover something that needs separate investigation.
- Use request_file before reading a file to check for lease conflicts.
- Use mark_unknown if you cannot answer the question after reasonable effort.
- Focus on facts: what the code does, how it works, key functions, and relationships.
- Be concise but complete. Include file names and key identifiers.
- Do not suggest changes or write code — only summarize what you find.
- Stop once you have enough information to answer the question.`;

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

export interface WorkerOpts {
  task: ResearchTask;
  workerId: string;
  accountId: string;
  apiToken: string;
  model: string;
  cwd: string;
  signal: AbortSignal;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
}

export interface WorkerOutput {
  findings: Finding[];
  followups: Array<{ question: string; description?: string; priority?: number; suggestedFiles?: string[] }>;
  fileRequests: Array<{ filePath: string; purpose: string }>;
  unknown?: { reason: string; missingContext?: string };
  usage: Usage;
  gatewayMeta?: GatewayMeta;
  filesRead: string[];
}

export async function runWorker(opts: WorkerOpts): Promise<WorkerOutput> {
  const maxIter = opts.task.budget.maxToolCalls;
  const toolDefs = toOpenAIToolDefs(WORKER_TOOLS);
  const executor = new ToolExecutor(WORKER_TOOLS);
  const autoAllow: PermissionAsker = async () => "allow";

  const messages: ChatMessage[] = [
    { role: "system", content: WORKER_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Task: ${opts.task.question}\n\n` +
        `${opts.task.description ? `Context: ${opts.task.description}\n\n` : ""}` +
        `${opts.task.scope.suggestedFiles?.length ? `Suggested files:\n${opts.task.scope.suggestedFiles.map((f) => `- ${f}`).join("\n")}\n\n` : ""}` +
        `Answer this question by exploring the codebase. Record findings as you go.`,
    },
  ];

  let totalUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;
  const findings: Finding[] = [];
  const followups: WorkerOutput["followups"] = [];
  const fileRequests: WorkerOutput["fileRequests"] = [];
  let unknown: WorkerOutput["unknown"] | undefined;
  const filesRead: string[] = [];
  let toolCallsMade = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

    const toolCalls: ToolCall[] = [];
    let content = "";
    let reasoning = "";

    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages,
      tools: toolDefs,
      signal: opts.signal,
      reasoningEffort: opts.reasoningEffort ?? "low",
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
          totalUsage = ev.usage;
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
      // Worker finished without pending tool calls
      break;
    }

    for (const tc of toolCalls) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

      toolCallsMade++;

      // Track files read
      if (tc.function.name === "read") {
        try {
          const args = JSON.parse(tc.function.arguments);
          if (args.path) filesRead.push(args.path);
        } catch {
          // ignore parse error
        }
      }

      const result = await executor.run(
        { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        autoAllow,
        { cwd: opts.cwd, signal: opts.signal },
      );

      // Intercept ledger tool outputs
      if (tc.function.name === "record_finding") {
        const parsed = parseLedgerOutput(result.content) as RecordFindingArgs | null;
        if (parsed) {
          const finding: Finding = {
            id: `finding-${opts.workerId}-${findings.length}`,
            taskId: opts.task.id,
            workerId: opts.workerId,
            claim: parsed.claim,
            evidence: parsed.evidence ?? [],
            confidence: parsed.confidence,
            implications: parsed.implications,
            unresolvedFollowups: parsed.unresolvedFollowups,
            createdAt: new Date().toISOString(),
          };
          findings.push(finding);
        }
      } else if (tc.function.name === "propose_followup_task") {
        const parsed = parseLedgerOutput(result.content) as ProposeFollowupArgs | null;
        if (parsed) {
          followups.push({
            question: parsed.question,
            description: parsed.description,
            priority: parsed.priority,
            suggestedFiles: parsed.suggestedFiles,
          });
        }
      } else if (tc.function.name === "request_file") {
        const parsed = parseLedgerOutput(result.content) as RequestFileArgs | null;
        if (parsed) {
          fileRequests.push({ filePath: parsed.filePath, purpose: parsed.purpose });
        }
      } else if (tc.function.name === "mark_unknown") {
        const parsed = parseLedgerOutput(result.content) as MarkUnknownArgs | null;
        if (parsed) {
          unknown = { reason: parsed.reason, missingContext: parsed.missingContext };
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: sanitizeString(result.content),
        name: result.name,
      });
    }
  }

  return {
    findings,
    followups,
    fileRequests,
    unknown,
    usage: totalUsage,
    gatewayMeta,
    filesRead,
  };
}

function parseLedgerOutput(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}
