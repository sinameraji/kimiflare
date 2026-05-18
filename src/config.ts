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
  /** Per-call timeout in milliseconds for tool invocations on this server. Default: 60000. */
  timeoutMs?: number;
}

export interface LspServerConfig {
  command: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  rootPatterns?: string[];
  /** Per-request timeout in milliseconds for LSP calls. Default: 10000. */
  timeoutMs?: number;
  /** Max auto-restart attempts after a crash. Default: 3. Set 0 to disable. */
  maxRestartAttempts?: number;
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
  /** Model for internal plumbing tasks (memory verification, hypothetical queries). Default: @cf/meta/llama-4-scout-17b-16e-instruct. */
  plumbingModel?: string;
  /** Model for auto-extracting high-signal edit events. Default: @cf/meta/llama-3.2-3b-instruct. */
  memoryExtractionModel?: string;
  /** Enable Code Mode: present tools as a TypeScript API and execute generated code in a sandbox. */
  codeMode?: boolean;
  /** Enable LSP integration. Default: false. */
  lspEnabled?: boolean;
  /** LSP server configurations. */
  lspServers?: Record<string, LspServerConfig>;
  /** Enable cost attribution by task type. Default: false. Once stable for 2 releases, consider defaulting to true. */
  costAttribution?: boolean;
  /** Enable @ file mention picker in chat input. Default: false. */
  filePicker?: boolean;
  /** UI theme name. Default: everforest-dark. */
  theme?: string;
  /** URL of the remote orchestrator Worker. */
  remoteWorkerUrl?: string;
  /** Shared secret for authenticating with the remote Worker. */
  remoteAuthSecret?: string;
  /** Configurable TTL for remote sessions in minutes (default: 30). */
  remoteTtlMinutes?: number;
  /** Max input token budget per remote job (default: 5_000_000). */
  remoteMaxInputTokens?: number;
  /** GitHub OAuth token for remote PR creation. */
  githubOAuthToken?: string;
  /** GitHub refresh token (if available). */
  githubRefreshToken?: string;
  /** GitHub token expiry timestamp. */
  githubTokenExpiry?: number;
  /** Default GitHub repo for remote sessions (owner/repo). */
  githubRepo?: string;
  /** Enable cloud mode: use api.kimiflare.com instead of direct Workers AI. */
  cloudMode?: boolean;
  /** Shell override for the bash tool. "auto" (default) detects the platform, or specify "bash", "cmd", "powershell", or an absolute path. */
  shell?: string;
  /** Per-provider API keys forwarded to AI Gateway as cf-aig-authorization for BYOK. */
  providerKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
    "openai-compatible"?: string;
  };
  /** When true, models marked billingMode="unified" use Cloudflare's Unified Billing (no BYOK header). */
  unifiedBilling?: boolean;
  /** Non-secret names referencing provider keys stored in Cloudflare Secrets Store with scope: ai_gateway. */
  providerKeyAliases?: {
    anthropic?: string;
    openai?: string;
    google?: string;
    "openai-compatible"?: string;
  };
  /** Id of the Cloudflare Secrets Store kimi-code uses for provider-key BYOK aliases. */
  secretsStoreId?: string;
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

function readProviderKeysEnv():
  | { anthropic?: string; openai?: string; google?: string; "openai-compatible"?: string }
  | undefined {
  const anthropic = process.env.ANTHROPIC_API_KEY || process.env.KIMIFLARE_ANTHROPIC_KEY;
  const openai = process.env.OPENAI_API_KEY || process.env.KIMIFLARE_OPENAI_KEY;
  const google = process.env.GOOGLE_API_KEY || process.env.KIMIFLARE_GOOGLE_KEY;
  const generic = process.env.KIMIFLARE_OPENAI_COMPAT_KEY;
  if (!anthropic && !openai && !google && !generic) return undefined;
  const out: { anthropic?: string; openai?: string; google?: string; "openai-compatible"?: string } = {};
  if (anthropic) out.anthropic = anthropic;
  if (openai) out.openai = openai;
  if (google) out.google = google;
  if (generic) out["openai-compatible"] = generic;
  return out;
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

function warnIfBlankGatewayId(value: string | undefined, source: string): void {
  if (value === undefined) return;
  if (value.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `kimiflare: ${source} aiGatewayId is set but empty — gateway routing will be skipped.`,
    );
  }
}

export async function loadConfig(): Promise<KimiConfig | null> {
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const envToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const envModel = process.env.KIMI_MODEL ?? DEFAULT_MODEL;
  const envEffort = readReasoningEffortEnv();
  const envCoauthor = readCoauthorEnv();
  const envAiGatewayId = process.env.KIMIFLARE_AI_GATEWAY_ID;
  warnIfBlankGatewayId(envAiGatewayId, "env");
  const envAiGatewayCacheTtl = readNumberEnv("KIMIFLARE_AI_GATEWAY_CACHE_TTL");
  const envAiGatewaySkipCache = readBooleanEnv("KIMIFLARE_AI_GATEWAY_SKIP_CACHE");
  const envAiGatewayCollectLogPayload = readBooleanEnv(
    "KIMIFLARE_AI_GATEWAY_COLLECT_LOG_PAYLOAD",
  );
  const envAiGatewayMetadata = readGatewayMetadataEnv();

  const envCacheStable = process.env.KIMIFLARE_CACHE_STABLE_PROMPTS;
  const cacheStablePrompts = envCacheStable === "0" || envCacheStable === "false" ? false : true;

  const envCompiled = process.env.KIMIFLARE_COMPILED_CONTEXT;
  const compiledContext = envCompiled === "0" || envCompiled === "false" ? false : true;

  const envImageTurns = process.env.KIMIFLARE_IMAGE_HISTORY_TURNS;
  const imageHistoryTurns = envImageTurns ? parseInt(envImageTurns, 10) : undefined;

  const envMemoryEnabled = readBooleanEnv("KIMIFLARE_MEMORY_ENABLED");
  const envMemoryDbPath = process.env.KIMIFLARE_MEMORY_DB_PATH;
  const envMemoryMaxAgeDays = readNumberEnv("KIMIFLARE_MEMORY_MAX_AGE_DAYS");
  const envMemoryMaxEntries = readNumberEnv("KIMIFLARE_MEMORY_MAX_ENTRIES");
  const envMemoryEmbeddingModel = process.env.KIMIFLARE_MEMORY_EMBEDDING_MODEL;
  const envPlumbingModel = process.env.KIMIFLARE_PLUMBING_MODEL;
  const envMemoryExtractionModel = process.env.KIMIFLARE_MEMORY_EXTRACTION_MODEL;
  const envCodeMode = readBooleanEnv("KIMIFLARE_CODE_MODE");
  const envCostAttribution = readBooleanEnv("KIMI_COST_ATTRIBUTION");
  const envFilePicker = readBooleanEnv("KIMIFLARE_FILE_PICKER");
  const envCloudMode = readBooleanEnv("KIMIFLARE_CLOUD");
  const envShell = process.env.KIMIFLARE_SHELL;
  const envProviderKeys = readProviderKeysEnv();
  const envUnifiedBilling = readBooleanEnv("KIMIFLARE_UNIFIED_BILLING");

  if (envCloudMode) {
    return {
      accountId: "",
      apiToken: "",
      model: envModel,
      cloudMode: true,
      reasoningEffort: envEffort,
      coauthor: envCoauthor?.enabled ?? true,
      coauthorName: envCoauthor?.name,
      coauthorEmail: envCoauthor?.email,
      cacheStablePrompts,
      compiledContext,
      imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? undefined : imageHistoryTurns,
      memoryEnabled: envMemoryEnabled ?? false,
      memoryDbPath: envMemoryDbPath,
      memoryMaxAgeDays: envMemoryMaxAgeDays,
      memoryMaxEntries: envMemoryMaxEntries,
      memoryEmbeddingModel: envMemoryEmbeddingModel,
      plumbingModel: envPlumbingModel,
      codeMode: envCodeMode,
      costAttribution: envCostAttribution ?? false,
      filePicker: envFilePicker ?? true,
      shell: envShell,
      providerKeys: envProviderKeys,
      unifiedBilling: envUnifiedBilling,
    };
  }

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
      reasoningEffort: envEffort,
      coauthor: envCoauthor?.enabled ?? true,
      coauthorName: envCoauthor?.name,
      coauthorEmail: envCoauthor?.email,
      cacheStablePrompts,
      compiledContext,
      imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? undefined : imageHistoryTurns,
      memoryEnabled: envMemoryEnabled ?? false,
      memoryDbPath: envMemoryDbPath,
      memoryMaxAgeDays: envMemoryMaxAgeDays,
      memoryMaxEntries: envMemoryMaxEntries,
      memoryEmbeddingModel: envMemoryEmbeddingModel,
      plumbingModel: envPlumbingModel,
      memoryExtractionModel: envMemoryExtractionModel,
      codeMode: envCodeMode ?? true,
      costAttribution: envCostAttribution ?? true,
      filePicker: envFilePicker ?? true,
      shell: envShell,
      providerKeys: envProviderKeys,
      unifiedBilling: envUnifiedBilling,
    };
  }

  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<KimiConfig>;
    if (parsed.cloudMode) {
      return {
        accountId: envAccount ?? parsed.accountId ?? "",
        apiToken: envToken ?? parsed.apiToken ?? "",
        model: envModel ?? parsed.model ?? DEFAULT_MODEL,
        cloudMode: true,
        reasoningEffort: envEffort ?? parsed.reasoningEffort,
        coauthor: envCoauthor?.enabled ?? parsed.coauthor ?? true,
        coauthorName: envCoauthor?.name ?? parsed.coauthorName,
        coauthorEmail: envCoauthor?.email ?? parsed.coauthorEmail,
        mcpServers: parsed.mcpServers,
        cacheStablePrompts: parsed.cacheStablePrompts ?? cacheStablePrompts,
        compiledContext: parsed.compiledContext ?? compiledContext,
        imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? parsed.imageHistoryTurns : imageHistoryTurns,
        memoryEnabled: envMemoryEnabled ?? parsed.memoryEnabled ?? false,
        memoryDbPath: envMemoryDbPath ?? parsed.memoryDbPath,
        memoryMaxAgeDays: envMemoryMaxAgeDays ?? parsed.memoryMaxAgeDays,
        memoryMaxEntries: envMemoryMaxEntries ?? parsed.memoryMaxEntries,
        memoryEmbeddingModel: envMemoryEmbeddingModel ?? parsed.memoryEmbeddingModel,
        plumbingModel: envPlumbingModel ?? parsed.plumbingModel,
        codeMode: envCodeMode ?? parsed.codeMode,
        costAttribution: envCostAttribution ?? parsed.costAttribution ?? false,
        filePicker: envFilePicker ?? parsed.filePicker ?? true,
        theme: parsed.theme,
        shell: envShell ?? parsed.shell,
        providerKeys: envProviderKeys ?? parsed.providerKeys,
        providerKeyAliases: parsed.providerKeyAliases,
        secretsStoreId: parsed.secretsStoreId,
        unifiedBilling: envUnifiedBilling ?? parsed.unifiedBilling,
      };
    }
    if (parsed.accountId && parsed.apiToken) {
      warnIfBlankGatewayId(parsed.aiGatewayId, "config");
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
        reasoningEffort: envEffort ?? parsed.reasoningEffort,
        coauthor: envCoauthor?.enabled ?? parsed.coauthor ?? true,
        coauthorName: envCoauthor?.name ?? parsed.coauthorName,
        coauthorEmail: envCoauthor?.email ?? parsed.coauthorEmail,
        mcpServers: parsed.mcpServers,
        cacheStablePrompts: parsed.cacheStablePrompts ?? cacheStablePrompts,
        compiledContext: parsed.compiledContext ?? compiledContext,
        imageHistoryTurns: Number.isNaN(imageHistoryTurns) ? parsed.imageHistoryTurns : imageHistoryTurns,
        memoryEnabled: envMemoryEnabled ?? parsed.memoryEnabled ?? false,
        memoryDbPath: envMemoryDbPath ?? parsed.memoryDbPath,
        memoryMaxAgeDays: envMemoryMaxAgeDays ?? parsed.memoryMaxAgeDays,
        memoryMaxEntries: envMemoryMaxEntries ?? parsed.memoryMaxEntries,
        memoryEmbeddingModel: envMemoryEmbeddingModel ?? parsed.memoryEmbeddingModel,
        plumbingModel: envPlumbingModel ?? parsed.plumbingModel,
        memoryExtractionModel: envMemoryExtractionModel ?? parsed.memoryExtractionModel,
        codeMode: envCodeMode ?? parsed.codeMode ?? true,
        costAttribution: envCostAttribution ?? parsed.costAttribution ?? true,
        filePicker: envFilePicker ?? parsed.filePicker ?? true,
        cloudMode: envCloudMode ?? parsed.cloudMode,
        theme: parsed.theme,
        shell: envShell ?? parsed.shell,
        providerKeys: envProviderKeys ?? parsed.providerKeys,
        providerKeyAliases: parsed.providerKeyAliases,
        secretsStoreId: parsed.secretsStoreId,
        unifiedBilling: envUnifiedBilling ?? parsed.unifiedBilling,
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
