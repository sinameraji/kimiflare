/**
 * Layer 1: Heuristic classification based on tool calls, file extensions,
 * and bash command patterns. Deterministic, free, fast.
 */

import type { TaskCategory, TaskCategorization, SignalEntry } from "./types.js";

// File extension → category mappings
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
  ".swift", ".cpp", ".c", ".h", ".hpp", ".cs", ".rb", ".php", ".scala",
  ".clj", ".erl", ".ex", ".exs", ".elm", ".hs", ".lua", ".r", ".m",
  ".mm", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".vim", ".el",
]);

const DOC_EXTS = new Set([
  ".md", ".txt", ".rst", ".adoc", ".org",
]);

const CONFIG_EXTS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg",
  ".env", ".envrc", ".properties", ".xml", ".plist",
]);

const DATA_EXTS = new Set([
  ".csv", ".sql", ".db", ".sqlite", ".parquet", ".jsonl",
  ".ndjson", ".tsv", ".psv",
]);

const TEST_PATTERNS = /\.(test|spec)\./;

// Bash command → category mappings
const TEST_COMMANDS = /\b(npm test|pytest|jest|vitest|mocha|ava|tap|cargo test|go test|dotnet test|gradle test|mvn test|rake test|bundle exec rspec)\b/;
const GIT_COMMANDS = /\b(git commit|git merge|git rebase|git diff|git log|git blame|git cherry-pick|git revert)\b/;
const BUILD_COMMANDS = /\b(npm run build|make|cargo build|go build|gradle build|mvn compile|dotnet build|yarn build|pnpm build|webpack|vite build|tsc|esbuild|rollup)\b/;
const DEPLOY_COMMANDS = /\b(docker|kubectl|helm|wrangler deploy|terraform apply|pulumi up|serverless deploy|aws deploy|gcloud deploy|fly deploy|vercel deploy|netlify deploy)\b/;

interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

interface TurnData {
  toolCalls: ToolCall[];
  tokens?: number;
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function classifyFile(path: string): TaskCategory | null {
  const base = basename(path);
  const ext = extOf(path);

  if (TEST_PATTERNS.test(base)) return "writing-tests";
  if (base.toLowerCase().startsWith("readme")) return "reading-documentation";
  if (SOURCE_EXTS.has(ext)) return null; // depends on tool
  if (DOC_EXTS.has(ext)) return "reading-documentation";
  if (CONFIG_EXTS.has(ext)) return "reading-configuration";
  if (DATA_EXTS.has(ext)) return "reading-data";
  return null;
}

function classifyWriteFile(path: string): TaskCategory | null {
  const base = basename(path);
  const ext = extOf(path);

  if (TEST_PATTERNS.test(base)) return "writing-tests";
  if (base.toLowerCase().startsWith("readme") || DOC_EXTS.has(ext)) return "writing-documentation";
  if (CONFIG_EXTS.has(ext)) return "writing-configuration";
  if (SOURCE_EXTS.has(ext)) return "writing-source-code";
  return null;
}

function classifyEditFile(path: string): TaskCategory | null {
  const base = basename(path);
  const ext = extOf(path);

  if (base.toLowerCase().startsWith("readme") || DOC_EXTS.has(ext)) return "editing-documentation";
  if (CONFIG_EXTS.has(ext)) return "editing-configuration";
  if (SOURCE_EXTS.has(ext)) return "editing-source-code";
  return null;
}

function classifyBash(command: string): TaskCategory | null {
  if (TEST_COMMANDS.test(command)) return "running-tests";
  if (GIT_COMMANDS.test(command)) return "running-git-commands";
  if (BUILD_COMMANDS.test(command)) return "running-build-scripts";
  if (DEPLOY_COMMANDS.test(command)) return "running-deploy-commands";
  return "running-shell-commands";
}

function classifyToolCall(tool: ToolCall): { category: TaskCategory; confidence: number } | null {
  const args = tool.arguments ?? {};
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "";
  const command = typeof args.command === "string" ? args.command : "";

  switch (tool.name) {
    case "read_file":
    case "read": {
      const cat = classifyFile(path);
      if (cat) return { category: cat, confidence: 0.8 };
      if (SOURCE_EXTS.has(extOf(path))) return { category: "reading-source-code", confidence: 0.8 };
      return null;
    }
    case "create_file":
    case "write_file":
    case "write": {
      const cat = classifyWriteFile(path);
      if (cat) return { category: cat, confidence: 0.9 };
      return null;
    }
    case "str_replace":
    case "edit": {
      const cat = classifyEditFile(path);
      if (cat) return { category: cat, confidence: 0.85 };
      return null;
    }
    case "bash": {
      const cat = classifyBash(command);
      if (cat) return { category: cat, confidence: 0.9 };
      return null;
    }
    case "web_fetch":
      return { category: "reading-web-content", confidence: 0.85 };
    case "grep":
    case "glob": {
      const pattern = typeof args.pattern === "string" ? args.pattern : path;
      const isSource = SOURCE_EXTS.has(extOf(pattern)) || /\.(ts|js|py|go|rs)\b/.test(pattern);
      return { category: isSource ? "searching-code" : "searching-code", confidence: 0.75 };
    }
    case "execute_code":
      return { category: "other", confidence: 0.6 };
    default:
      return null;
  }
}

export function classifyTurn(turn: TurnData): SignalEntry[] {
  const signals: SignalEntry[] = [];
  for (const tool of turn.toolCalls) {
    const result = classifyToolCall(tool);
    if (result) {
      signals.push({
        category: result.category,
        weight: turn.tokens ?? 1,
        confidence: result.confidence,
      });
    }
  }
  return signals;
}

export function classifySession(
  turns: TurnData[],
  opts?: { totalTurns?: number; totalToolCalls?: number },
): TaskCategorization {
  const scores = new Map<TaskCategory, number>();

  for (const turn of turns) {
    const signals = classifyTurn(turn);
    for (const s of signals) {
      scores.set(s.category, (scores.get(s.category) ?? 0) + s.weight * s.confidence);
    }
  }

  // Short session fallback
  const totalTurns = opts?.totalTurns ?? turns.length;
  const totalToolCalls = opts?.totalToolCalls ?? turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  if (totalTurns < 3 && totalToolCalls < 5) {
    scores.set("other", (scores.get("other") ?? 0) + 0.6);
  }

  if (scores.size === 0) {
    return { category: "other", confidence: 0.6, classifiedBy: "heuristic", summary: "Short or ambiguous session" };
  }

  // Pick dominant category
  let bestCategory: TaskCategory = "other";
  let bestScore = -1;
  let totalScore = 0;

  for (const [cat, score] of scores) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  const confidence = totalScore > 0 ? bestScore / totalScore : 0;

  return {
    category: bestCategory,
    confidence: Math.round(confidence * 100) / 100,
    classifiedBy: "heuristic",
  };
}

export function needsLlmFallback(result: TaskCategorization): boolean {
  return result.confidence < 0.6 || result.category === "other";
}
