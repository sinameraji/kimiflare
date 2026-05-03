import type { SessionState, RemoteProgressEvent, Env } from "./types.js";
import { createPullRequest, createIssue, getDefaultBranch } from "./github.js";

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
      if (this.sessionState) {
        this.sessionState.status = "error";
        this.sessionState.errorMessage = message;
        this.sessionState.finishedAt = Date.now();
        await this.saveState();
      }
      this.broadcast({ type: "error", message });
    }
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

    // Try to kill sandbox
    if (this.sessionState.sandboxId) {
      try {
        const sandbox = await this.env.SANDBOX.get(this.sessionState.sandboxId);
        await sandbox.kill();
      } catch {
        // ignore
      }
    }

    this.broadcast({ type: "cancelled" });
    this.stopHeartbeat();
    return Response.json({ status: "cancelled" });
  }

  private handleStatus(): Response {
    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json(this.sessionState);
  }

  private async handleProgress(request: Request): Promise<Response> {
    const body = await request.json() as RemoteProgressEvent;
    if (this.sessionState) {
      this.sessionState.progressEvents.push(body);
      if (this.sessionState.progressEvents.length > MAX_EVENTS) {
        this.sessionState.progressEvents.shift();
      }
      this.broadcast(body);
      await this.saveState();
    }
    return Response.json({ ok: true });
  }

  private async handleFinalize(request: Request): Promise<Response> {
    const body = await request.json() as {
      exitCode: number;
      hasChanges: boolean;
      errorLog?: string;
    };

    if (!this.sessionState) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    this.stopHeartbeat();

    const { repo, branch, githubToken, prompt } = this.sessionState;

    try {
      if (body.exitCode === 0 && body.hasChanges) {
        // Open PR
        const base = await getDefaultBranch({ owner: repo.owner, repo: repo.name, token: githubToken! });
        const pr = await createPullRequest({
          owner: repo.owner,
          repo: repo.name,
          title: `kimiflare remote: ${prompt.slice(0, 80)}`,
          body: `Automated changes from kimiflare remote session.\n\nPrompt: ${prompt}`,
          head: branch,
          base,
          token: githubToken!,
        });
        this.sessionState.prUrl = pr.html_url;
        this.sessionState.status = "done";
      } else if (body.exitCode === 0 && !body.hasChanges) {
        // Open issue with findings
        const issue = await createIssue({
          owner: repo.owner,
          repo: repo.name,
          title: `kimiflare remote findings: ${prompt.slice(0, 80)}`,
          body: `No code changes were made.\n\nPrompt: ${prompt}`,
          token: githubToken!,
        });
        this.sessionState.prUrl = issue.html_url;
        this.sessionState.status = "done";
      } else if (body.exitCode === 42) {
        // Budget exhausted — open PR if changes exist, else issue
        if (body.hasChanges) {
          const base = await getDefaultBranch({ owner: repo.owner, repo: repo.name, token: githubToken! });
          const pr = await createPullRequest({
            owner: repo.owner,
            repo: repo.name,
            title: `kimiflare remote (budget exhausted): ${prompt.slice(0, 80)}`,
            body: `Automated changes from kimiflare remote session.\n\nPrompt: ${prompt}\n\nNote: Token budget was exhausted before completion.`,
            head: branch,
            base,
            token: githubToken!,
          });
          this.sessionState.prUrl = pr.html_url;
        } else {
          const issue = await createIssue({
            owner: repo.owner,
            repo: repo.name,
            title: `kimiflare remote (budget exhausted): ${prompt.slice(0, 80)}`,
            body: `No code changes were made. Token budget was exhausted.\n\nPrompt: ${prompt}`,
            token: githubToken!,
          });
          this.sessionState.prUrl = issue.html_url;
        }
        this.sessionState.status = "done";
      } else {
        // Crash — open issue with error log
        const issue = await createIssue({
          owner: repo.owner,
          repo: repo.name,
          title: `kimiflare remote error: ${prompt.slice(0, 80)}`,
          body: `The remote session encountered an error.\n\nPrompt: ${prompt}\n\n\`\`\`\n${body.errorLog ?? "Unknown error"}\n\`\`\``,
          token: githubToken!,
        });
        this.sessionState.prUrl = issue.html_url;
        this.sessionState.status = "error";
        this.sessionState.errorMessage = body.errorLog ?? "Unknown error";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sessionState.status = "error";
      this.sessionState.errorMessage = message;
    }

    this.sessionState.finishedAt = Date.now();
    await this.saveState();
    this.broadcast({ type: "done", prUrl: this.sessionState.prUrl });

    // Cleanup
    if (this.sessionState.sandboxId) {
      try {
        const sandbox = await this.env.SANDBOX.get(this.sessionState.sandboxId);
        await sandbox.kill();
      } catch {
        // ignore
      }
    }
    if (this.sessionState.artifactsRepo) {
      try {
        await this.env.ARTIFACTS.deleteRepo(this.sessionState.artifactsRepo.name);
      } catch {
        // ignore
      }
    }

    return Response.json({ ok: true });
  }

  private async handleRelay(request: Request): Promise<Response> {
    const body = await request.json() as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

    const res = await fetch(body.url, {
      method: body.method ?? "GET",
      headers: body.headers,
      body: body.body,
    });

    const resBody = await res.text();
    return new Response(resBody, {
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
      this.broadcast({ type: "heartbeat", timestamp: Date.now() });
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async alarm(): Promise<void> {
    // Emergency cleanup — session timed out
    if (this.sessionState && this.sessionState.status === "running") {
      this.sessionState.status = "error";
      this.sessionState.errorMessage = "Session timed out";
      this.sessionState.finishedAt = Date.now();
      await this.saveState();
      this.broadcast({ type: "error", message: "Session timed out" });

      // Try to open issue
      try {
        const { repo, githubToken, prompt } = this.sessionState;
        const issue = await createIssue({
          owner: repo.owner,
          repo: repo.name,
          title: `kimiflare remote timeout: ${prompt.slice(0, 80)}`,
          body: `The remote session timed out after ${this.sessionState.ttlMinutes} minutes.\n\nPrompt: ${prompt}`,
          token: githubToken!,
        });
        this.sessionState.prUrl = issue.html_url;
        await this.saveState();
      } catch {
        // ignore
      }
    }

    // Cleanup sandbox and artifacts
    if (this.sessionState?.sandboxId) {
      try {
        const sandbox = await this.env.SANDBOX.get(this.sessionState.sandboxId);
        await sandbox.kill();
      } catch {
        // ignore
      }
    }
    if (this.sessionState?.artifactsRepo) {
      try {
        await this.env.ARTIFACTS.deleteRepo(this.sessionState.artifactsRepo.name);
      } catch {
        // ignore
      }
    }

    this.stopHeartbeat();
  }
}
