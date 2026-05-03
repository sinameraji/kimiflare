export interface RemoteProgressEvent {
  type: string;
  [key: string]: unknown;
}

export interface SessionState {
  sessionId: string;
  status: "pending" | "running" | "paused" | "done" | "error" | "cancelled";
  prompt: string;
  repo: { owner: string; name: string };
  branch: string;
  artifactsRepo?: { name: string; url: string; writeToken: string };
  sandboxId?: string;
  githubToken?: string;
  progressEvents: RemoteProgressEvent[];
  prUrl?: string;
  errorMessage?: string;
  /** Categorized error type for better failure reporting. */
  errorCategory?: "agent-crash" | "sandbox-oom" | "github-api" | "timeout" | "unknown";
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  maxTurns: number;
  currentTurn: number;
  accountId?: string;
  apiToken?: string;
  model?: string;
  reasoningEffort?: string;
  /** Configurable TTL in minutes (default: 30). */
  ttlMinutes: number;
  /** Cumulative prompt tokens consumed across all turns. */
  tokensUsed?: number;
  /** Token budget for this session. */
  tokensBudget?: number;
}

export interface Env {
  SESSION_DO: DurableObjectNamespace;
  ARTIFACTS: ArtifactsBinding;
  SANDBOX: SandboxBinding;
  OAUTH_KV: KVNamespace;
  REMOTE_AUTH_SECRET: string;
  CF_API_TOKEN: string;
  GITHUB_APP_CLIENT_SECRET?: string;
}

// Cloudflare Artifacts binding (simplified — actual types may vary)
export interface ArtifactsBinding {
  createRepo(opts: { name: string }): Promise<{ name: string; url: string; writeToken: string; readToken: string }>;
  deleteRepo(name: string): Promise<void>;
}

// Cloudflare Sandbox binding (simplified — actual types may vary)
export interface SandboxBinding {
  create(opts: { id: string; image: string; env?: Record<string, string> }): Promise<SandboxInstance>;
  get(id: string): Promise<SandboxInstance>;
}

export interface SandboxInstance {
  id: string;
  exec(command: string, args?: string[], opts?: { env?: Record<string, string>; cwd?: string }): Promise<{ stdout: ReadableStream; stderr: ReadableStream }>;
  kill(): Promise<void>;
}
