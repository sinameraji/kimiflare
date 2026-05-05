/**
 * Kimiflare Cloud — Device Authentication
 *
 * Flow:
 * 1. CLI generates device_code + user_code
 * 2. POST /auth/device to register
 * 3. Show user URL: https://api.kimiflare.com/auth/github?code=<user_code>
 * 4. Poll POST /auth/poll until approved
 * 5. Store JWT in config
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLOUD_API_URL = "https://api.kimiflare.com";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface CloudCredentials {
  accessToken: string;
  expiresAt: number;
}

function cloudCredPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "cloud.json");
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function loadCloudCredentials(): Promise<CloudCredentials | null> {
  try {
    const raw = await readFile(cloudCredPath(), "utf8");
    const parsed = JSON.parse(raw) as CloudCredentials;
    if (parsed.expiresAt && parsed.expiresAt > Date.now() / 1000) {
      return parsed;
    }
  } catch {
    /* no creds or expired */
  }
  return null;
}

export async function saveCloudCredentials(creds: CloudCredentials): Promise<void> {
  const p = cloudCredPath();
  await writeFile(p, JSON.stringify(creds, null, 2), "utf8");
}

export async function clearCloudCredentials(): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(cloudCredPath());
  } catch {
    /* ignore */
  }
}

export async function authenticateDevice(
  onStatus: (status: { url: string; userCode: string; polling: boolean }) => void,
): Promise<CloudCredentials> {
  const deviceCode = `device-${generateCode()}-${Date.now()}`;
  const userCode = `${generateCode()}-${generateCode()}`;

  // Register device code
  const registerRes = await fetch(`${CLOUD_API_URL}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode, user_code: userCode }),
  });

  if (!registerRes.ok) {
    const err = (await registerRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Failed to register device: ${err.error || registerRes.statusText}`);
  }

  const authUrl = `${CLOUD_API_URL}/auth/github?code=${encodeURIComponent(userCode)}`;
  onStatus({ url: authUrl, userCode, polling: false });

  // Poll for approval
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    onStatus({ url: authUrl, userCode, polling: true });

    const pollRes = await fetch(`${CLOUD_API_URL}/auth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (!pollRes.ok) continue;

    const pollData = (await pollRes.json()) as { status: string; access_token?: string };
    if (pollData.status === "approved" && pollData.access_token) {
      const creds: CloudCredentials = {
        accessToken: pollData.access_token,
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      };
      await saveCloudCredentials(creds);
      return creds;
    }
  }

  throw new Error("Authentication timed out. Please try again.");
}
