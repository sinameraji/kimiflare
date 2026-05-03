import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RemoteSession {
  sessionId: string;
  prompt: string;
  repo: string;
  workerUrl: string;
  status: "pending" | "running" | "paused" | "done" | "error" | "cancelled";
  branch?: string;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  tokensUsed?: number;
  tokensBudget?: number;
}

function remoteDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "remote");
}

export async function saveRemoteSession(session: RemoteSession): Promise<void> {
  const dir = remoteDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${session.sessionId}.json`);
  await writeFile(path, JSON.stringify(session, null, 2) + "\n", "utf8");
}

export async function loadRemoteSession(sessionId: string): Promise<RemoteSession | null> {
  try {
    const path = join(remoteDir(), `${sessionId}.json`);
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as RemoteSession;
  } catch {
    return null;
  }
}

export async function listRemoteSessions(): Promise<RemoteSession[]> {
  const dir = remoteDir();
  try {
    const files = await readdir(dir);
    const sessions: RemoteSession[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf8");
        sessions.push(JSON.parse(raw) as RemoteSession);
      } catch {
        // ignore corrupt files
      }
    }
    return sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export async function getMostRecentRemoteSession(): Promise<RemoteSession | null> {
  const sessions = await listRemoteSessions();
  return sessions[0] ?? null;
}
