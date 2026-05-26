/**
 * Worker endpoint handler — receives mission briefs from the KimiFlare
 * coordinator, runs a lightweight agent via Workers AI, and returns
 * structured findings.
 */

import type { Env } from "./types.js";

export interface WorkerRequest {
  mode: "plan" | "execute";
  task: string;
  context?: string;
  budget?: { maxCostUsd?: number };
  outputFormat?: "structured" | "text";
  tools?: "all" | "read-only";
  model?: string;
  branchName?: string;
  baseBranch?: string;
  prTitle?: string;
  prBody?: string;
}

export interface WorkerResponse {
  workerId: string;
  status: "completed" | "failed" | "cancelled";
  task: string;
  findings: Array<{
    topic: string;
    summary: string;
    confidence: "high" | "medium" | "low";
    sources: string[];
    relevance: "critical" | "high" | "medium" | "low";
  }>;
  recommendations: string[];
  filesRead: string[];
  webSources: string[];
  costUsd: number;
  tokensUsed: number;
  reasoning: string;
  error?: string;
}

function log(label: string, data?: unknown) {
  console.log(`[WorkerEndpoint] ${label}:`, JSON.stringify(data, null, 2));
}

export async function handleWorkerRequest(
  c: import("hono").Context<{ Bindings: Env }>,
): Promise<Response> {
  const apiKey = c.req.header("X-Worker-Api-Key");
  if (c.env.WORKER_API_KEY && apiKey !== c.env.WORKER_API_KEY) {
    log("auth failed", { provided: apiKey ? "present" : "missing" });
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: WorkerRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.task || !body.mode) {
    return c.json({ error: "Missing required fields: task, mode" }, 400);
  }

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
  log("request", { workerId, mode: body.mode, task: body.task.slice(0, 100) });

  if (body.mode === "execute") {
    log("execute not implemented", { workerId });
    const response: WorkerResponse = {
      workerId,
      status: "failed",
      task: body.task,
      findings: [],
      recommendations: [],
      filesRead: [],
      webSources: [],
      costUsd: 0,
      tokensUsed: 0,
      reasoning: "",
      error: "Execute mode is not yet implemented in the remote worker.",
    };
    return c.json(response, 501);
  }

  // Plan mode: call Workers AI directly
  try {
    const result = await runPlanWorker(c.env, body, workerId);
    log("completed", { workerId, status: result.status });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("failed", { workerId, error: message });
    const response: WorkerResponse = {
      workerId,
      status: "failed",
      task: body.task,
      findings: [],
      recommendations: [],
      filesRead: [],
      webSources: [],
      costUsd: 0,
      tokensUsed: 0,
      reasoning: "",
      error: message,
    };
    return c.json(response, 500);
  }
}

async function runPlanWorker(
  env: Env,
  req: WorkerRequest,
  workerId: string,
): Promise<WorkerResponse> {
  const model = req.model ?? "@cf/moonshotai/kimi-k2.6";
  const accountId = env.ACCOUNT_ID;
  const apiToken = env.CF_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error("ACCOUNT_ID or CF_API_TOKEN not configured");
  }

  const systemPrompt = `You are a research assistant. Your job is to investigate the user's request and return a structured JSON response.

You must respond with ONLY a JSON object in this exact format:
{
  "findings": [
    {
      "topic": "Short topic name",
      "summary": "Detailed summary of what you found",
      "confidence": "high|medium|low",
      "sources": ["source name or URL"],
      "relevance": "critical|high|medium|low"
    }
  ],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
  "filesRead": ["files you would read"],
  "webSources": ["URLs you would reference"],
  "reasoning": "Your step-by-step reasoning process"
}

Rules:
- Be thorough but concise
- Cite specific sources when possible
- Provide actionable recommendations
- Estimate confidence honestly`;

  const userPrompt = `Task: ${req.task}\n\nContext: ${req.context ?? "No additional context provided."}`;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    result?: {
      response?: string;
    };
  };

  const rawText = data.result?.response ?? "";

  // Try to extract JSON from the response
  let parsed: Partial<WorkerResponse> = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as Partial<WorkerResponse>;
    }
  } catch {
    // If JSON parsing fails, we'll use defaults
  }

  // Estimate tokens (very rough heuristic: 1 token ≈ 4 chars)
  const tokensUsed = Math.ceil(rawText.length / 4);
  // Rough cost estimate for Kimi-K2.6: ~$0.50 per 1M input tokens, ~$2.00 per 1M output tokens
  const costUsd = (tokensUsed / 1_000_000) * 1.0;

  return {
    workerId,
    status: "completed",
    task: req.task,
    findings: parsed.findings ?? [
      {
        topic: req.task.slice(0, 50),
        summary: rawText.slice(0, 500) || "No structured findings available.",
        confidence: "medium",
        sources: [],
        relevance: "high",
      },
    ],
    recommendations: parsed.recommendations ?? [],
    filesRead: parsed.filesRead ?? [],
    webSources: parsed.webSources ?? [],
    costUsd,
    tokensUsed,
    reasoning: parsed.reasoning ?? rawText.slice(0, 1000),
  };
}
