#!/usr/bin/env tsx
/**
 * Synthetic validation test for cache-stable prompt engineering.
 * Does NOT hit the API — validates prefix stability purely through
 * prompt construction logic.
 */

import { buildSystemPrompt, buildSystemMessages, buildStaticPrefix, buildSessionPrefix } from "../src/agent/system-prompt.js";
import { stableStringify } from "../src/agent/messages.js";
import { comparePromptPrefixes } from "../src/cost-debug.js";
import { ALL_TOOLS } from "../src/tools/executor.js";
import type { ChatMessage } from "../src/agent/messages.js";

const MODEL = "@cf/moonshotai/kimi-k2.6";
const TOOLS = ALL_TOOLS;

function simulateTurns(cacheStable: boolean, turnCount: number): ChatMessage[][] {
  const history: ChatMessage[][] = [];
  const baseDate = new Date("2026-04-23T10:00:00Z");

  for (let turn = 0; turn < turnCount; turn++) {
    // Simulate date advancing between turns (1 day per turn)
    const now = new Date(baseDate.getTime() + turn * 86400_000); // +1 day per turn
    let messages: ChatMessage[];

    if (cacheStable) {
      // Dual system messages: static[0] never changes, session[1] may change
      messages = [
        { role: "system", content: buildStaticPrefix({ model: MODEL }) },
        {
          role: "system",
          content: buildSessionPrefix({
            cwd: process.cwd(),
            tools: TOOLS,
            model: MODEL,
            mode: "edit",
            now,
          }),
        },
      ];
    } else {
      // Single monolithic system message — everything rebuilds each turn
      messages = [
        {
          role: "system",
          content: buildSystemPrompt({
            cwd: process.cwd(),
            tools: TOOLS,
            model: MODEL,
            mode: "edit",
            now,
          }),
        },
      ];
    }

    // Simulate conversation growth
    for (let i = 0; i < turn; i++) {
      messages.push({ role: "user", content: `User message ${i}` });
      messages.push({ role: "assistant", content: `Assistant response ${i}` });
      messages.push({ role: "tool", content: `Tool result ${i}`, name: "read", tool_call_id: `tc_${i}` });
    }

    history.push(messages);
  }

  return history;
}

function analyzeStability(label: string, history: ChatMessage[][]) {
  console.log(`\n▶ ${label}`);

  let staticMutations = 0;
  let sessionMutations = 0;
  let dynamicMutations = 0;
  let noChange = 0;

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!;
    const curr = history[i]!;
    const diag = comparePromptPrefixes(prev, curr);

    switch (diag.changedSegment) {
      case "static": staticMutations++; break;
      case "session": sessionMutations++; break;
      case "dynamic": dynamicMutations++; break;
      case "none": noChange++; break;
    }
  }

  // Calculate prefix sizes
  const firstTurn = history[0]!;
  const staticChars = firstTurn[0]?.role === "system" && typeof firstTurn[0].content === "string"
    ? firstTurn[0].content.length
    : 0;
  const sessionChars = firstTurn[1]?.role === "system" && typeof firstTurn[1].content === "string"
    ? firstTurn[1].content.length
    : 0;

  console.log(`  Static prefix size:  ${staticChars} chars (~${Math.round(staticChars / 4)} tokens)`);
  console.log(`  Session prefix size: ${sessionChars} chars (~${Math.round(sessionChars / 4)} tokens)`);
  console.log(`  Static mutations:    ${staticMutations} / ${history.length - 1} turns`);
  console.log(`  Session mutations:   ${sessionMutations} / ${history.length - 1} turns`);
  console.log(`  Dynamic mutations:   ${dynamicMutations} / ${history.length - 1} turns`);
  console.log(`  No prefix change:    ${noChange} / ${history.length - 1} turns`);

  // Verify byte-for-byte stability of static prefix
  if (history[0]![0]?.role === "system") {
    const firstStatic = history[0]![0].content;
    let allStable = true;
    for (let i = 1; i < history.length; i++) {
      if (history[i]![0]?.content !== firstStatic) {
        allStable = false;
        console.log(`  ❌ Static prefix changed at turn ${i + 1}`);
        break;
      }
    }
    if (allStable) {
      console.log(`  ✅ Static prefix is byte-for-byte identical across all turns`);
    }
  }

  return { staticMutations, sessionMutations, dynamicMutations, noChange, staticChars, sessionChars };
}

function testDeterministicSerialization() {
  console.log("\n▶ Deterministic serialization test");

  const obj1 = { z: 1, a: { y: 2, x: 3 }, b: [4, 5] };
  const obj2 = { a: { x: 3, y: 2 }, b: [4, 5], z: 1 };

  const s1 = stableStringify(obj1);
  const s2 = stableStringify(obj2);

  if (s1 === s2) {
    console.log(`  ✅ stableStringify produces identical output for same data, different key order`);
  } else {
    console.log(`  ❌ stableStringify is non-deterministic`);
    console.log(`     s1: ${s1}`);
    console.log(`     s2: ${s2}`);
  }

  // Simulate API body with conditional keys (the old non-deterministic pattern)
  const body1 = { messages: [{ role: "user" }], tools: [{ name: "read" }], stream: true };
  const body2 = { stream: true, messages: [{ role: "user" }], tools: [{ name: "read" }] };

  const b1 = stableStringify(body1);
  const b2 = stableStringify(body2);

  if (b1 === b2) {
    console.log(`  ✅ API body serialization is order-independent`);
  } else {
    console.log(`  ❌ API body serialization depends on key order`);
  }
}

function main() {
  console.log("=".repeat(60));
  console.log("Synthetic Cache-Stable Prefix Validation");
  console.log("=".repeat(60));

  const TURNS = 10;

  const controlHistory = simulateTurns(false, TURNS);
  const treatmentHistory = simulateTurns(true, TURNS);

  const c = analyzeStability("Control (old behavior, single system message)", controlHistory);
  const t = analyzeStability("Treatment (new behavior, dual system messages)", treatmentHistory);

  testDeterministicSerialization();

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const rows = [
    ["Metric", "Control", "Treatment", "Improvement"],
    ["Static mutations", String(c.staticMutations), String(t.staticMutations), c.staticMutations > t.staticMutations ? "✅" : "—"],
    ["Session mutations", String(c.sessionMutations), String(t.sessionMutations), t.sessionMutations > c.sessionMutations ? "⚠️ expected" : "—"],
    ["Dynamic mutations", String(c.dynamicMutations), String(t.dynamicMutations), "—"],
    ["Static prefix (chars)", String(c.staticChars), String(t.staticChars), "—"],
    ["Session prefix (chars)", String(c.sessionChars), String(t.sessionChars), "—"],
  ];

  const colWidths = [24, 16, 16, 16];
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | "));
  }

  console.log("\n" + "=".repeat(60));
  if (t.staticMutations === 0 && c.staticMutations > 0) {
    console.log("✅ PASS: Static prefix is perfectly stable in treatment");
    console.log(`   The ${Math.round(t.staticChars / 4)}-token static prefix would be cacheable across all turns.`);
  } else if (t.staticMutations === 0) {
    console.log("✅ PASS: Static prefix is stable (control also stable — date didn't change in this test)");
  } else {
    console.log("❌ FAIL: Static prefix is not stable in treatment");
  }

  if (t.sessionMutations > 0) {
    console.log(`ℹ️  Session prefix mutates ${t.sessionMutations}x (expected — date changes each turn)`);
  }
  console.log("=".repeat(60));
}

main();
