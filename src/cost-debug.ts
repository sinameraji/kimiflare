import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, Usage } from "./agent/messages.js";
import type { ToolResult } from "./tools/executor.js";

const LOG_VERSION = 1;

export interface PromptSection {
  role: string;
  chars: number;
  approxTokens: number;
  detail?: string;
}

export interface ToolByteStats {
  name: string;
  rawBytes: number;
  reducedBytes: number;
  savingsPct: number;
}

export interface CostDebugEntry {
  v: number;
  ts: string;
  sessionId: string;
  turn: number;
  usage: Usage;
  promptSections: PromptSection[];
  promptTotalChars: number;
  promptTotalApproxTokens: number;
  toolStats: ToolByteStats[];
  toolTotalRawBytes: number;
  toolTotalReducedBytes: number;
  toolSavingsPct: number;
}

function debugDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, "kimiflare");
}

function debugPath(): string {
  return join(debugDir(), "cost-debug.jsonl");
}

function now(): string {
  return new Date().toISOString();
}

function approxTokens(chars: number): number {
  // Rough heuristic: ~4 chars per token for English/code
  return Math.round(chars / 4);
}

export function analyzePrompt(messages: ChatMessage[]): PromptSection[] {
  const sections: PromptSection[] = [];
  for (const m of messages) {
    let contentStr = "";
    if (typeof m.content === "string") {
      contentStr = m.content;
    } else if (Array.isArray(m.content)) {
      contentStr = m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ");
    }

    const chars = contentStr.length;
    const base: PromptSection = {
      role: m.role,
      chars,
      approxTokens: approxTokens(chars),
    };

    if (m.role === "assistant" && m.reasoning_content) {
      sections.push({
        ...base,
        detail: `content+reasoning (${approxTokens(m.reasoning_content.length)} reasoning tokens)`,
        chars: chars + m.reasoning_content.length,
        approxTokens: approxTokens(chars + m.reasoning_content.length),
      });
    } else if (m.role === "tool") {
      sections.push({
        ...base,
        detail: m.name ? `tool: ${m.name}` : undefined,
      });
    } else {
      sections.push(base);
    }
  }
  return sections;
}

export function buildToolStats(results: ToolResult[]): ToolByteStats[] {
  return results.map((r) => {
    const raw = r.rawBytes ?? Buffer.byteLength(r.content, "utf8");
    const reduced = r.reducedBytes ?? raw;
    const savings = raw > 0 ? Math.round(((raw - reduced) / raw) * 100) : 0;
    return {
      name: r.name,
      rawBytes: raw,
      reducedBytes: reduced,
      savingsPct: savings,
    };
  });
}

export async function logCostDebug(entry: CostDebugEntry): Promise<void> {
  await mkdir(debugDir(), { recursive: true });
  await appendFile(debugPath(), JSON.stringify(entry) + "\n", "utf8");
}

export interface TurnDebugContext {
  sessionId: string;
  turn: number;
  messages: ChatMessage[];
  toolResults: ToolResult[];
  usage: Usage;
}

export async function logTurnDebug(ctx: TurnDebugContext): Promise<void> {
  const promptSections = analyzePrompt(ctx.messages);
  const promptTotalChars = promptSections.reduce((sum, s) => sum + s.chars, 0);
  const toolStats = buildToolStats(ctx.toolResults);
  const toolTotalRaw = toolStats.reduce((sum, t) => sum + t.rawBytes, 0);
  const toolTotalReduced = toolStats.reduce((sum, t) => sum + t.reducedBytes, 0);

  await logCostDebug({
    v: LOG_VERSION,
    ts: now(),
    sessionId: ctx.sessionId,
    turn: ctx.turn,
    usage: ctx.usage,
    promptSections,
    promptTotalChars,
    promptTotalApproxTokens: approxTokens(promptTotalChars),
    toolStats,
    toolTotalRawBytes: toolTotalRaw,
    toolTotalReducedBytes: toolTotalReduced,
    toolSavingsPct: toolTotalRaw > 0 ? Math.round(((toolTotalRaw - toolTotalReduced) / toolTotalRaw) * 100) : 0,
  });
}
