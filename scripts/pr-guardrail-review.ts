#!/usr/bin/env tsx
/**
 * PR Guardrail Review Agent
 *
 * Reads docs/guardrails/, fetches the PR diff, calls Cloudflare Workers AI
 * (Kimi-K2.6) to evaluate the diff against the guardrails, and posts the
 * result as a PR comment.
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
7. Output ONLY the markdown review. Do not include conversational text outside the review.`;

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

console.log("Calling Workers AI for guardrail review...");

const apiRes = await fetch(apiUrl, {
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
    max_completion_tokens: 8000,
  }),
});

if (!apiRes.ok) {
  const text = await apiRes.text();
  console.error(`Workers AI request failed: HTTP ${apiRes.status} - ${text}`);
  process.exit(1);
}

const apiData = (await apiRes.json()) as Record<string, unknown>;

// Handle both Cloudflare native format and OpenAI-compatible format
let reviewText = "";
const result = apiData.result as Record<string, unknown> | undefined;
if (result) {
  if (typeof result.response === "string") {
    reviewText = result.response;
  } else if (Array.isArray(result.choices)) {
    const choice = result.choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") {
      reviewText = message.content;
    }
  }
}

if (!reviewText) {
  console.error("Could not extract review text from Workers AI response:", JSON.stringify(apiData, null, 2));
  process.exit(1);
}

/* ─── Post / update PR comment ─── */
const COMMENT_MARKER = "<!-- guardrail-review -->";
const fullComment = `${COMMENT_MARKER}\n${reviewText}`;

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

// Find existing comment
const existingComments = (await githubApi(`/issues/${prNumber}/comments`)) as Array<{
  id: number;
  body: string;
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
// If the review contains any critical FAIL, exit with error so the check turns red
const hasCriticalFail = /\*\*Critical Rules\*\*[\s\S]*?\bFAIL\b/i.test(reviewText);
const overallFail = /\*\*Overall Score\*\*\s*[:\-]?\s*(\d+(?:\.\d+)?)/i.exec(reviewText);
const overallScore = overallFail ? parseFloat(overallFail[1]) : null;

if (hasCriticalFail) {
  console.error("\n❌ Guardrail review found critical rule failures.");
  process.exit(1);
}

if (overallScore !== null && overallScore < 2.5) {
  console.error(`\n❌ Guardrail review overall score (${overallScore}) is below 2.5 threshold.`);
  process.exit(1);
}

console.log("\n✅ Guardrail review passed.");
