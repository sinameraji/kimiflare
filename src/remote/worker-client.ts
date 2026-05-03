import type { KimiConfig } from "../config.js";
import { saveRemoteSession, type RemoteSession } from "./session-store.js";

export interface StartRemoteSessionOpts {
  prompt: string;
  repo: { owner: string; name: string };
  cfg: KimiConfig;
}

export async function startRemoteSession(opts: StartRemoteSessionOpts): Promise<{
  sessionId: string;
  streamUrl: string;
}> {
  const workerUrl = opts.cfg.remoteWorkerUrl;
  if (!workerUrl) {
    throw new Error("Remote worker URL not configured. Set remoteWorkerUrl in config.");
  }

  const githubToken = opts.cfg.githubOAuthToken;
  if (!githubToken) {
    throw new Error("GitHub token not found. Run `kimiflare auth github` first.");
  }

  const res = await fetch(`${workerUrl}/remote/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.cfg.remoteAuthSecret ?? ""}`,
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      repo: opts.repo,
      githubToken,
      accountId: opts.cfg.accountId,
      apiToken: opts.cfg.apiToken,
      model: opts.cfg.model,
      reasoningEffort: opts.cfg.reasoningEffort,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start remote session: ${res.status} ${text}`);
  }

  const data = await res.json() as { sessionId: string; streamUrl: string };

  await saveRemoteSession({
    sessionId: data.sessionId,
    prompt: opts.prompt,
    repo: `${opts.repo.owner}/${opts.repo.name}`,
    workerUrl,
    status: "running",
    branch: `kimiflare/remote/${data.sessionId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return data;
}

export async function* streamRemoteProgress(
  workerUrl: string,
  sessionId: string,
): AsyncGenerator<unknown, void, void> {
  const res = await fetch(`${workerUrl}/remote/stream/${sessionId}`);
  if (!res.ok) {
    throw new Error(`Failed to connect to stream: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

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
      if (trimmed.startsWith("data: ")) {
        try {
          const data = JSON.parse(trimmed.slice(6));
          yield data;
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
}
