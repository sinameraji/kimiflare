/**
 * Regression / smoke test for token-cost-reduction changes.
 *
 * Simulates a 20-turn conversation with multiple tool outputs,
 * including repeated identical outputs, and verifies:
 *   - full historical tool outputs are not resent
 *   - input tokens stay under 30k
 *   - max LLM calls per action is 10
 *   - usage log is written
 *   - duplicate outputs are replaced by references
 *
 * Run with: npx tsx test/token-cost-smoke.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "../src/agent/messages.js";
import { buildContext } from "../src/agent/context-builder.js";
import { loadSafetyLimits, estimateMessagesTokens } from "../src/agent/token-limits.js";
import { summarizeToolMessages, clearOutputHashCache } from "../src/agent/tool-output-summarizer.js";
import { logTurnTokenMetrics, buildTurnTokenMetrics } from "../src/cost-debug.js";

function makeSystemMessages(): ChatMessage[] {
  return [
    { role: "system", content: "You are a helpful coding assistant." },
    { role: "system", content: "CWD: /tmp/project" },
  ];
}

function makeUserMessage(text: string): ChatMessage {
  return { role: "user", content: text };
}

function makeAssistantMessage(text: string, toolCalls?: { id: string; name: string; args: string }[]): ChatMessage {
  return {
    role: "assistant",
    content: text,
    ...(toolCalls?.length ? {
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.args },
      })),
    } : {}),
  };
}

function makeToolMessage(toolCallId: string, name: string, content: string): ChatMessage {
  return { role: "tool", tool_call_id: toolCallId, name, content };
}

function generateLargeOutput(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}: const x = ${i};`).join("\n");
}

async function main() {
  console.log("=== Token Cost Smoke Test ===\n");

  const limits = loadSafetyLimits();
  const systemMessages = makeSystemMessages();
  const tmpDir = mkdtempSync(join(tmpdir(), "kimiflare-smoke-"));
  const usagePath = join(tmpDir, "usage.jsonl");

  // Override usage log path for testing
  process.env.HOME = tmpDir;

  clearOutputHashCache();

  const allMessages: ChatMessage[] = [...systemMessages];
  const toolDefs: { type: "function"; function: { name: string; description: string; parameters: unknown } }[] = [
    { type: "function", function: { name: "read", description: "read file", parameters: {} } },
    { type: "function", function: { name: "bash", description: "run bash", parameters: {} } },
    { type: "function", function: { name: "grep", description: "grep files", parameters: {} } },
  ];

  let totalTurns = 0;
  let maxInputTokens = 0;
  let duplicateReferences = 0;
  let compactedCount = 0;

  // Simulate 20 turns
  for (let turn = 1; turn <= 20; turn++) {
    totalTurns++;
    const userMsg = makeUserMessage(`Turn ${turn}: please analyze the codebase`);
    allMessages.push(userMsg);

    // Simulate assistant with tool calls
    const toolCallId = `call_${turn}`;
    const assistantMsg = makeAssistantMessage(`I'll analyze turn ${turn}.`, [
      { id: toolCallId, name: "read", args: '{"path": "src/index.ts"}' },
    ]);
    allMessages.push(assistantMsg);

    // Simulate tool result — repeat identical output every 3rd turn to test dedup
    const isRepeat = turn % 3 === 0;
    const content = isRepeat
      ? generateLargeOutput(50) // same as turn 3, 6, 9...
      : generateLargeOutput(50 + turn);

    const toolMsg = makeToolMessage(toolCallId, "read", content);
    allMessages.push(toolMsg);

    // Build context as the agent loop would
    const context = buildContext({
      allMessages,
      systemMessages,
      sessionMessages: [],
      toolDefs,
      limits,
      currentUserMessage: userMsg,
    });

    // Log metrics
    const metrics = buildTurnTokenMetrics(
      "smoke-test-session",
      turn,
      context.breakdown,
      limits.maxCompletionTokens,
      context.wasCompacted,
      context.removedCount,
      context.exceedsLimit,
    );
    await logTurnTokenMetrics(metrics);

    maxInputTokens = Math.max(maxInputTokens, context.breakdown.total);

    if (context.wasCompacted) compactedCount++;

    // Check for duplicate references in context
    const contextStr = JSON.stringify(context.messages);
    const dupMatches = contextStr.match(/same as previous/g);
    if (dupMatches) duplicateReferences += dupMatches.length;

    // Verify input tokens stay under 30k
    assert(
      context.breakdown.total <= limits.maxInputTokensPerRequest,
      `Turn ${turn}: input tokens ${context.breakdown.total} exceed limit ${limits.maxInputTokensPerRequest}`,
    );

    // Verify we don't send full history
    const historyMsgCount = context.messages.filter((m) => m.role !== "system").length;
    const fullHistoryMsgCount = allMessages.filter((m) => m.role !== "system").length;
    assert(
      historyMsgCount < fullHistoryMsgCount || turn <= limits.maxRecentMessages,
      `Turn ${turn}: context should be bounded, got ${historyMsgCount} history msgs vs ${fullHistoryMsgCount} total`,
    );
  }

  // Verify max LLM calls per action limit
  assert(
    limits.maxLlmCallsPerUserAction === 10,
    `maxLlmCallsPerUserAction should be 10, got ${limits.maxLlmCallsPerUserAction}`,
  );

  // Verify usage log was written
  const homeUsagePath = join(tmpDir, ".kimiflare", "usage.jsonl");
  assert(existsSync(homeUsagePath), "Usage log should be written");

  const usageLog = readFileSync(homeUsagePath, "utf8");
  const usageEntries = usageLog.trim().split("\n").filter(Boolean);
  assert(usageEntries.length === 20, `Expected 20 usage entries, got ${usageEntries.length}`);

  // Verify duplicate outputs were replaced by references
  assert(duplicateReferences > 0, `Expected duplicate references, got ${duplicateReferences}`);

  // Verify tool outputs are summarized
  const summarized = summarizeToolMessages(allMessages, limits.maxToolOutputChars);
  for (const m of summarized) {
    if (m.role === "tool" && typeof m.content === "string") {
      assert(
        m.content.length <= limits.maxToolOutputChars + 100, // allow truncation indicator
        `Tool output should be summarized, got ${m.content.length} chars`,
      );
    }
  }

  // Cleanup
  rmSync(tmpDir, { recursive: true, force: true });

  console.log(`✓ Simulated ${totalTurns} turns`);
  console.log(`✓ Max input tokens: ${maxInputTokens} (limit: ${limits.maxInputTokensPerRequest})`);
  console.log(`✓ Duplicate references found: ${duplicateReferences}`);
  console.log(`✓ Usage log entries: ${usageEntries.length}`);
  console.log(`✓ Compacted turns: ${compactedCount}`);
  console.log(`✓ Max LLM calls per action: ${limits.maxLlmCallsPerUserAction}`);
  console.log(`✓ Max completion tokens: ${limits.maxCompletionTokens}`);
  console.log(`✓ Max tool iterations: ${limits.maxToolIterations}`);
  console.log("\n=== All assertions passed ===");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
