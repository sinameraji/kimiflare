#!/usr/bin/env tsx
/**
 * Headless A/B test for cache-stable prompt engineering.
 * Runs the same multi-turn task twice:
 *   1. With cacheStablePrompts=false (control / old behavior)
 *   2. With cacheStablePrompts=true  (treatment / new behavior)
 *
 * Then compares cache hit ratios, prefix stability, and cost.
 */

import { runAgentTurn } from "../src/agent/loop.js";
import { buildSystemPrompt, buildSystemMessages, buildSessionPrefix } from "../src/agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "../src/tools/executor.js";
import type { ChatMessage, Usage } from "../src/agent/messages.js";
import type { PermissionRequest } from "../src/tools/executor.js";
import { logTurnDebug, comparePromptPrefixes } from "../src/cost-debug.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ACCOUNT_ID = "b35e975c549e4e6b888ed6a6d436d89f";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const MODEL = "@cf/moonshotai/kimi-k2.6";

if (!API_TOKEN) {
  console.error("CLOUDFLARE_API_TOKEN not set");
  process.exit(1);
}

interface RunResult {
  label: string;
  messages: ChatMessage[];
  usages: Usage[];
  turnCount: number;
  toolCallCount: number;
}

async function runSession(label: string, cacheStable: boolean): Promise<RunResult> {
  console.log(`\n▶ Running session: ${label} (cacheStable=${cacheStable})`);

  const tools = ALL_TOOLS;
  const executor = new ToolExecutor(tools);

  let messages: ChatMessage[];
  if (cacheStable) {
    messages = buildSystemMessages({ cwd: process.cwd(), tools, model: MODEL, mode: "edit" });
  } else {
    messages = [
      {
        role: "system",
        content: buildSystemPrompt({ cwd: process.cwd(), tools, model: MODEL, mode: "edit" }),
      },
    ];
  }

  // Task: "List the first 5 TypeScript files in src/ and read the first one"
  const taskPrompt = `Use the glob tool to find the first 5 TypeScript files in the src/ directory, then use the read tool to read the first one found. Keep it brief.`;
  messages.push({ role: "user", content: taskPrompt });

  const usages: Usage[] = [];
  let toolCallCount = 0;
  let turnCount = 0;
  let previousMessages: ChatMessage[] | undefined;

  try {
    await runAgentTurn({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      model: MODEL,
      messages,
      tools,
      executor,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      sessionId: `cache-test-${label}-${Date.now()}`,
      callbacks: {
        onAssistantStart: () => {
          turnCount++;
          console.log(`  turn ${turnCount} started...`);
        },
        onTextDelta: (d) => {
          process.stdout.write(d);
        },
        onToolCallFinalized: (call) => {
          toolCallCount++;
          console.log(`\n  [tool] ${call.function.name}`);
        },
        onToolResult: (r) => {
          console.log(`  [result] ${r.content.slice(0, 80).replace(/\n/g, " ")}...`);
        },
        onUsage: (u) => {
          usages.push(u);
          const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
          const ratio = u.prompt_tokens > 0 ? (cached / u.prompt_tokens * 100).toFixed(1) : "0";
          console.log(`  [usage] prompt=${u.prompt_tokens} cached=${cached} ratio=${ratio}%`);
        },
        onAssistantFinal: () => {
          console.log("  turn done.\n");
        },
        askPermission: async (req: PermissionRequest) => {
          // Auto-approve read/glob, deny everything else for safety
          if (["read", "glob"].includes(req.tool.name)) return "allow";
          console.log(`  [blocked] ${req.tool.name} (needs permission)`);
          return "deny";
        },
      },
    });
  } catch (e) {
    console.error(`  Session ended with error: ${(e as Error).message}`);
  }

  return { label, messages, usages, turnCount, toolCallCount };
}

function analyzeResult(r: RunResult) {
  const totalPrompt = r.usages.reduce((s, u) => s + u.prompt_tokens, 0);
  const totalCached = r.usages.reduce((s, u) => s + (u.prompt_tokens_details?.cached_tokens ?? 0), 0);
  const totalCompletion = r.usages.reduce((s, u) => s + u.completion_tokens, 0);
  const avgRatio = totalPrompt > 0 ? (totalCached / totalPrompt) : 0;

  // Check prefix stability across turns
  let staticMutations = 0;
  let sessionMutations = 0;
  for (let i = 1; i < r.messages.length; i++) {
    const prev = r.messages.slice(0, i);
    const curr = r.messages.slice(0, i + 1);
    const diag = comparePromptPrefixes(prev, curr);
    if (diag.changedSegment === "static") staticMutations++;
    if (diag.changedSegment === "session") sessionMutations++;
  }

  return {
    totalPrompt,
    totalCached,
    totalCompletion,
    avgRatio,
    staticMutations,
    sessionMutations,
    estimatedCost: (totalPrompt - totalCached) * 0.95 / 1_000_000 + totalCached * 0.16 / 1_000_000 + totalCompletion * 4.0 / 1_000_000,
  };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Cache-Stable Prefix A/B Test");
  console.log("=".repeat(60));

  const control = await runSession("control", false);
  const treatment = await runSession("treatment", true);

  const c = analyzeResult(control);
  const t = analyzeResult(treatment);

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));

  const rows = [
    ["Metric", "Control (old)", "Treatment (new)", "Delta"],
    ["Turns", String(control.turnCount), String(treatment.turnCount), String(treatment.turnCount - control.turnCount)],
    ["Tool calls", String(control.toolCallCount), String(treatment.toolCallCount), String(treatment.toolCallCount - control.toolCallCount)],
    ["Total prompt tokens", String(c.totalPrompt), String(t.totalPrompt), String(t.totalPrompt - c.totalPrompt)],
    ["Total cached tokens", String(c.totalCached), String(t.totalCached), String(t.totalCached - c.totalCached)],
    ["Avg cache ratio", `${(c.avgRatio * 100).toFixed(1)}%`, `${(t.avgRatio * 100).toFixed(1)}%`, `${((t.avgRatio - c.avgRatio) * 100).toFixed(1)}%`],
    ["Static mutations", String(c.staticMutations), String(t.staticMutations), String(t.staticMutations - c.staticMutations)],
    ["Session mutations", String(c.sessionMutations), String(t.sessionMutations), String(t.sessionMutations - c.sessionMutations)],
    ["Est. cost", `$${c.estimatedCost.toFixed(4)}`, `$${t.estimatedCost.toFixed(4)}`, `$${(t.estimatedCost - c.estimatedCost).toFixed(4)}`],
  ];

  const colWidths = [22, 18, 18, 12];
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | "));
  }

  console.log("\n" + "=".repeat(60));
  if (t.staticMutations < c.staticMutations) {
    console.log("✅ Static prefix is more stable in treatment");
  }
  if (t.avgRatio > c.avgRatio) {
    console.log(`✅ Cache hit ratio improved by ${((t.avgRatio - c.avgRatio) * 100).toFixed(1)} percentage points`);
  }
  if (t.estimatedCost < c.estimatedCost) {
    console.log(`✅ Estimated cost saved: $${(c.estimatedCost - t.estimatedCost).toFixed(4)}`);
  }
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
