import { writeFile } from "node:fs/promises";
import { loadConfig, saveConfig, configPath } from "../config.js";

const GITHUB_CLIENT_ID = "Ov23liM7lJX1xE2V1sVK"; // GitHub OAuth App client ID
const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function githubDeviceFlow(): Promise<void> {
  console.log("Initiating GitHub device flow...\n");

  // Step 1: Request device code
  const deviceRes = await fetch(GITHUB_DEVICE_AUTH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: "repo",
    }),
  });

  if (!deviceRes.ok) {
    throw new Error(`Failed to request device code: ${deviceRes.status}`);
  }

  const deviceData = await deviceRes.json() as DeviceCodeResponse;
  console.log(`Please visit: ${deviceData.verification_uri}`);
  console.log(`Enter code: ${deviceData.user_code}\n`);

  // Step 2: Poll for access token
  const startTime = Date.now();
  const expiresIn = deviceData.expires_in * 1000;
  const interval = deviceData.interval * 1000;

  while (Date.now() - startTime < expiresIn) {
    await sleep(interval);

    const tokenRes = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!tokenRes.ok) continue;

    const tokenData = await tokenRes.json() as AccessTokenResponse & { error?: string };

    if (tokenData.error === "authorization_pending") {
      continue;
    }
    if (tokenData.error === "slow_down") {
      await sleep(interval * 2);
      continue;
    }
    if (tokenData.error) {
      throw new Error(`OAuth error: ${tokenData.error}`);
    }

    if (tokenData.access_token) {
      // Save tokens
      const cfg = (await loadConfig()) ?? {
        accountId: "",
        apiToken: "",
        model: "@cf/moonshotai/kimi-k2.6",
      };

      const expiry = tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : undefined;

      const next = {
        ...cfg,
        githubOAuthToken: tokenData.access_token,
        githubRefreshToken: tokenData.refresh_token,
        githubTokenExpiry: expiry,
      };

      await saveConfig(next);
      console.log("✅ GitHub authentication successful!");
      console.log(`Token saved to ${configPath()}`);
      return;
    }
  }

  throw new Error("Device flow expired. Please try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
