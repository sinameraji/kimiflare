/**
 * Worker endpoint handler — receives mission briefs from the KimiFlare
 * coordinator, runs a lightweight agent via Workers AI, and returns
 * structured findings (plan mode) or opens a PR (execute mode).
 */

import type { Env } from "./types.js";
import {
  getRef,
  createRef,
  createBlob,
  createTree,
  createCommit,
  updateRef,
  createPullRequest,
} from "./github.js";

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
  // Execute mode only:
  githubToken?: string;
  owner?: string;
  repo?: string;
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
  prUrl?: string;
  error?: string;
}

function log(label: string, data?: unknown) {
  console.log(`[WorkerEndpoint] ${label}:`, JSON.stringify(data, null, 2));
}

function emptyResponse(workerId: string, task: string, error: string): WorkerResponse {
  return {
    workerId,
    status: "failed",
    task,
    findings: [],
    recommendations: [],
    filesRead: [],
    webSources: [],
    costUsd: 0,
    tokensUsed: 0,
    reasoning: "",
    error,
  };
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

  try {
    const result =
      body.mode === "execute"
        ? await runExecuteWorker(c.env, body, workerId)
        : await runPlanWorker(c.env, body, workerId);
    log("completed", { workerId, status: result.status });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("failed", { workerId, error: message });
    return c.json(emptyResponse(workerId, body.task, message), 500);
  }
}

/** Call Cloudflare Workers AI and return the raw text response + token estimate. */
async function callAi(
  env: Env,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ rawText: string; tokensUsed: number; costUsd: number }> {
  const accountId = env.ACCOUNT_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("ACCOUNT_ID or CF_API_TOKEN not configured");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
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

  const data = (await res.json()) as { result?: { response?: string } };
  const rawText = data.result?.response ?? "";
  const tokensUsed = Math.ceil(rawText.length / 4);
  const costUsd = (tokensUsed / 1_000_000) * 1.0;
  return { rawText, tokensUsed, costUsd };
}

/** Extract the first JSON object from a model response. */
function extractJson<T>(rawText: string): Partial<T> {
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Partial<T>;
  } catch {
    // fall through
  }
  return {};
}

async function runPlanWorker(
  env: Env,
  req: WorkerRequest,
  workerId: string,
): Promise<WorkerResponse> {
  const model = req.model ?? "@cf/moonshotai/kimi-k2.6";

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

  const { rawText, tokensUsed, costUsd } = await callAi(env, model, systemPrompt, userPrompt);
  const parsed = extractJson<WorkerResponse>(rawText);

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

interface ExecutePlan {
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
  reasoning?: string;
}

async function runExecuteWorker(
  env: Env,
  req: WorkerRequest,
  workerId: string,
): Promise<WorkerResponse> {
  if (!req.githubToken || !req.owner || !req.repo) {
    return emptyResponse(
      workerId,
      req.task,
      "Execute mode requires githubToken, owner, and repo.",
    );
  }

  const model = req.model ?? "@cf/moonshotai/kimi-k2.6";
  const baseBranch = req.baseBranch ?? "main";
  const branchName = req.branchName ?? `kimiflare/worker-${workerId}`;

  const systemPrompt = `You are a coding agent. Given a task, produce the file changes needed to accomplish it.

You must respond with ONLY a JSON object in this exact format:
{
  "files": [{ "path": "relative/path/to/file", "content": "full new file contents" }],
  "commitMessage": "concise commit message",
  "reasoning": "why these changes accomplish the task"
}

Rules:
- Provide the COMPLETE new contents for each file you change (not a diff).
- Keep changes minimal and focused on the task.
- Use forward-slash paths relative to the repo root.`;

  const userPrompt = `Task: ${req.task}\n\nContext: ${req.context ?? "No additional context provided."}`;

  const { rawText, tokensUsed, costUsd } = await callAi(env, model, systemPrompt, userPrompt);
  const plan = extractJson<ExecutePlan>(rawText);

  if (!plan.files || plan.files.length === 0) {
    return emptyResponse(workerId, req.task, "Model did not produce any file changes.");
  }

  const owner = req.owner;
  const repo = req.repo;
  const token = req.githubToken;

  // Build the commit via the Git Data API.
  const baseSha = await getRef({ owner, repo, branch: baseBranch, token });
  await createRef({ owner, repo, branch: branchName, sha: baseSha, token });

  const fileEntries = await Promise.all(
    plan.files.map(async (f) => ({
      path: f.path,
      blobSha: await createBlob({ owner, repo, content: f.content, token }),
    })),
  );

  const treeSha = await createTree({ owner, repo, baseTreeSha: baseSha, files: fileEntries, token });
  const commitSha = await createCommit({
    owner,
    repo,
    message: plan.commitMessage ?? `kimiflare worker: ${req.task.slice(0, 60)}`,
    treeSha,
    parentShas: [baseSha],
    token,
  });
  await updateRef({ owner, repo, branch: branchName, sha: commitSha, token });

  const pr = await createPullRequest({
    owner,
    repo,
    title: req.prTitle ?? plan.commitMessage ?? `kimiflare worker: ${req.task.slice(0, 60)}`,
    body: req.prBody ?? plan.reasoning ?? req.task,
    head: branchName,
    base: baseBranch,
    token,
  });

  return {
    workerId,
    status: "completed",
    task: req.task,
    findings: [],
    recommendations: [],
    filesRead: plan.files.map((f) => f.path),
    webSources: [],
    costUsd,
    tokensUsed,
    reasoning: plan.reasoning ?? rawText.slice(0, 1000),
    prUrl: pr.html_url,
  };
}
