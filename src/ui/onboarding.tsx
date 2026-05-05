import React, { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { CustomTextInput } from "./text-input.js";
import { saveConfig, DEFAULT_MODEL } from "../config.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

interface Props {
  onDone: (cfg: { accountId: string; apiToken: string; model: string; cloudMode?: boolean }) => void;
}

type Step = "mode" | "accountId" | "apiToken" | "model" | "confirm" | "cloudDone";

export function Onboarding({ onDone }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<"cloud" | "byok">("byok");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const handleModeSelect = (item: { value: string }) => {
    if (item.value === "cloud") {
      setMode("cloud");
      setStep("cloudDone");
    } else {
      setMode("byok");
      setStep("accountId");
    }
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
    const cfg = mode === "cloud"
      ? { accountId: "", apiToken: "", model, cloudMode: true as const }
      : { accountId, apiToken, model };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  const handleCloudSave = async () => {
    const cfg = { accountId: "", apiToken: "", model: DEFAULT_MODEL, cloudMode: true as const };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  const byokSteps = ["accountId", "apiToken", "model", "confirm"] as const;
  const stepIndex = step === "mode" ? 1 : step === "cloudDone" ? 2 : byokSteps.indexOf(step as typeof byokSteps[number]) + 2;
  const totalSteps = mode === "cloud" ? 2 : byokSteps.length + 1;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.palette.primary}>
          kimiflare
        </Text>
        <Text color={theme.info.color}>
          {"  "}Terminal coding agent
        </Text>
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
            <Text color={theme.info.color}>
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

        {step === "cloudDone" && (
          <>
            <Text>Cloud mode selected</Text>
            <Text color={theme.info.color}>
              No API key needed. Run `kimiflare auth cloud` to sign in.
            </Text>
            <Box marginTop={1}>
              <Text>Press Enter to save, or Ctrl+C to cancel</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={handleCloudSave}
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
