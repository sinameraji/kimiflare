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

export const CLOUD_API_URL = "https://api.kimiflare.com";
export const POLL_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (RFC 8628 standard)

export interface CloudCredentials {
  accessToken: string;
  expiresAt: number;
  deviceId: string;
}

export interface DeviceCodes {
  deviceCode: string;
  userCode: string;
  authUrl: string;
  deviceId: string;
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

function generateDeviceId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateDeviceCodes(): DeviceCodes {
  const deviceCode = `device-${generateCode()}-${Date.now()}`;
  const userCode = `${generateCode()}-${generateCode()}`;
  const authUrl = `${CLOUD_API_URL}/auth/github?code=${encodeURIComponent(userCode)}`;
  const deviceId = generateDeviceId();
  return { deviceCode, userCode, authUrl, deviceId };
}

export async function registerDevice(codes: DeviceCodes): Promise<void> {
  const registerRes = await fetch(`${CLOUD_API_URL}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: codes.deviceCode, user_code: codes.userCode, device_id: codes.deviceId }),
  });

  if (!registerRes.ok) {
    const err = (await registerRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Failed to register device: ${err.error || registerRes.statusText}`);
  }
}

export async function pollForToken(deviceCode: string, deviceId: string): Promise<CloudCredentials | null> {
  const pollRes = await fetch(`${CLOUD_API_URL}/auth/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  if (!pollRes.ok) return null;

  const pollData = (await pollRes.json()) as { status: string; access_token?: string };
  if (pollData.status === "approved" && pollData.access_token) {
    const creds: CloudCredentials = {
      accessToken: pollData.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      deviceId,
    };
    await saveCloudCredentials(creds);
    return creds;
  }
  return null;
}

export async function fetchCloudUsage(token: string, deviceId?: string): Promise<{
  input_token_limit: number;
  input_tokens_used: number;
  remaining: number;
  expires_at: string;
} | null> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (deviceId) headers["X-Device-ID"] = deviceId;
  const res = await fetch(`${CLOUD_API_URL}/v1/usage`, { headers });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  if (
    typeof data.remaining !== "number" ||
    typeof data.input_token_limit !== "number" ||
    typeof data.input_tokens_used !== "number" ||
    typeof data.expires_at !== "string"
  ) {
    return null;
  }
  return {
    input_token_limit: data.input_token_limit,
    input_tokens_used: data.input_tokens_used,
    remaining: data.remaining,
    expires_at: data.expires_at,
  };
}

export async function loadCloudCredentials(): Promise<CloudCredentials | null> {
  try {
    const raw = await readFile(cloudCredPath(), "utf8");
    const parsed = JSON.parse(raw) as CloudCredentials;
    if (parsed.expiresAt && parsed.expiresAt > Date.now() / 1000 && parsed.accessToken) {
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

/** Legacy CLI-only flow (used by `kimiflare auth cloud`). */
export async function authenticateDevice(
  onStatus: (status: { url: string; userCode: string; polling: boolean }) => void,
): Promise<CloudCredentials> {
  const codes = generateDeviceCodes();
  await registerDevice(codes);
  onStatus({ url: codes.authUrl, userCode: codes.userCode, polling: false });

  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    onStatus({ url: codes.authUrl, userCode: codes.userCode, polling: true });

    const creds = await pollForToken(codes.deviceCode, codes.deviceId);
    if (creds) return creds;
  }

  throw new Error("Authentication timed out. Please try again.");
}
