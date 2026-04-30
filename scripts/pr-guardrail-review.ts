#!/usr/bin/env tsx
/**
 * PR Guardrail Review Agent
 *
 * Reads docs/guardrails/, fetches the PR diff, calls Cloudflare Workers AI
 * (Kimi-K2.6) to evaluate the diff against the guardrails, and posts the
 * result as a PR comment.
 *
 * The AI is instructed to output a machine-readable JSON block at the end
 * of its review.  We parse that block to decide pass/fail deterministically.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/* ─── Env ─── */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const GITHUB_EVENT_PATH = process.env.GITHUB_EVENT_PATH;

if (!GITHUB_TOKEN || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !GITHUB_EVENT_PATH) {
  console.error(
    "Missing required env vars: GITHUB_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_EVENT_PATH",
  );
  process.exit(1);
}

/* ─── GitHub event data ─── */
interface PullRequestEvent {
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    head: { sha: string };
    base: { ref: string };
  };
  repository: {
    full_name: string;
  };
}

const event: PullRequestEvent = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf-8"));
const { number: prNumber, title: prTitle, body: prBody, head, base } = event.pull_request;
const repo = event.repository.full_name;

/* ─── GitHub API helper (defined early for auto-pass path) ─── */
const COMMENT_MARKER = "<!-- guardrail-review -->";

async function githubApi(path: string, opts: RequestInit = {}): Promise<unknown> {
  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${text}`);
  }
  return res.json();
}

/* ─── Read guardrails ─── */
const GUARDRAIL_FILES = [
  "docs/guardrails/README.md",
  "docs/guardrails/scoring-rubric.md",
  "docs/guardrails/file-checklist.md",
];

let guardrailsText = "";
for (const file of GUARDRAIL_FILES) {
  try {
    guardrailsText += `\n\n---\n\n# ${file}\n\n` + readFileSync(file, "utf-8");
  } catch {
    console.warn(`Warning: could not read ${file}`);
  }
}

/* ─── Get diff ─── */
let diffText: string;
try {
  diffText = execSync(`git diff origin/${base.ref}...${head.sha}`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
} catch {
  // Fallback to HEAD if the specific sha diff fails
  diffText = execSync(`git diff origin/${base.ref}...HEAD`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/* ─── Path filter: skip if no relevant files changed ─── */
const RELEVANT_PATTERNS = [
  /^src\//,
  /^bin\//,
  /^feedback-worker\//,
  /^docs\//,
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^scripts\/pr-guardrail-review\.ts$/,
  /^\.github\/workflows\/guardrail-review\.yml$/,
];

let changedFiles: string[];
try {
  changedFiles = execSync(`git diff --name-only origin/${base.ref}...${head.sha}`, {
    encoding: "utf-8",
  }).split("\n").filter(Boolean);
} catch {
  changedFiles = execSync(`git diff --name-only origin/${base.ref}...HEAD`, {
    encoding: "utf-8",
  }).split("\n").filter(Boolean);
}

const hasRelevantFile = changedFiles.some((f) => RELEVANT_PATTERNS.some((p) => p.test(f)));

if (!hasRelevantFile) {
  const autoPassBody = `${COMMENT_MARKER}\n✅ **Guardrail Review — Auto-passed**\n\nNo files relevant to the guardrail review were changed in this PR.\n\nChanged files:\n${changedFiles.map((f) => `- \`${f}\``).join("\n") || "_none_"}`;

  const existingComments = (await githubApi(`/issues/${prNumber}/comments`)) as Array<{
    id: number;
    body: string;
  }>;
  const existing = existingComments.find((c) => c.body.includes(COMMENT_MARKER));

  if (existing) {
    await githubApi(`/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: autoPassBody }),
    });
  } else {
    await githubApi(`/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: autoPassBody }),
    });
  }

  console.log("No relevant files changed. Guardrail review auto-passed.");
  process.exit(0);
}

// Truncate extremely large diffs to stay within context limits
const MAX_DIFF_CHARS = 150_000;
const truncated = diffText.length > MAX_DIFF_CHARS;
if (truncated) {
  diffText = diffText.slice(0, MAX_DIFF_CHARS) +
    `\n\n... [diff truncated: ${diffText.length - MAX_DIFF_CHARS} chars omitted] ...`;
}

/* ─── Build prompts ─── */
const systemPrompt = `You are an automated PR review agent for the kimiflare project.
Your job is to evaluate a pull request diff against the project's AI development guardrails.

## Guardrails
${guardrailsText}

## Instructions
1. Evaluate the diff against the guardrails above.
2. Produce a structured markdown review with the following sections:
   - **Overall Score**: X / 3.0
   - **Critical Rules**: For each critical rule from the scoring rubric, state PASS or FAIL with a brief justification.
   - **Per-Category Scores**: Score each of the 9 categories from the guardrails README (0–3).
   - **Specific Findings**: List any violations with file paths and guardrail section numbers (e.g., "Violates 2.1.3").
   - **Action Items**: A checklist of what the author should fix before merging.
3. Be concise but specific. Reference exact file names and line numbers when possible.
4. If a rule does not apply to this PR's scope, mark it N/A.
5. Use the scoring scale: 3 = Exceeds, 2 = Meets, 1 = Partial, 0 = Fails.
6. A PR must score ≥ 2 on all critical rules and average ≥ 2.5 overall to pass.
7. Output ONLY the markdown review. Do not include conversational text outside the review.

## CRITICAL — Structured Result Block
At the very end of your response, after the markdown review, you MUST include a JSON code block with the exact marker shown below.  This block is parsed by automation to determine whether the PR passes or fails.  Do not omit it.  Do not wrap it in extra text.

\`\`\`json
// guardrail-result
{
  "overallScore": 0.0,
  "criticalRulesPassed": true,
  "passed": true
}
\`\`\`

Set the fields as follows:
- overallScore: the numeric overall score (0.0–3.0)
- criticalRulesPassed: false if ANY critical rule scored < 2, otherwise true
- passed: true only if criticalRulesPassed is true AND overallScore >= 2.5, otherwise false`;

const userPrompt = `## PR Information

**Title:** ${prTitle}
**Description:** ${prBody ?? "(no description)"}
${truncated ? "\n**Note:** The diff was truncated due to size.\n" : ""}

## Diff

\`\`\`diff
${diffText}
\`\`\``;

/* ─── Call Workers AI ─── */
const model = "@cf/moonshotai/kimi-k2.6";
const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID!)}/ai/run/${model}`;

async function callWorkersAI(maxTokens: number): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workers AI request failed: HTTP ${res.status} - ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const result = data.result as Record<string, unknown> | undefined;

  let text = "";
  let finishReason: string | null = null;

  if (result) {
    if (typeof result.response === "string") {
      text = result.response;
    } else if (Array.isArray(result.choices)) {
      const choice = result.choices[0] as Record<string, unknown> | undefined;
      const message = choice?.message as Record<string, unknown> | undefined;
      if (typeof message?.content === "string") {
        text = message.content;
      }
      finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    }
  }

  return { text, truncated: finishReason === "length" };
}

console.log("Calling Workers AI for guardrail review...");

let reviewText = "";
try {
  const first = await callWorkersAI(16_000);
  if (first.truncated || !first.text) {
    console.log("First response truncated or empty. Retrying with 24k tokens...");
    const second = await callWorkersAI(24_000);
    reviewText = second.text;
    if (second.truncated) {
      console.warn("WARNING: Review was truncated even at 24k tokens. Parsing may fail.");
    }
  } else {
    reviewText = first.text;
  }
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

if (!reviewText) {
  console.error("Could not extract review text from Workers AI response.");
  process.exit(1);
}

/* ─── Parse structured result block ─── */
interface GuardrailResult {
  overallScore: number;
  criticalRulesPassed: boolean;
  passed: boolean;
}

function parseStructuredResult(text: string): GuardrailResult | null {
  // Look for the marker: ```json\n// guardrail-result\n{ ... }\n```
  const marker = "// guardrail-result";
  const fenceStart = text.indexOf(marker);
  if (fenceStart === -1) return null;

  // Find the opening ```json before the marker
  const before = text.lastIndexOf("```json", fenceStart);
  if (before === -1) return null;

  // Find the closing ``` after the marker
  const after = text.indexOf("```", fenceStart + marker.length);
  if (after === -1) return null;

  const jsonBlock = text.slice(before + "```json".length, after).trim();
  // Remove the marker line if it's still in there
  const lines = jsonBlock.split("\n").filter((l) => !l.trim().startsWith("//"));
  const jsonStr = lines.join("\n").trim();

  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "overallScore" in parsed &&
      typeof (parsed as Record<string, unknown>).overallScore === "number" &&
      "criticalRulesPassed" in parsed &&
      typeof (parsed as Record<string, unknown>).criticalRulesPassed === "boolean" &&
      "passed" in parsed &&
      typeof (parsed as Record<string, unknown>).passed === "boolean"
    ) {
      return parsed as GuardrailResult;
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

// Fallback regex parsers (lenient, no markdown bold requirement)
function parseOverallScoreFallback(text: string): number | null {
  // Matches: "Overall Score: 1.2 / 3.0" or "Overall Score 1.2" or "**Overall Score**: 1.2"
  const m = /Overall Score\s*[:\-]?\s*(\d+(?:\.\d+)?)/i.exec(text);
  return m ? parseFloat(m[1]) : null;
}

function hasCriticalFailFallback(text: string): boolean {
  // Look for "Critical Rules" section, then any "FAIL" before the next major heading
  const start = /Critical Rules/i.exec(text)?.index ?? -1;
  if (start === -1) return false;
  const section = text.slice(start, start + 3000);
  return /\bFAIL\b/i.test(section);
}

const structured = parseStructuredResult(reviewText);

let overallScore: number | null = null;
let criticalRulesPassed = true;
let passed = true;

if (structured) {
  overallScore = structured.overallScore;
  criticalRulesPassed = structured.criticalRulesPassed;
  passed = structured.passed;
  console.log("Parsed structured result block from AI response.");
} else {
  console.warn("WARNING: Could not parse structured result block. Falling back to regex heuristics.");
  overallScore = parseOverallScoreFallback(reviewText);
  criticalRulesPassed = !hasCriticalFailFallback(reviewText);
  passed = criticalRulesPassed && overallScore !== null && overallScore >= 2.5;
}

/* ─── Post / update PR comment ─── */
const fullComment = `${COMMENT_MARKER}\n${reviewText}`;

// Find existing comment
const existingComments = (await githubApi(`/issues/${prNumber}/comments`)) as Array<{
  id: number;
  body: string;
  html_url?: string;
}>;

const existing = existingComments.find((c) => c.body.includes(COMMENT_MARKER));

if (existing) {
  await githubApi(`/issues/comments/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ body: fullComment }),
  });
  console.log(`Updated existing guardrail review comment: ${existing.html_url ?? existing.id}`);
} else {
  const newComment = (await githubApi(`/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: fullComment }),
  })) as { html_url: string };
  console.log(`Posted guardrail review comment: ${newComment.html_url}`);
}

/* ─── Determine exit code ─── */
if (!criticalRulesPassed) {
  console.error("\n❌ Guardrail review found critical rule failures.");
  process.exit(1);
}

if (overallScore !== null && overallScore < 2.5) {
  console.error(`\n❌ Guardrail review overall score (${overallScore}) is below 2.5 threshold.`);
  process.exit(1);
}

if (!passed) {
  console.error("\n❌ Guardrail review did not pass.");
  process.exit(1);
}

console.log("\n✅ Guardrail review passed.");
