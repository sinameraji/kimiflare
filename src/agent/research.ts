import { runKimi } from "./client.js";
import type { AiGatewayOptions, GatewayMeta } from "./client.js";
import { toOpenAIToolDefs, type ToolSpec } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { PermissionAsker, ToolResult } from "../tools/executor.js";
import { sanitizeString, stableStringify } from "./messages.js";
import type { ChatMessage, ToolCall, Usage } from "./messages.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { readTool } from "../tools/read.js";

export interface ResearchOpts {
  accountId: string;
  apiToken: string;
  model: string;
  query: string;
  cwd: string;
  signal: AbortSignal;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
  maxSubAgents?: number;
  maxSubAgentIterations?: number;
}

export interface ResearchResult {
  content: string;
  usage: Usage;
  gatewayMeta?: GatewayMeta;
  subAgentSummaries: string[];
  filesExplored: string[];
}

const RESEARCH_TOOLS: ToolSpec[] = [readTool, globTool, grepTool];

const SUB_AGENT_SYSTEM_PROMPT =
  `You are a research assistant. Your job is to explore a subset of files and produce a concise summary of what is relevant to the user's query.\n\n` +
  `Rules:\n` +
  `- Use the read, glob, and grep tools to explore files.\n` +
  `- Focus on facts: what the code does, how it works, key functions, and relationships.\n` +
  `- Be concise but complete. Include file names and key identifiers.\n` +
  `- Do not suggest changes or write code — only summarize what you find.\n` +
  `- If a file is not relevant, skip it.\n` +
  `- Stop once you have enough information to answer the query.`;

const SYNTHESIS_SYSTEM_PROMPT =
  `You are a synthesis assistant. Combine the following research summaries into a single coherent answer to the user's original query.\n\n` +
  `Rules:\n` +
  `- Preserve file names and key identifiers from the summaries.\n` +
  `- Organize by theme or component, not by sub-agent.\n` +
  `- If summaries conflict, note the discrepancy.\n` +
  `- Be thorough but concise.`;

async function discoverFiles(query: string, cwd: string, signal: AbortSignal): Promise<string[]> {
  const files = new Set<string>();

  // Try grep first to find relevant files
  try {
    const grepResult = await grepTool.run(
      { pattern: query.split(/\s+/).slice(0, 3).join("|"), path: cwd, output_mode: "files" },
      { cwd, signal },
    );
    const grepFiles = String(grepResult)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const f of grepFiles) files.add(f);
  } catch {
    // ignore
  }

  // Fall back to glob for source files
  if (files.size < 10) {
    try {
      const globResult = await globTool.run(
        { pattern: "src/**/*.{ts,tsx,js,jsx}", path: cwd },
        { cwd, signal },
      );
      const globFiles = String(globResult)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (const f of globFiles) files.add(f);
    } catch {
      // ignore
    }
  }

  return Array.from(files).slice(0, 100);
}

function partitionFiles(files: string[], maxGroups: number): string[][] {
  if (files.length === 0) return [];
  const groups: string[][] = Array.from({ length: maxGroups }, () => []);
  // Distribute files round-robin to balance group sizes
  for (let i = 0; i < files.length; i++) {
    groups[i % maxGroups]!.push(files[i]!);
  }
  return groups.filter((g) => g.length > 0);
}

async function runResearchAgent(opts: {
  accountId: string;
  apiToken: string;
  model: string;
  query: string;
  files: string[];
  cwd: string;
  signal: AbortSignal;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
  maxIterations?: number;
}): Promise<{ summary: string; usage: Usage; gatewayMeta?: GatewayMeta }> {
  const maxIter = opts.maxIterations ?? 10;
  const toolDefs = toOpenAIToolDefs(RESEARCH_TOOLS);
  const executor = new ToolExecutor(RESEARCH_TOOLS);

  const messages: ChatMessage[] = [
    { role: "system", content: SUB_AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Query: ${opts.query}\n\n` +
        `Explore these files and summarize what is relevant:\n` +
        opts.files.map((f) => `- ${f}`).join("\n"),
    },
  ];

  let totalUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;

  const autoAllow: PermissionAsker = async () => "allow";

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
      reasoningEffort: opts.reasoningEffort,
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
          totalUsage.prompt_tokens += ev.usage.prompt_tokens;
          totalUsage.completion_tokens += ev.usage.completion_tokens;
          totalUsage.total_tokens += ev.usage.total_tokens;
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
      return { summary: content, usage: totalUsage, gatewayMeta };
    }

    for (const tc of toolCalls) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

      const result = await executor.run(
        { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        autoAllow,
        { cwd: opts.cwd, signal: opts.signal },
      );

      messages.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: sanitizeString(result.content),
        name: result.name,
      });
    }
  }

  // If we hit the iteration limit, return the last assistant message content
  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  const summary = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";
  return { summary, usage: totalUsage, gatewayMeta };
}

async function synthesize(opts: {
  accountId: string;
  apiToken: string;
  model: string;
  query: string;
  summaries: string[];
  cwd: string;
  signal: AbortSignal;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
}): Promise<{ content: string; usage: Usage; gatewayMeta?: GatewayMeta }> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Original query: ${opts.query}\n\n` +
        `Research summaries:\n\n` +
        opts.summaries.map((s, i) => `--- Summary ${i + 1} ---\n${s}`).join("\n\n"),
    },
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
    reasoningEffort: opts.reasoningEffort,
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

  return { content, usage, gatewayMeta };
}

export async function runParallelResearch(opts: ResearchOpts): Promise<ResearchResult> {
  const startTime = performance.now();
  const maxSubAgents = opts.maxSubAgents ?? 4;

  // Discover relevant files
  const files = await discoverFiles(opts.query, opts.cwd, opts.signal);

  if (files.length === 0) {
    // No files found — fall back to a single synthesis call with no summaries
    const result = await synthesize({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      query: opts.query,
      summaries: ["No files were found to explore."],
      cwd: opts.cwd,
      signal: opts.signal,
      gateway: opts.gateway,
      reasoningEffort: opts.reasoningEffort,
      sessionId: opts.sessionId,
    });
    return {
      content: result.content,
      usage: result.usage,
      gatewayMeta: result.gatewayMeta,
      subAgentSummaries: [],
      filesExplored: [],
    };
  }

  // Partition files into groups
  const groups = partitionFiles(files, maxSubAgents);

  // Run sub-agents in parallel
  const subAgentPromises = groups.map((groupFiles) =>
    runResearchAgent({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      query: opts.query,
      files: groupFiles,
      cwd: opts.cwd,
      signal: opts.signal,
      gateway: opts.gateway,
      reasoningEffort: "low", // Sub-agents use low effort to save tokens
      maxIterations: opts.maxSubAgentIterations ?? 8,
    }),
  );

  const subAgentResults = await Promise.all(subAgentPromises);

  // Aggregate usage from sub-agents
  const subAgentUsage: Usage = {
    prompt_tokens: subAgentResults.reduce((s, r) => s + r.usage.prompt_tokens, 0),
    completion_tokens: subAgentResults.reduce((s, r) => s + r.usage.completion_tokens, 0),
    total_tokens: subAgentResults.reduce((s, r) => s + r.usage.total_tokens, 0),
  };

  const summaries = subAgentResults.map((r) => r.summary);

  // Synthesize final answer
  const synthesis = await synthesize({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    query: opts.query,
    summaries,
    cwd: opts.cwd,
    signal: opts.signal,
    gateway: opts.gateway,
    reasoningEffort: opts.reasoningEffort,
    sessionId: opts.sessionId,
  });

  const totalUsage: Usage = {
    prompt_tokens: subAgentUsage.prompt_tokens + synthesis.usage.prompt_tokens,
    completion_tokens: subAgentUsage.completion_tokens + synthesis.usage.completion_tokens,
    total_tokens: subAgentUsage.total_tokens + synthesis.usage.total_tokens,
  };

  return {
    content: synthesis.content,
    usage: totalUsage,
    gatewayMeta: synthesis.gatewayMeta,
    subAgentSummaries: summaries,
    filesExplored: files,
  };
}
