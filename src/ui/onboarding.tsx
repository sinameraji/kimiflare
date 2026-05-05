import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CustomTextInput } from "./text-input.js";
import { saveConfig, DEFAULT_MODEL } from "../config.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import {
  generateDeviceCodes,
  registerDevice,
  pollForToken,
  fetchCloudUsage,
  saveCloudCredentials,
  type CloudCredentials,
  type DeviceCodes,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from "../cloud/auth.js";

const execAsync = promisify(exec);

interface Props {
  onDone: (cfg: { accountId: string; apiToken: string; model: string; cloudMode?: boolean }) => void;
  onCancel?: () => void;
}

type Step = "mode" | "accountId" | "apiToken" | "model" | "confirm" | "cloudAuth";

type CloudAuthState =
  | { phase: "ready"; codes: DeviceCodes }
  | { phase: "polling"; codes: DeviceCodes; startTime: number }
  | { phase: "success"; creds: CloudCredentials; usage: { remaining: number; input_token_limit: number; expires_at: string } }
  | { phase: "error"; message: string };

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? `open "${url}"` : platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      // Silently fail — user can copy-paste the URL
    }
  });
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function Onboarding({ onDone, onCancel }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<"cloud" | "byok">("byok");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [cloudAuth, setCloudAuth] = useState<CloudAuthState | null>(null);
  const [pollTick, setPollTick] = useState(0);

  // ─── Cloud Auth Effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== "cloudAuth" || !cloudAuth) return;
    if (cloudAuth.phase !== "polling") return;

    let cancelled = false;

    const tick = setInterval(() => {
      setPollTick((t) => t + 1);
    }, 1000);

    const poll = async () => {
      while (!cancelled) {
        const elapsed = Date.now() - cloudAuth.startTime;
        if (elapsed >= POLL_TIMEOUT_MS) {
          if (!cancelled) {
            setCloudAuth({ phase: "error", message: "Authentication timed out. Please try again." });
          }
          return;
        }

        try {
          const creds = await pollForToken(cloudAuth.codes.deviceCode);
          if (creds && !cancelled) {
            const usage = await fetchCloudUsage(creds.accessToken);
            if (usage && !cancelled) {
              setCloudAuth({
                phase: "success",
                creds,
                usage,
              });
            } else if (!cancelled) {
              setCloudAuth({ phase: "error", message: "Authenticated but failed to fetch usage." });
            }
            return;
          }
        } catch {
          // Continue polling
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };

    poll();

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [step, cloudAuth]);

  // ─── Keyboard Handling ─────────────────────────────────────────────────────
  useInput(
    useCallback(
      (_input, key) => {
        if (key.escape && onCancel) {
          onCancel();
        }
      },
      [onCancel],
    ),
  );

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const startCloudAuth = useCallback(async () => {
    try {
      const codes = generateDeviceCodes();
      await registerDevice(codes);
      setCloudAuth({ phase: "ready", codes });
      setStep("cloudAuth");
    } catch (err) {
      setCloudAuth({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to start authentication",
      });
      setStep("cloudAuth");
    }
  }, []);

  const handleModeSelect = (item: { value: string }) => {
    if (item.value === "cloud") {
      setMode("cloud");
      void startCloudAuth();
    } else {
      setMode("byok");
      setStep("accountId");
    }
  };

  const handleOpenBrowser = () => {
    if (cloudAuth?.phase === "ready") {
      openBrowser(cloudAuth.codes.authUrl);
      setCloudAuth({ phase: "polling", codes: cloudAuth.codes, startTime: Date.now() });
    }
  };

  const handleCloudSuccess = async () => {
    if (cloudAuth?.phase !== "success") return;
    const cfg = { accountId: "", apiToken: "", model: DEFAULT_MODEL, cloudMode: true as const };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  const handleCloudRetry = () => {
    setCloudAuth(null);
    void startCloudAuth();
  };

  const handleCloudSwitchToByok = () => {
    setCloudAuth(null);
    setMode("byok");
    setStep("accountId");
  };

  const handleAccountIdSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setAccountId(trimmed);
    setStep("apiToken");
  };

  const handleApiTokenSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setApiToken(trimmed);
    setStep("model");
  };

  const handleModelSubmit = (value: string) => {
    const trimmed = value.trim() || DEFAULT_MODEL;
    setModel(trimmed);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    const cfg = { accountId, apiToken, model };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  // ─── Step Count ────────────────────────────────────────────────────────────
  const byokSteps = ["accountId", "apiToken", "model", "confirm"] as const;
  const stepIndex =
    step === "mode"
      ? 1
      : step === "cloudAuth"
        ? 2
        : byokSteps.indexOf(step as (typeof byokSteps)[number]) + 2;
  const totalSteps = mode === "cloud" ? 2 : byokSteps.length + 1;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.palette.primary}>
          kimiflare
        </Text>
        <Text color={theme.info.color}>{"  "}Terminal coding agent</Text>
      </Box>

      <Text color={theme.info.color}>
        Step {stepIndex} of {totalSteps}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {step === "mode" && (
          <>
            <Text>How do you want to connect?</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: "Cloud (managed) — no API key needed", value: "cloud" },
                  { label: "BYOK — bring your own Cloudflare key", value: "byok" },
                ]}
                onSelect={handleModeSelect}
              />
            </Box>
          </>
        )}

        {step === "cloudAuth" && cloudAuth?.phase === "ready" && (
          <>
            <Text>Authenticating with Kimiflare Cloud...</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>1. Open this URL in your browser:</Text>
              <Text color={theme.palette.primary}>{cloudAuth.codes.authUrl}</Text>
            </Box>
            <Box marginTop={1}>
              <Text>2. </Text>
              <Text bold>[Press Enter to open browser]</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={handleOpenBrowser}
              />
            </Box>
          </>
        )}

        {step === "cloudAuth" && cloudAuth?.phase === "polling" && (
          <>
            <Text>
              <Text color={theme.spinner}>
                <Spinner type="dots" />
              </Text>{" "}
              Waiting for authentication...
            </Text>
            <Text color={theme.info.color}>
              Expires in {formatRemaining(POLL_TIMEOUT_MS - (Date.now() - cloudAuth.startTime))}
            </Text>
            <Text color={theme.info.color}>
              URL: {cloudAuth.codes.authUrl}
            </Text>
          </>
        )}

        {step === "cloudAuth" && cloudAuth?.phase === "success" && (
          <>
            <Text color={theme.palette.success}>Authenticated!</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>
                Token budget:{" "}
                <Text bold>
                  {cloudAuth.usage.remaining.toLocaleString()} /{" "}
                  {cloudAuth.usage.input_token_limit.toLocaleString()}
                </Text>{" "}
                remaining
              </Text>
              <Text color={theme.info.color}>
                Grant expires: {cloudAuth.usage.expires_at}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text>[Press Enter to continue]</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={handleCloudSuccess}
              />
            </Box>
          </>
        )}

        {step === "cloudAuth" && cloudAuth?.phase === "error" && (
          <>
            <Text color={theme.palette.error}>Authentication failed</Text>
            <Text color={theme.info.color}>{cloudAuth.message}</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: "Retry", value: "retry" },
                  { label: "Switch to BYOK", value: "byok" },
                  { label: "Cancel", value: "cancel" },
                ]}
                onSelect={(item) => {
                  if (item.value === "retry") handleCloudRetry();
                  else if (item.value === "byok") handleCloudSwitchToByok();
                  else if (onCancel) onCancel();
                }}
              />
            </Box>
          </>
        )}

        {step === "accountId" && (
          <>
            <Text>Enter your Cloudflare Account ID</Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value={accountId}
                onChange={setAccountId}
                onSubmit={handleAccountIdSubmit}
              />
            </Box>
          </>
        )}

        {step === "apiToken" && (
          <>
            <Text>Enter your Cloudflare API Token</Text>
            <Text color={theme.info.color}>
              Create one at https://dash.cloudflare.com/profile/api-tokens
            </Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value={apiToken}
                onChange={setApiToken}
                onSubmit={handleApiTokenSubmit}
                mask="•"
              />
            </Box>
          </>
        )}

        {step === "model" && (
          <>
            <Text>Model ID (press Enter for default)</Text>
            <Text color={theme.info.color}>default: {DEFAULT_MODEL}</Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value={model}
                onChange={setModel}
                onSubmit={handleModelSubmit}
              />
            </Box>
          </>
        )}

        {step === "confirm" && (
          <>
            <Text>Ready to save configuration</Text>
            <Box
              flexDirection="column"
              marginTop={1}
              marginBottom={1}
              borderStyle="single"
              borderColor={theme.info.color}
              paddingX={1}
            >
              <Text color={theme.info.color}>Account ID: {accountId}</Text>
              <Text color={theme.info.color}>API Token: {"•".repeat(apiToken.length)}</Text>
              <Text color={theme.info.color}>Model: {model}</Text>
            </Box>
            <Text>Press Enter to confirm, or Ctrl+C to cancel</Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={handleConfirm}
              />
            </Box>
          </>
        )}

        {savedPath && (
          <Text color={theme.palette.success}>Config saved to {savedPath}</Text>
        )}
      </Box>
    </Box>
  );
}
