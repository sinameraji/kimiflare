import React, { useState } from "react";
import { Box, Text } from "ink";
import { CustomTextInput } from "./text-input.js";
import { saveConfig, DEFAULT_MODEL } from "../config.js";
import { DEFAULT_THEME as theme } from "./theme.js";

interface Props {
  onDone: (cfg: { accountId: string; apiToken: string; model: string }) => void;
}

type Step = "accountId" | "apiToken" | "model" | "confirm";

const STEPS: Step[] = ["accountId", "apiToken", "model", "confirm"];

export function Onboarding({ onDone }: Props) {
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
        <Text bold color={theme.palette.primary}>
          kimiflare
        </Text>
        <Text color={theme.palette.muted} dimColor>
          {"  "}Terminal coding agent
        </Text>
      </Box>

      <Text color={theme.palette.muted} dimColor>
        Step {stepIndex} of {STEPS.length}
      </Text>

      <Box marginTop={1} flexDirection="column">
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
            <Text color={theme.palette.muted} dimColor>
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
            <Text color={theme.palette.muted} dimColor>
              default: {DEFAULT_MODEL}
            </Text>
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
              borderColor={theme.palette.muted}
              paddingX={1}
            >
              <Text color={theme.palette.muted}>Account ID: {accountId}</Text>
              <Text color={theme.palette.muted}>API Token: {"•".repeat(apiToken.length)}</Text>
              <Text color={theme.palette.muted}>Model: {model}</Text>
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
