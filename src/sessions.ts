import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "./agent/messages.js";

export interface SessionSummary {
  id: string;
  filePath: string;
  cwd: string;
  firstPrompt: string;
  messageCount: number;
  updatedAt: string;
}

export interface SessionFile {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

function sessionsDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, "kimiflare", "sessions");
}

function sanitize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function makeSessionId(firstPrompt: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = sanitize(firstPrompt) || "session";
  return `${ts}_${slug}`;
}

export async function saveSession(file: SessionFile): Promise<string> {
  const dir = sessionsDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${file.id}.json`);
  await writeFile(path, JSON.stringify(file, null, 2), "utf8");
  return path;
}

export async function listSessions(limit = 30): Promise<SessionSummary[]> {
  const dir = sessionsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      const [s, raw] = await Promise.all([stat(path), readFile(path, "utf8")]);
      const parsed = JSON.parse(raw) as SessionFile;
      const firstUser = parsed.messages.find((m) => m.role === "user");
      const firstPrompt =
        typeof firstUser?.content === "string" ? firstUser.content : "(no prompt)";
      summaries.push({
        id: parsed.id,
        filePath: path,
        cwd: parsed.cwd,
        firstPrompt: firstPrompt.slice(0, 80),
        messageCount: parsed.messages.filter((m) => m.role !== "system").length,
        updatedAt: parsed.updatedAt ?? s.mtime.toISOString(),
      });
    } catch {
      /* skip unreadable */
    }
  }
  summaries.sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1));
  return summaries.slice(0, limit);
}

export async function loadSession(filePath: string): Promise<SessionFile> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as SessionFile;
}
