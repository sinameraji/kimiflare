#!/usr/bin/env tsx
/**
 * Benchmark script to compare token usage between native tool-calling and Code Mode.
 *
 * Usage:
 *   tsx scripts/benchmark-code-mode.ts
 *
 * Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars.
 */

import { runAgentTurn } from "../src/agent/loop.js";
import { ToolExecutor, ALL_TOOLS } from "../src/tools/executor.js";
import { buildSystemPrompt } from "../src/agent/system-prompt.js";
import type { ChatMessage, Usage } from "../src/agent/messages.js";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;

if (!accountId || !apiToken) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  process.exit(1);
}

const model = process.env.KIMI_MODEL ?? "@cf/moonshotai/kimi-k2.6";
const cwd = process.cwd();

const TASK =
  "Read the files src/tools/read.ts, src/tools/write.ts, src/tools/edit.ts, src/tools/bash.ts, and src/tools/grep.ts. For each file, tell me the tool name and whether it needs permission.";

async function runTask(codeMode: boolean): Promise<Usage> {
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model }) },
    { role: "user", content: TASK },
  ];

  let usage: Usage | null = null;

  await runAgentTurn({
    accountId,
    apiToken,
    model,
    messages,
    tools: ALL_TOOLS,
    executor,
    cwd,
    signal: new AbortController().signal,
    codeMode,
    callbacks: {
      askPermission: async () => "allow",
      onUsageFinal: (u) => {
        usage = u;
      },
    },
  });

  if (!usage) throw new Error("No usage received");
  return usage;
}

async function main() {
  console.log("Benchmark: Code Mode vs Native Tool Calling");
  console.log("Task:", TASK);
  console.log("");

  console.log("Running native tool-calling mode...");
  const nativeUsage = await runTask(false);
  console.log("Native result:", nativeUsage);

  console.log("Running Code Mode...");
  const codeModeUsage = await runTask(true);
  console.log("Code Mode result:", codeModeUsage);

  console.log("");
  console.log("--- Comparison ---");
  console.log(`Native prompt tokens:     ${nativeUsage.prompt_tokens}`);
  console.log(`Code Mode prompt tokens:  ${codeModeUsage.prompt_tokens}`);
  console.log(`Prompt savings:           ${nativeUsage.prompt_tokens - codeModeUsage.prompt_tokens} (${Math.round(((nativeUsage.prompt_tokens - codeModeUsage.prompt_tokens) / nativeUsage.prompt_tokens) * 100)}%)`);
  console.log("");
  console.log(`Native completion tokens:     ${nativeUsage.completion_tokens}`);
  console.log(`Code Mode completion tokens:  ${codeModeUsage.completion_tokens}`);
  console.log(`Completion savings:           ${nativeUsage.completion_tokens - codeModeUsage.completion_tokens} (${Math.round(((nativeUsage.completion_tokens - codeModeUsage.completion_tokens) / nativeUsage.completion_tokens) * 100)}%)`);
  console.log("");
  console.log(`Native total tokens:     ${nativeUsage.total_tokens}`);
  console.log(`Code Mode total tokens:  ${codeModeUsage.total_tokens}`);
  console.log(`Total savings:           ${nativeUsage.total_tokens - codeModeUsage.total_tokens} (${Math.round(((nativeUsage.total_tokens - codeModeUsage.total_tokens) / nativeUsage.total_tokens) * 100)}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
