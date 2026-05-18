import { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { ModelPicker } from "./model-picker.js";
import type { ModelEntry } from "../models/registry.js";
import { saveConfig, DEFAULT_MODEL } from "../config.js";
import { useTheme } from "./theme-context.js";
import {
  listGateways,
  createGateway,
  probeGateway,
  AiGatewayError,
  type Gateway,
} from "../cloud/ai-gateway-api.js";

interface Props {
  onDone: (cfg: { accountId: string; apiToken: string; model: string; aiGatewayId?: string }) => void;
  onCancel?: () => void;
}

type Step =
  | "accountId"
  | "apiToken"
  | "gatewayLoading"
  | "gatewayPick"
  | "gatewayCreate"
  | "gatewayScopeError"
  | "gatewayManual"
  | "gatewayProbing"
  | "model"
  | "confirm";

export function Onboarding({ onDone, onCancel }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("accountId");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [gatewayPickIdx, setGatewayPickIdx] = useState(0);
  const [aiGatewayId, setAiGatewayId] = useState<string>("");
  const [gatewayNewName, setGatewayNewName] = useState("kimiflare");
  const [gatewayManualId, setGatewayManualId] = useState("");
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayProbeMsg, setGatewayProbeMsg] = useState<string | null>(null);

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

  // Arrow-key navigation on the picker.
  useInput(
    (_input, key) => {
      if (step !== "gatewayPick") return;
      const total = gateways.length + 1; // +1 for create
      if (key.upArrow) {
        setGatewayPickIdx((i) => (i - 1 + total) % total);
      } else if (key.downArrow) {
        setGatewayPickIdx((i) => (i + 1) % total);
      } else if (key.return) {
        if (gatewayPickIdx === gateways.length) {
          setStep("gatewayCreate");
        } else {
          const picked = gateways[gatewayPickIdx];
          if (picked) {
            setAiGatewayId(picked.id);
            void runProbe(picked.id);
          }
        }
      }
    },
  );

  // Kick off gateway listing when entering the loading step.
  useEffect(() => {
    if (step !== "gatewayLoading") return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listGateways(accountId, apiToken);
        if (cancelled) return;
        if (list.length === 0) {
          setStep("gatewayCreate");
        } else {
          setGateways(list);
          setGatewayPickIdx(0);
          setStep("gatewayPick");
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof AiGatewayError && e.detail.kind === "forbidden") {
          setGatewayError(e.detail.message);
          setStep("gatewayScopeError");
        } else {
          setGatewayError(e instanceof Error ? e.message : String(e));
          setStep("gatewayScopeError");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, accountId, apiToken]);

  const runProbe = async (gid: string) => {
    setGatewayProbeMsg(null);
    setStep("gatewayProbing");
    const result = await probeGateway(accountId, apiToken, gid);
    if (result.ok) {
      setAiGatewayId(gid);
      setStep("model");
    } else {
      setGatewayProbeMsg(result.message);
      setGatewayError(result.message);
      setStep("gatewayScopeError");
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
    setStep("gatewayLoading");
  };

  const handleGatewayCreateSubmit = async (value: string) => {
    const name = (value.trim() || "kimiflare").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    setGatewayError(null);
    try {
      const gw = await createGateway(accountId, apiToken, name);
      await runProbe(gw.id);
    } catch (e) {
      if (e instanceof AiGatewayError && e.detail.kind === "forbidden") {
        setGatewayError(e.detail.message);
        setStep("gatewayScopeError");
      } else {
        setGatewayError(e instanceof Error ? e.message : String(e));
        setStep("gatewayScopeError");
      }
    }
  };

  const handleManualGatewaySubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void runProbe(trimmed);
  };

  const handleModelPick = (picked: ModelEntry | null) => {
    // Esc / cancel in the picker → keep the current default and move on.
    if (picked) setModel(picked.id);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    const cfg = { accountId, apiToken, model, aiGatewayId: aiGatewayId || undefined };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  // Step numbering: keep simple linear count for visible steps.
  const visibleSteps: Step[] = ["accountId", "apiToken", "gatewayLoading", "model", "confirm"];
  const stepIndex = Math.max(1, visibleSteps.indexOf(step) === -1 ? 3 : visibleSteps.indexOf(step) + 1);
  const totalSteps = visibleSteps.length;

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
            <Text color={theme.info.color}>
              Required permissions: Workers AI:Read, AI Gateway:Read, AI Gateway:Edit
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

        {step === "gatewayLoading" && (
          <Text color={theme.info.color}>Looking up your AI Gateways…</Text>
        )}

        {step === "gatewayPick" && (
          <>
            <Text>Pick an AI Gateway to route requests through</Text>
            <Text color={theme.info.color}>
              Use ↑/↓ to navigate, Enter to select.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {gateways.map((gw, i) => (
                <Text key={gw.id} color={i === gatewayPickIdx ? theme.palette.primary : undefined}>
                  {i === gatewayPickIdx ? "› " : "  "}
                  {gw.id}
                </Text>
              ))}
              <Text color={gatewayPickIdx === gateways.length ? theme.palette.primary : undefined}>
                {gatewayPickIdx === gateways.length ? "› " : "  "}
                + Create new…
              </Text>
            </Box>
          </>
        )}

        {step === "gatewayCreate" && (
          <>
            <Text>Name for your new AI Gateway</Text>
            <Text color={theme.info.color}>
              Lowercase letters, numbers, _ and - only. Default: kimiflare
            </Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>› </Text>
              <CustomTextInput
                value={gatewayNewName}
                onChange={setGatewayNewName}
                onSubmit={handleGatewayCreateSubmit}
              />
            </Box>
          </>
        )}

        {step === "gatewayProbing" && (
          <Text color={theme.info.color}>Verifying gateway routing…</Text>
        )}

        {step === "gatewayScopeError" && (
          <>
            <Text color={theme.palette.error ?? "red"}>
              Couldn't reach AI Gateway: {gatewayError ?? "permission denied"}
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text>Your API token likely lacks the required scopes.</Text>
              <Text color={theme.info.color}>Required permissions:</Text>
              <Text color={theme.info.color}>  • AI Gateway:Read  (to list gateways)</Text>
              <Text color={theme.info.color}>  • AI Gateway:Edit  (to create one)</Text>
              <Text color={theme.info.color}>  • Workers AI:Read  (to run models)</Text>
              <Text>
                Edit your token at: https://dash.cloudflare.com/profile/api-tokens
              </Text>
            </Box>
            <Text>{" "}</Text>
            <Text>Press Enter to retry, or type a Gateway ID manually below.</Text>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>retry › </Text>
              <CustomTextInput
                value=""
                onChange={() => {}}
                onSubmit={() => setStep("gatewayLoading")}
              />
            </Box>
            <Box marginTop={1}>
              <Text color={theme.palette.primary}>manual › </Text>
              <CustomTextInput
                value={gatewayManualId}
                onChange={setGatewayManualId}
                onSubmit={handleManualGatewaySubmit}
              />
            </Box>
          </>
        )}

        {step === "model" && (
          <>
            <Text>Pick a model to start with (you can change it anytime with /model)</Text>
            {aiGatewayId && (
              <Text color={theme.palette.success}>
                Gateway: {aiGatewayId} ✓
              </Text>
            )}
            <Box marginTop={1}>
              <ModelPicker current={model} onPick={handleModelPick} />
            </Box>
            <Box marginTop={1}>
              <Text color={theme.info.color} dimColor>
                Tip: Esc keeps the default ({DEFAULT_MODEL}) and continues.
              </Text>
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
              {aiGatewayId && (
                <Text color={theme.info.color}>AI Gateway: {aiGatewayId}</Text>
              )}
            </Box>
            <Text>Press Enter to confirm, or Ctrl+C to cancel</Text>
            {aiGatewayId && (
              <Text color={theme.info.color}>
                Tip: enable response caching with `/gateway cache-ttl 60` to cut costs on repeated prompts.
              </Text>
            )}
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

        {gatewayProbeMsg && step !== "gatewayProbing" && step !== "gatewayScopeError" && (
          <Text color={theme.palette.error ?? "red"}>Probe failed: {gatewayProbeMsg}</Text>
        )}

        {savedPath && (
          <Text color={theme.palette.success}>Config saved to {savedPath}</Text>
        )}
      </Box>
    </Box>
  );
}
