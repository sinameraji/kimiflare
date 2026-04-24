import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface UsageEntry {
  ts: string;
  sessionId: string;
  turn: number;
  estimatedInputTokens: number;
  estimatedOutputTokenCap: number;
  messageCount: number;
  toolOutputCount: number;
  tokensFromSystem: number;
  tokensFromSession: number;
  tokensFromTools: number;
  tokensFromHistory: number;
  tokensFromUserInput: number;
  wasCompacted: boolean;
  removedCount: number;
  exceedsLimit: boolean;
}

function usagePath(): string {
  return join(homedir(), ".kimiflare", "usage.jsonl");
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export async function showUsageLog(): Promise<void> {
  const path = usagePath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    console.log("No usage log found at " + path);
    return;
  }

  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.log("Usage log is empty.");
    return;
  }

  const entries: UsageEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as UsageEntry);
    } catch {
      /* skip malformed */
    }
  }

  if (entries.length === 0) {
    console.log("No valid entries in usage log.");
    return;
  }

  // Group by session
  const bySession = new Map<string, UsageEntry[]>();
  for (const e of entries) {
    const arr = bySession.get(e.sessionId) ?? [];
    arr.push(e);
    bySession.set(e.sessionId, arr);
  }

  console.log(`Usage log: ${lines.length} entries, ${bySession.size} session(s)\n`);

  for (const [sessionId, sessEntries] of bySession) {
    const last = sessEntries[sessEntries.length - 1]!;
    const totalInput = sessEntries.reduce((s, e) => s + e.estimatedInputTokens, 0);
    const avgInput = Math.round(totalInput / sessEntries.length);
    console.log(`Session: ${sessionId.slice(0, 16)}…  Turns: ${sessEntries.length}`);
    console.log(`  Last turn:  ${fmt(last.estimatedInputTokens)} input tokens  /  ${fmt(last.estimatedOutputTokenCap)} output cap`);
    console.log(`  Avg input:  ${fmt(avgInput)} tokens`);
    console.log(`  Messages:   ${last.messageCount}  |  Tool outputs: ${last.toolOutputCount}`);
    console.log(`  Breakdown:  system=${fmt(last.tokensFromSystem)}  session=${fmt(last.tokensFromSession)}  tools=${fmt(last.tokensFromTools)}  history=${fmt(last.tokensFromHistory)}  user=${fmt(last.tokensFromUserInput)}`);
    if (last.wasCompacted) {
      console.log(`  ⚠️  Compacted: removed ${last.removedCount} messages`);
    }
    if (last.exceedsLimit) {
      console.log(`  ❌  EXCEEDS LIMIT`);
    }
    console.log("");
  }
}
