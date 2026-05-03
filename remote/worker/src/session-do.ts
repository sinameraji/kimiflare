import type { SessionState, RemoteProgressEvent, Env } from "./types.js";
import { createPullRequest, getDefaultBranch } from "./github.js";

const MAX_EVENTS = 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessionState: SessionState | null = null;
  private clients: Set<ReadableStreamDefaultController<string>> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Restore state from storage if available
    if (!this.sessionState) {
      const stored = await this.state.storage.get<SessionState>("state");
      if (stored) this.sessionState = stored;
    }

    if (path.endsWith("/start") && request.method === "POST") {
      return this.handleStart(request);
    }
    if (path.endsWith("/stream") && request.method === "GET") {
      return this.handleStream();
    }
    if (path.endsWith("/cancel") && request.method === "POST") {
      return this.handleCancel();
    }
    if (path.endsWith("/status") && request.method === "GET") {
      return this.handleStatus();
    }
    if (path.endsWith("/progress") && request.method === "POST") {
      return this.handleProgress(request);
    }
    if (path.endsWith("/finalize") && request.method === "POST") {
      return this.handleFinalize(request);
    }
    if (path.endsWith("/relay") && request.method === "POST") {
      return this.handleRelay(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleStart(request: Request): Promise<Response> {
    const body = await request.json() as {
      prompt: string;
      repo: { owner: string; name: string };
      githubToken: string;
      accountId: string;
      apiToken: string;
      model?: string;
      maxTurns?: number;
      reasoningEffort?: string;
      ttlMinutes?: number;
      tokensBudget?: number;
    };
    const ttlMinutes = body.ttlMinutes ?? 30;

    const sessionId = this.state.id.toString();
    const branch = `kimiflare/remote/${sessionId}`;

    // Create Artifacts repo
    const artifactsRepo = await this.env.ARTIFACTS.createRepo({
      name: `kf-${sessionId}`,
    });

    // Create Sandbox
    const sandbox = await this.env.SANDBOX.create({
      id: sessionId,
      image: "ghcr.io/sinameraji/kimiflare-remote-agent:latest",
      env: {
        SESSION_ID: sessionId,
        ARTIFACTS_URL: artifactsRepo.url,
        ARTIFACTS_TOKEN: artifactsRepo.writeToken,
        WORKER_RELAY_URL: `https://${request.headers.get("host")}/relay`,
        PROGRESS_URL: `https://${request.headers.get("host")}/progress`,
        FINALIZE_URL: `https://${request.headers.get("host")}/finalize`,
        REPO_OWNER: body.repo.owner,
        REPO_NAME: body.repo.name,
        GITHUB_BRANCH: branch,
        PROMPT: body.prompt,
        MODEL: body.model ?? "@cf/moonshotai/kimi-k2.6",
        MAX_TURNS: String(body.maxTurns ?? 50),
        REASONING_EFFORT: body.reasoningEffort ?? "medium",
        ACCOUNT_ID: body.accountId,
        API_TOKEN: body.apiToken,
      },
    });

    this.sessionState = {
      sessionId,
      status: "running",
      prompt: body.prompt,
      repo: body.repo,
      branch,
      artifactsRepo: {
        name: artifactsRepo.name,
        url: artifactsRepo.url,
        writeToken: artifactsRepo.writeToken,
      },
      sandboxId: sandbox.id,
      githubToken: body.githubToken,
      progressEvents: [],
      maxTurns: body.maxTurns ?? 50,
      currentTurn: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: Date.now(),
      accountId: body.accountId,
      apiToken: body.apiToken,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      ttlMinutes,
      tokensBudget: body.tokensBudget,
    };

    await this.saveState();

    // Set alarm for max session duration (configurable TTL, capped at 4 hours)
    const alarmMs = Math.min(ttlMinutes * 60 * 1000, 4 * 60 * 60 * 1000);
    await this.state.storage.setAlarm(Date.now() + alarmMs);

    // Start heartbeat
    this.startHeartbeat();

    // Start agent in background (don't await — it runs for minutes/hours)
    this.runAgentInSandbox(sandbox);

    return Response.json({
      sessionId,
      streamUrl: `/remote/stream/${sessionId}`,
      status: "running",
    });
  }

  private async runAgentInSandbox(sandbox: import("./types.js").SandboxInstance): Promise<void> {
    try {
      const result = await sandbox.exec("node", ["/opt/kimiflare/dist/remote-agent.js"]);

      // Stream stdout
      const reader = result.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as RemoteProgressEvent;
            if (this.sessionState) {
              this.sessionState.progressEvents.push(event);
              if (this.sessionState.progressEvents.length > MAX_EVENTS) {
                this.sessionState.progressEvents.shift();
              }
              this.broadcast(event);

              if (event.type === "turn_start" && typeof (event as Record<string, unknown>).turn === "number") {
                this.sessionState.currentTurn = (event as Record<string, unknown>).turn as number;
              }

              // Track token usage from usage events
              if (event.type === "usage" && typeof (event as Record<string, unknown>).promptTokens === "number") {
                const promptTokens = (event as Record<string, unknown>).promptTokens as number;
                const completionTokens = (event as Record<string, unknown>).completionTokens as number;
                this.sessionState.tokensUsed = (this.sessionState.tokensUsed ?? 0) + promptTokens + completionTokens;
              }
            }
          } catch {
            // Not JSON — treat as raw log
            this.broadcast({ type: "log", text: trimmed });
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const category = this.categorizeError(message);
      if (this.sessionState) {
        this.sessionState.status = "error";
        this.sessionState.errorMessage = message;
        this.sessionState.errorCategory = category;
        this.sessionState.finishedAt = Date.now();
        await this.saveState();
      }
      this.broadcast({ type: "error", message, category });
    }
  }

  private categorizeError(message: string): "agent-crash" | "sandbox-oom" | "github-api" | "timeout" | "unknown" {
    const lower = message.toLowerCase();
    if (lower.includes("out of memory") || lower.includes("oom") || lower.includes("killed") || lower.includes("memory limit")) {
      return "sandbox-oom";
    }
    if (lower.includes("github") && (lower.includes("api") || lower.includes("rate limit") || lower.includes("401") || lower.includes("403"))) {
      return "github-api";
    }
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
      return "timeout";
    }
    if (lower.includes("exit code 1") || lower.includes("error") || lower.includes("crash") || lower.includes("exception")) {
      return "agent-crash";
    }
    return "unknown";
  }

  private handleStream(): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<string>({
      start: (controller) => {
        this.clients.add(controller);
        // Send existing events
        if (this.sessionState) {
          for (const ev of this.sessionState.progressEvents) {
            controller.enqueue(`data: ${JSON.stringify(ev)}\n\n`);
          }
        }
      },
      cancel: () => {
        // Find and remove this controller
        for (const client of this.clients) {
          try {
            client.close();
          } catch {
            // ignore
          }
        }
        this.clients.clear();
      },
    });

    return new Response(stream as unknown as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private async handleCancel(): Promise<Response> {
    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    this.sessionState.status = "cancelled";
    this.sessionState.finishedAt = Date.now();
    await this.saveState();

    // Kill sandbox
    try {
      const sandbox = await this.env.SANDBOX.get(this.sessionState.sandboxId!);
      await sandbox.kill();
    } catch {
      // ignore
    }

    this.broadcast({ type: "cancelled" });
    return Response.json({ status: "cancelled" });
  }

  private handleStatus(): Response {
    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    // Don't expose sensitive tokens
    const { githubToken, artifactsRepo, apiToken, ...safe } = this.sessionState;
    return Response.json({
      ...safe,
      artifactsRepo: artifactsRepo ? { name: artifactsRepo.name, url: artifactsRepo.url } : undefined,
    });
  }

  private async handleProgress(request: Request): Promise<Response> {
    const body = await request.json() as { events: RemoteProgressEvent[] };

    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    for (const ev of body.events) {
      this.sessionState.progressEvents.push(ev);
      if (this.sessionState.progressEvents.length > MAX_EVENTS) {
        this.sessionState.progressEvents.shift();
      }
      this.broadcast(ev);

      if (ev.type === "turn_start" && typeof ev.turn === "number") {
        this.sessionState.currentTurn = ev.turn;
      }

      // Track token usage from usage events
      if (ev.type === "usage" && typeof ev.promptTokens === "number") {
        const promptTokens = ev.promptTokens;
        const completionTokens = typeof ev.completionTokens === "number" ? ev.completionTokens : 0;
        this.sessionState.tokensUsed = (this.sessionState.tokensUsed ?? 0) + promptTokens + completionTokens;
      }
    }

    this.sessionState.updatedAt = Date.now();
    await this.saveState();

    return Response.json({ ok: true });
  }

  private async handleFinalize(request: Request): Promise<Response> {
    const body = await request.json() as { summary: string; commitCount: number };

    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    this.sessionState.status = "done";
    this.sessionState.finishedAt = Date.now();

    // Create PR
    try {
      const defaultBranch = await getDefaultBranch(
        this.sessionState.githubToken!,
        this.sessionState.repo,
      );

      const pr = await createPullRequest(
        this.sessionState.githubToken!,
        this.sessionState.repo,
        this.sessionState.branch,
        `feat: ${this.sessionState.prompt.slice(0, 60)}`,
        buildPrBody(this.sessionState, body.summary, body.commitCount),
      );

      this.sessionState.prUrl = pr.html_url;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sessionState.errorMessage = message;
      this.sessionState.status = "error";
    }

    await this.saveState();
    this.broadcast({
      type: "done",
      prUrl: this.sessionState.prUrl,
      tokensUsed: this.sessionState.tokensUsed,
      tokensBudget: this.sessionState.tokensBudget,
    });

    // Schedule cleanup alarm
    await this.state.storage.setAlarm(Date.now() + SESSION_TTL_MS);

    return Response.json({
      status: this.sessionState.status,
      prUrl: this.sessionState.prUrl,
    });
  }

  private async handleRelay(request: Request): Promise<Response> {
    const body = await request.json() as {
      model: string;
      messages: unknown[];
      tools?: unknown[];
      temperature?: number;
      maxCompletionTokens?: number;
      reasoningEffort?: string;
    };

    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const accountId = this.sessionState.accountId;
    const apiToken = this.env.CF_API_TOKEN;

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${body.model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: body.messages,
          tools: body.tools,
          temperature: body.temperature,
          max_tokens: body.maxCompletionTokens,
          reasoning_effort: body.reasoningEffort,
        }),
      },
    );

    // Stream the response back
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  private broadcast(event: RemoteProgressEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.enqueue(data);
      } catch {
        // Client disconnected
      }
    }
  }

  private async saveState(): Promise<void> {
    if (this.sessionState) {
      await this.state.storage.put("state", this.sessionState);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: "heartbeat" });
    }, 30000);
  }

  async alarm(): Promise<void> {
    if (!this.sessionState) return;

    // If session is still running, it's a timeout
    if (this.sessionState.status === "running") {
      const ttl = this.sessionState.ttlMinutes ?? 30;
      this.sessionState.status = "error";
      this.sessionState.errorMessage = `Session timed out after ${ttl} minutes`;
      this.sessionState.errorCategory = "timeout";
      this.sessionState.finishedAt = Date.now();
      await this.saveState();
      this.broadcast({ type: "error", message: this.sessionState.errorMessage, category: "timeout" });

      // Kill sandbox
      try {
        const sandbox = await this.env.SANDBOX.get(this.sessionState.sandboxId!);
        await sandbox.kill();
      } catch {
        // ignore
      }
    }

    // Clean up artifacts repo after TTL
    if (this.sessionState.artifactsRepo) {
      try {
        await this.env.ARTIFACTS.deleteRepo(this.sessionState.artifactsRepo.name);
      } catch {
        // ignore
      }
    }

    // Clean up storage
    await this.state.storage.deleteAll();
  }
}

function buildPrBody(
  state: SessionState,
  summary: string,
  commitCount: number,
): string {
  return `## 🤖 Kimiflare Remote Session

**Session ID:** \`${state.sessionId}\`
**Prompt:**
> ${state.prompt}

**Summary:**
${summary}

**Commits:** ${commitCount}
**Turns:** ${state.currentTurn} / ${state.maxTurns}
**Status:** ${state.status === "done" ? "✅ Completed" : "⚠️ Incomplete"}

**View live log:** [Session status page](https://placeholder/remote/web/${state.sessionId})

---
*This PR was generated by [kimiflare](https://github.com/sinameraji/kimiflare) in remote mode.*
`;
}
