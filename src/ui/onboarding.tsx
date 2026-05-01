import React, { useState } from "react";
import { Box, Text } from "ink";
import { CustomTextInput } from "./text-input.js";
import { saveConfig, DEFAULT_MODEL } from "../config.js";
import type { Theme } from "./theme.js";

interface Props {
  onDone: (cfg: { accountId: string; apiToken: string; model: string }) => void;
  theme?: Theme;
}

const DEFAULT_ONBOARDING_THEME: Pick<
  Theme,
  "user" | "accent" | "muted" | "success" | "border"
> = {
  user: "cyan",
  accent: "cyan",
  muted: { color: "gray", dim: true },
  success: "green",
  border: "gray",
};

type Step = "accountId" | "apiToken" | "model" | "confirm";

const STEPS: Step[] = ["accountId", "apiToken", "model", "confirm"];

export function Onboarding({ onDone, theme }: Props) {
  const t = {
    user: theme?.user ?? DEFAULT_ONBOARDING_THEME.user,
    accent: theme?.accent ?? DEFAULT_ONBOARDING_THEME.accent,
    muted: theme?.muted ?? DEFAULT_ONBOARDING_THEME.muted,
    success: theme?.success ?? DEFAULT_ONBOARDING_THEME.success,
    border: theme?.border ?? DEFAULT_ONBOARDING_THEME.border,
  };

  const [step, setStep] = useState<Step>("accountId");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step) + 1;

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

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={t.accent}>
          kimiflare
        </Text>
        <Text color={t.muted.color} dimColor={t.muted.dim}>
          {"  "}Terminal coding agent
        </Text>
      </Box>

      <Text color={t.muted.color} dimColor={t.muted.dim}>
        Step {stepIndex} of {STEPS.length}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {step === "accountId" && (
          <>
            <Text>Enter your Cloudflare Account ID</Text>
            <Box marginTop={1}>
              <Text color={t.user}>› </Text>
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
            <Text color={t.muted.color} dimColor={t.muted.dim}>
              Create one at https://dash.cloudflare.com/profile/api-tokens
            </Text>
            <Box marginTop={1}>
              <Text color={t.user}>› </Text>
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
            <Text color={t.muted.color} dimColor={t.muted.dim}>
              default: {DEFAULT_MODEL}
            </Text>
            <Box marginTop={1}>
              <Text color={t.user}>› </Text>
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
              borderColor={t.border}
              paddingX={1}
            >
              <Text color={t.muted.color} dimColor={t.muted.dim}>
                Account ID: {accountId}
              </Text>
              <Text color={t.muted.color} dimColor={t.muted.dim}>
                API Token: {"•".repeat(apiToken.length)}
              </Text>
              <Text color={t.muted.color} dimColor={t.muted.dim}>
                Model: {model}
              </Text>
            </Box>
            <Text>Press Enter to confirm, or Ctrl+C to cancel</Text>
            <Box marginTop={1}>
              <Text color={t.user}>› </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={handleConfirm}
              />
            </Box>
          </>
        )}

        {savedPath && (
          <Text color={t.success}>Config saved to {savedPath}</Text>
        )}
      </Box>
    </Box>
  );
}
