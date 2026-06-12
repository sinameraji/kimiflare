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

/** Permission rule: allow, deny, or ask (default). */
export type PermissionRule = "allow" | "deny" | "ask";

/** Per-tool permission rules keyed by glob pattern. */
export type PermissionRules = Record<string, PermissionRule>;

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
  /** Model for internal plumbing tasks (memory verification, hypothetical queries). Default: @cf/moonshotai/kimi-k2.5. */
  plumbingModel?: string;
  /** Model for auto-extracting high-signal edit events. Default: @cf/moonshotai/kimi-k2.5. */
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
  /** Shell override for the bash tool. "auto" (default) detects the platform, or specify "bash", "cmd", "powershell", or an absolute path. */
  shell?: string;
  /**
   * Preferred interactive UI engine. `"ink"` is the default (stable React/Ink
   * UI); `"camouflage"` is the experimental Rust TUI. The runtime resolution
   * chain is: `--ui` flag → `KIMIFLARE_UI` env var → this field → `"ink"`.
   * Settable from inside either TUI via `/ui ink` or `/ui camouflage`;
   * takes effect on the next launch (the choice is baked at process start).
   */
  uiEngine?: "ink" | "camouflage";
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
  /** Worker endpoint URL for spawning standalone research/executor workers. */
  workerEndpoint?: string;
  /** Max cost per worker in USD (default: 1.0). */
  workerBudgetUsd?: number;
  /** Hard ceiling for workerBudgetUsd. Any configured or programmatic value above this is silently capped. Default: 5.0. */
  workerBudgetMaxUsd?: number;
  /** Max workers to spawn in parallel (default: 3). */
  workerMaxParallel?: number;
  /** Timeout per worker in milliseconds (default: 300000 = 5 min). */
  workerTimeoutMs?: number;
  /** Enable multi-agent-experimental mode in the mode cycle. Default: false. */
  multiAgentEnabled?: boolean;
  /** Turn count at which KimiFlare suggests /fresh in auto/edit mode. 0 = disabled. Default: 30. */
  autoFreshSuggestionTurns?: number;
  /** If true, automatically execute /fresh when the threshold is hit instead of just suggesting it. Default: false. */
  autoFreshEnabled?: boolean;
  /** Bearer/secret for the worker endpoint (sent as X-Worker-Api-Key). */
  workerApiKey?: string;
  /** Name of the deployed multi-agent Worker. Used for tear-down. */
  workerName?: string;
  /** When true, after plan workers synthesize, spawn one executor worker
   *  to implement the synthesized plan and open a PR. Off by default. */
  autoExecute?: boolean;
  /** Use shallow clone (`--depth 1`) for sandbox workers. Default: true. */
  workerShallowClone?: boolean;
  /** Enable repo caching / reuse hints for the Commute worker. Default: true. */
  workerRepoCache?: boolean;
  /** Forward memory context to multi-agent workers. Default: true. */
  workerProxyMemory?: boolean;
  /** Forward LSP context to multi-agent workers. Default: false. */
  workerProxyLsp?: boolean;
  /** Forward MCP context to multi-agent workers. Default: false. */
  workerProxyMcp?: boolean;
  /** Model used for LLM-based task decomposition in multi-agent mode.
   *  Default: @cf/moonshotai/kimi-k2.5 (fast and cheap). */
  decompositionModel?: string;
  /** Strategy for decomposing heavy prompts into parallel research tasks.
   *  - "llm": use a lightweight LLM call (default)
   *  - "regex": pure regex heuristic (no LLM, fastest)
   *  - "hybrid": regex for explicit lists, LLM for prose */
  decompositionStrategy?: "llm" | "regex" | "hybrid";
  /** Model for synthesizing multi-agent findings.
   *  Default: @cf/moonshotai/kimi-k2.5 (fast and cheap). */
  synthesisModel?: string;
  /** Strategy for synthesizing worker findings.
   *  - "llm": use a lightweight LLM call (default)
   *  - "heuristic": pure heuristic (no LLM, fastest)
   *  - "hybrid": try LLM, fall back to heuristic on failure */
  synthesisStrategy?: "llm" | "heuristic" | "hybrid";
  /** Explicit opt-out for LLM-based synthesis. When true, always uses heuristic. */
  disableLlmSynthesis?: boolean;
  /** Files to pre-read on the coordinator and inject into every worker's
   *  context. Saves redundant `read` tool calls across workers. Paths are
   *  relative to the repo root. */
  workerPreReadFiles?: string[];
  /** Max characters of pre-read content to inject per worker batch.
   *  Default: 50_000. */
  workerPreReadMaxChars?: number;
  /** Permission rules for headless/CI mode. Keys are tool names (e.g. "bash", "write").
   *  Values are glob-pattern → rule mappings. Patterns are matched against the
   *  target path (for file tools) or command string (for bash). */
  permissions?: Record<string, PermissionRules>;
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
  // v0.72+: always read the file up front, even when env vars provide
  // credentials. The env path used to short-circuit and return an
  // entirely env-derived object, which silently dropped settings-only
  // fields (like `uiEngine` from `/ui camouflage`, or `theme` from
  // `/theme everforest-light`) on the next launch.
  let persisted: Partial<KimiConfig> | null = null;
  try {
    const raw = await readFile(configPath(), "utf8");
    persisted = JSON.parse(raw) as Partial<KimiConfig>;
  } catch {
    /* no config file yet — env-only is still valid */
  }

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
  const envShell = process.env.KIMIFLARE_SHELL;
  const envProviderKeys = readProviderKeysEnv();
  const envUnifiedBilling = readBooleanEnv("KIMIFLARE_UNIFIED_BILLING");
  const envMultiAgentEnabled = readBooleanEnv("KIMIFLARE_MULTI_AGENT_ENABLED");
  const envWorkerPreReadFiles = process.env.KIMIFLARE_WORKER_PRE_READ_FILES
    ? process.env.KIMIFLARE_WORKER_PRE_READ_FILES.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const envWorkerPreReadMaxChars = readNumberEnv("KIMIFLARE_WORKER_PRE_READ_MAX_CHARS");

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
      // Settings-only fields: env vars don't carry these, so we read
      // them from the persisted file (when present) so the user's TUI
      // choices survive across restarts.
      uiEngine: persisted?.uiEngine,
      theme: persisted?.theme,
      providerKeys: envProviderKeys ?? persisted?.providerKeys,
      providerKeyAliases: persisted?.providerKeyAliases,
      secretsStoreId: persisted?.secretsStoreId,
      unifiedBilling: envUnifiedBilling ?? persisted?.unifiedBilling,
      workerEndpoint: process.env.KIMIFLARE_WORKER_ENDPOINT,
      workerBudgetUsd: readNumberEnv("KIMIFLARE_WORKER_BUDGET_USD"),
      workerBudgetMaxUsd: readNumberEnv("KIMIFLARE_WORKER_BUDGET_MAX_USD"),
      workerMaxParallel: readNumberEnv("KIMIFLARE_WORKER_MAX_PARALLEL"),
      workerTimeoutMs: readNumberEnv("KIMIFLARE_WORKER_TIMEOUT_MS"),
      multiAgentEnabled: envMultiAgentEnabled,
      workerApiKey: process.env.KIMIFLARE_WORKER_API_KEY,
      autoExecute: readBooleanEnv("KIMIFLARE_AUTO_EXECUTE"),
      workerShallowClone: readBooleanEnv("KIMIFLARE_WORKER_SHALLOW_CLONE") ?? true,
      workerRepoCache: readBooleanEnv("KIMIFLARE_WORKER_REPO_CACHE") ?? true,
      workerPreReadFiles: envWorkerPreReadFiles ?? persisted?.workerPreReadFiles,
      workerPreReadMaxChars: envWorkerPreReadMaxChars ?? persisted?.workerPreReadMaxChars,
    };
  }

  if (persisted) {
    const parsed = persisted;
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
        theme: parsed.theme,
        shell: envShell ?? parsed.shell,
        uiEngine: parsed.uiEngine,
        providerKeys: envProviderKeys ?? parsed.providerKeys,
        providerKeyAliases: parsed.providerKeyAliases,
        secretsStoreId: parsed.secretsStoreId,
        unifiedBilling: envUnifiedBilling ?? parsed.unifiedBilling,
        workerEndpoint: process.env.KIMIFLARE_WORKER_ENDPOINT ?? parsed.workerEndpoint,
        workerBudgetUsd: parsed.workerBudgetUsd,
        workerBudgetMaxUsd: parsed.workerBudgetMaxUsd,
        workerMaxParallel: parsed.workerMaxParallel,
        workerTimeoutMs: parsed.workerTimeoutMs,
        multiAgentEnabled: envMultiAgentEnabled ?? parsed.multiAgentEnabled,
        workerApiKey: process.env.KIMIFLARE_WORKER_API_KEY ?? parsed.workerApiKey,
        autoExecute: parsed.autoExecute,
        workerShallowClone: readBooleanEnv("KIMIFLARE_WORKER_SHALLOW_CLONE") ?? parsed.workerShallowClone ?? true,
        workerRepoCache: readBooleanEnv("KIMIFLARE_WORKER_REPO_CACHE") ?? parsed.workerRepoCache ?? true,
        workerPreReadFiles: envWorkerPreReadFiles ?? parsed.workerPreReadFiles,
        workerPreReadMaxChars: envWorkerPreReadMaxChars ?? parsed.workerPreReadMaxChars,
      };
    }
  }
  return null;
}

/** Resolve and validate a worker budget, applying the hard ceiling.
 *
 *  - If no budget is configured, returns the default (1.0).
 *  - If the configured budget is ≤ 0, throws.
 *  - If the configured budget exceeds the hard ceiling (default 5.0), it is
 *    silently capped and a warning is logged.
 */
export function resolveWorkerBudgetUsd(cfg: KimiConfig | null): number {
  const DEFAULT_WORKER_BUDGET_USD = 1.0;
  const HARD_CEILING = cfg?.workerBudgetMaxUsd ?? 5.0;

  const raw = cfg?.workerBudgetUsd ?? DEFAULT_WORKER_BUDGET_USD;
  if (raw <= 0) {
    throw new Error(
      `Invalid workerBudgetUsd (${raw}). Must be > 0. Set via /multi-agent or KIMIFLARE_WORKER_BUDGET_USD.`,
    );
  }
  if (raw > HARD_CEILING) {
    // eslint-disable-next-line no-console
    console.warn(
      `kimiflare: workerBudgetUsd ${raw} exceeds hard ceiling ${HARD_CEILING}; capping to ${HARD_CEILING}. ` +
        `Raise the ceiling with KIMIFLARE_WORKER_BUDGET_MAX_USD if you really need more.`,
    );
    return HARD_CEILING;
  }
  return raw;
}

export async function saveConfig(cfg: KimiConfig): Promise<string> {
  const p = configPath();
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2), "utf8");
  await chmod(p, 0o600);
  return p;
}
