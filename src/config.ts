import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ReasoningEffort = "low" | "medium" | "high";
export const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export interface McpServerConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface KimiConfig {
  accountId: string;
  apiToken: string;
  model: string;
  aiGatewayId?: string;
  aiGatewayCacheTtl?: number;
  aiGatewaySkipCache?: boolean;
  aiGatewayCollectLogPayload?: boolean;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  theme?: string;
  reasoningEffort?: ReasoningEffort;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
  mcpServers?: Record<string, McpServerConfig>;
  cacheStablePrompts?: boolean;
  /** Enable compiled context (token-optimized state packet + artifact store). */
  compiledContext?: boolean;
  /** Number of recent user turns to retain image content; older images are dropped. */
  imageHistoryTurns?: number;
  /** Enable local structured memory (SQLite + embeddings). */
  memoryEnabled?: boolean;
  /** Path to memory database. Defaults to .kimiflare/memory.db in repo root, or ~/.local/share/kimiflare/memory.db. */
  memoryDbPath?: string;
  /** Max age of memories in days before cleanup. Default: 90. */
  memoryMaxAgeDays?: number;
  /** Max memories per repo. Default: 1000. */
  memoryMaxEntries?: number;
  /** Embedding model for memory vectors. Default: @cf/baai/bge-base-en-v1.5. */
  memoryEmbeddingModel?: string;
  /** Enable Code Mode: present tools as a TypeScript API and execute generated code in a sandbox. */
  codeMode?: boolean;
}

export const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "config.json");
}

function readReasoningEffortEnv(): ReasoningEffort | undefined {
  const raw = process.env.KIMI_REASONING_EFFORT?.toLowerCase();
  return (EFFORTS as readonly string[]).includes(raw ?? "")
    ? (raw as ReasoningEffort)
    : undefined;
}

function readCoauthorEnv(): { enabled: boolean; name: string; email: string } | undefined {
  const enabled = process.env.KIMIFLARE_COAUTHOR;
  if (enabled === "0" || enabled === "false") return undefined;
  const name = process.env.KIMIFLARE_COAUTHOR_NAME || "kimiflare";
  const email = process.env.KIMIFLARE_COAUTHOR_EMAIL || "kimiflare@proton.me";
  return { enabled: true, name, email };
}

function readBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

function readNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readGatewayMetadataEnv(): Record<string, string | number | boolean> | undefined {
  const raw = process.env.KIMIFLARE_AI_GATEWAY_METADATA;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export async function loadConfig(): Promise<KimiConfig | null> {
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const envToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const envModel = process.env.KIMI_MODEL ?? DEFAULT_MODEL;
  const envEffort = readReasoningEffortEnv();
  const envTheme = process.env.KIMI_THEME;
  const envCoauthor = readCoauthorEnv();
  const envAiGatewayId = process.env.KIMIFLARE_AI_GATEWAY_ID;
  const envAiGatewayCacheTtl = readNumberEnv("KIMIFLARE_AI_GATEWAY_CACHE_TTL");
  const envAiGatewaySkipCache = readBooleanEnv("KIMIFLARE_AI_GATEWAY_SKIP_CACHE");
  const envAiGatewayCollectLogPayload = readBooleanEnv(
    "KIMIFLARE_AI_GATEWAY_COLLECT_LOG_PAYLOAD",
  );
  const envAiGatewayMetadata = readGatewayMetadataEnv();

  const envCacheStable = process.env.KIMIFLARE_CACHE_STABLE_PROMPTS;
  const cacheStablePrompts = envCacheStable === "0" || envCacheStable === "false" ? false : true;

  const envCompiled = process.env.KIMIFLARE_COMPILED_CONTEXT;
  const compiledContext = envCompiled === "1" || envCompiled === "true" ? true : false;

  const envImageTurns = process.env.KIMIFLARE_IMAGE_HISTORY_TURNS;
  const imageHistoryTurns = envImageTurns ? parseInt(envImageTurns, 10) : undefined;

  const envMemoryEnabled = readBooleanEnv("KIMIFLARE_MEMORY_ENABLED");
  const envMemoryDbPath = process.env.KIMIFLARE_MEMORY_DB_PATH;
  const envMemoryMaxAgeDays = readNumberEnv("KIMIFLARE_MEMORY_MAX_AGE_DAYS");
  const envMemoryMaxEntries = readNumberEnv("KIMIFLARE_MEMORY_MAX_ENTRIES");
  const envMemoryEmbeddingModel = process.env.KIMIFLARE_MEMORY_EMBEDDING_MODEL;
  const envCodeMode = readBooleanEnv("KIMIFLARE_CODE_MODE");

  if (envAccount && envToken) {
    return {
      accountId: envAccount,
      apiToken: envToken,
      model: envModel,
      aiGatewayId: envAiGatewayId,
      aiGatewayCacheTtl: envAiGatewayCacheTtl,
      aiGatewaySkipCache: envAiGatewaySkipCache,
      aiGatewayCollectLogPayload: envAiGatewayCollectLogPayload,
      aiGatewayMetadata: envAiGatewayMetadata,
      theme: envTheme,
      reasoningEffort: envEffort,
      coauthor: envCoauthor?.enabled ?? true,
      coauthorName: envCoauthor?.name,
      coauthorEmail: envCoauthor?.email,
      cacheStablePrompts,
      compiledContext,
      imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? undefined : imageHistoryTurns,
      memoryEnabled: envMemoryEnabled,
      memoryDbPath: envMemoryDbPath,
      memoryMaxAgeDays: envMemoryMaxAgeDays,
      memoryMaxEntries: envMemoryMaxEntries,
      memoryEmbeddingModel: envMemoryEmbeddingModel,
      codeMode: envCodeMode,
    };
  }

  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<KimiConfig>;
    if (parsed.accountId && parsed.apiToken) {
      return {
        accountId: envAccount ?? parsed.accountId,
        apiToken: envToken ?? parsed.apiToken,
        model: envModel ?? parsed.model ?? DEFAULT_MODEL,
        aiGatewayId: envAiGatewayId ?? parsed.aiGatewayId,
        aiGatewayCacheTtl: envAiGatewayCacheTtl ?? parsed.aiGatewayCacheTtl,
        aiGatewaySkipCache: envAiGatewaySkipCache ?? parsed.aiGatewaySkipCache,
        aiGatewayCollectLogPayload:
          envAiGatewayCollectLogPayload ?? parsed.aiGatewayCollectLogPayload,
        aiGatewayMetadata: envAiGatewayMetadata ?? parsed.aiGatewayMetadata,
        theme: envTheme ?? parsed.theme,
        reasoningEffort: envEffort ?? parsed.reasoningEffort,
        coauthor: envCoauthor?.enabled ?? parsed.coauthor ?? true,
        coauthorName: envCoauthor?.name ?? parsed.coauthorName,
        coauthorEmail: envCoauthor?.email ?? parsed.coauthorEmail,
        mcpServers: parsed.mcpServers,
        cacheStablePrompts: parsed.cacheStablePrompts ?? cacheStablePrompts,
        compiledContext: parsed.compiledContext ?? compiledContext,
        imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? parsed.imageHistoryTurns : imageHistoryTurns,
        memoryEnabled: envMemoryEnabled ?? parsed.memoryEnabled,
        memoryDbPath: envMemoryDbPath ?? parsed.memoryDbPath,
        memoryMaxAgeDays: envMemoryMaxAgeDays ?? parsed.memoryMaxAgeDays,
        memoryMaxEntries: envMemoryMaxEntries ?? parsed.memoryMaxEntries,
        memoryEmbeddingModel: envMemoryEmbeddingModel ?? parsed.memoryEmbeddingModel,
        codeMode: envCodeMode ?? parsed.codeMode,
      };
    }
  } catch {
    /* no config file */
  }
  return null;
}

export async function saveConfig(cfg: KimiConfig): Promise<string> {
  const p = configPath();
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2), "utf8");
  await chmod(p, 0o600);
  return p;
}
