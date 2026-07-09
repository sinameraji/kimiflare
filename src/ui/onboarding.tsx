import { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { ModelPicker } from "./model-picker.js";
import { BillingChooser, type BillingChoice } from "./billing-chooser.js";
import { UnifiedBillingStatus } from "./unified-billing-status.js";
import { KeyEntryModal, type KeyResult } from "./key-entry-modal.js";
import { isUnifiedEligible, type ModelEntry } from "../models/registry.js";
import { saveConfig, DEFAULT_MODEL, type KimiConfig } from "../config.js";
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
  | "mode"
  | "accountId"
  | "apiToken"
  | "routingMode"
  | "gatewayLoading"
  | "gatewayPick"
  | "gatewayCreate"
  | "gatewayScopeError"
  | "gatewayManual"
  | "gatewayProbing"
  | "model"
  | "billingChoice"
  | "cloudAuth"
  | "unifiedProbe"
  | "keyEntry"
  | "confirm";

export function Onboarding({ onDone, onCancel }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("mode");
  const [modePickIdx, setModePickIdx] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const [useGateway, setUseGateway] = useState<boolean | null>(null);
  const [routingPickIdx, setRoutingPickIdx] = useState(0);

  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [gatewayPickIdx, setGatewayPickIdx] = useState(0);
  const [aiGatewayId, setAiGatewayId] = useState<string>("");
  const [gatewayNewName, setGatewayNewName] = useState("kimiflare");
  const [gatewayManualId, setGatewayManualId] = useState("");
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayProbeMsg, setGatewayProbeMsg] = useState<string | null>(null);

  // The picked model entry (kept around so the BillingChooser / KeyEntryModal
  // sub-steps know which provider to set up). Null until step "model" completes.
  const [pickedEntry, setPickedEntry] = useState<ModelEntry | null>(null);
  // Setup outcome for the picked provider, persisted into cfg at handleConfirm.
  const [unifiedBilling, setUnifiedBilling] = useState(false);
  const [providerKeyAliases, setProviderKeyAliases] = useState<
    NonNullable<KimiConfig["providerKeyAliases"]>
  >({});
  const [providerKeys, setProviderKeys] = useState<
    NonNullable<KimiConfig["providerKeys"]>
  >({});
  const [secretsStoreId, setSecretsStoreId] = useState<string | undefined>(undefined);
  const [cloudMode, setCloudMode] = useState(false);
  const [cloudAuthStatus, setCloudAuthStatus] = useState<{ url: string; userCode: string; polling: boolean } | null>(null);
  const [cloudAuthError, setCloudAuthError] = useState<string | null>(null);

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

  // Arrow-key navigation on the top-level mode picker (Cloud vs Self-hosted).
  useInput(
    (_input, key) => {
      if (step !== "mode") return;
      const total = 2;
      if (key.upArrow) {
        setModePickIdx((i) => (i - 1 + total) % total);
      } else if (key.downArrow) {
        setModePickIdx((i) => (i + 1) % total);
      } else if (key.return) {
        if (modePickIdx === 0) {
          startCloudAuth();
        } else {
          setStep("accountId");
        }
      }
    },
  );

  // Arrow-key navigation on the routing-mode picker.
  useInput(
    (_input, key) => {
      if (step !== "routingMode") return;
      const total = 2;
      if (key.upArrow) {
        setRoutingPickIdx((i) => (i - 1 + total) % total);
      } else if (key.downArrow) {
        setRoutingPickIdx((i) => (i + 1) % total);
      } else if (key.return) {
        if (routingPickIdx === 0) {
          setUseGateway(false);
          setStep("model");
        } else {
          setUseGateway(true);
          setStep("gatewayLoading");
        }
      }
    },
  );

  // Arrow-key navigation on the gateway picker.
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
    setStep("routingMode");
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

  // KimiFlare Cloud device-auth flow (picked at the top-level mode step).
  // On success we clear any locally-entered Cloudflare creds and mark cloudMode.
  const startCloudAuth = () => {
    setStep("cloudAuth");
    setCloudAuthError(null);
    void import("../cloud/auth.js").then(({ authenticateDevice }) => {
      authenticateDevice((status) => {
        setCloudAuthStatus(status);
      })
        .then(() => {
          setCloudMode(true);
          setAccountId("");
          setApiToken("");
          setStep("confirm");
        })
        .catch((err) => {
          setCloudAuthError(err instanceof Error ? err.message : String(err));
        });
    });
  };

  const handleModelPick = (picked: ModelEntry | null) => {
    // Esc / cancel in the picker → keep the current default (a Workers AI
    // model that needs no setup) and skip straight to confirm.
    if (!picked) {
      setStep("confirm");
      return;
    }
    setModel(picked.id);
    setPickedEntry(picked);
    // Self-hosted routing (Cloud is chosen up front at the mode step):
    //   workers-ai       → nothing more to set up → confirm
    //   unified-eligible → ask billing mode (Cloudflare credits / BYOK)
    //   BYOK-only        → straight to key entry
    if (picked.provider === "workers-ai") {
      setStep("confirm");
    } else if (isUnifiedEligible(picked)) {
      setStep("billingChoice");
    } else {
      setStep("keyEntry");
    }
  };

  const handleBillingChoice = (choice: BillingChoice | null) => {
    // Esc / cancel from the chooser → back to the model picker.
    if (!choice) {
      setStep("model");
      return;
    }
    // Cloud is chosen up front now; the chooser only offers Cloudflare credits
    // (unified) or BYOK for non-Workers-AI models on the AI Gateway path.
    setStep(choice === "unified" ? "unifiedProbe" : "keyEntry");
  };

  const handleProbeResolve = (r: "enabled" | "fallback-byok" | "cancelled") => {
    if (r === "enabled") {
      setUnifiedBilling(true);
      setStep("confirm");
    } else if (r === "fallback-byok") {
      setStep("keyEntry");
    } else {
      // Cancelled — back to billing choice so they can retry or pick BYOK.
      setStep("billingChoice");
    }
  };

  const handleSaveProviderKey = (result: KeyResult) => {
    if (!pickedEntry) return;
    const provider = pickedEntry.provider as "anthropic" | "openai" | "google" | "openai-compatible";
    if (result.kind === "alias") {
      setProviderKeyAliases((prev) => ({ ...prev, [provider]: result.alias }));
      setSecretsStoreId(result.secretsStoreId);
    } else {
      setProviderKeys((prev) => ({ ...prev, [provider]: result.key }));
    }
    setStep("confirm");
  };

  const handleCancelKeyEntry = () => {
    // If they bail out of key entry, route back to the chooser so they can
    // try Unified Billing instead (only meaningful for UB-eligible providers,
    // but harmless either way — the chooser will skip itself if not eligible).
    if (pickedEntry && isUnifiedEligible(pickedEntry)) {
      setStep("billingChoice");
    } else {
      // BYOK-only provider with no key → drop them back at the picker.
      setStep("model");
    }
  };

  const handleConfirm = async () => {
    const cfg: KimiConfig = {
      accountId,
      apiToken,
      model,
      aiGatewayId: aiGatewayId || undefined,
      ...(cloudMode ? { cloudMode: true } : {}),
      ...(unifiedBilling ? { unifiedBilling: true } : {}),
      ...(Object.keys(providerKeyAliases).length > 0 ? { providerKeyAliases } : {}),
      ...(Object.keys(providerKeys).length > 0 ? { providerKeys } : {}),
      ...(secretsStoreId ? { secretsStoreId } : {}),
    };
    try {
      const path = await saveConfig(cfg);
      setSavedPath(path);
      onDone(cfg);
    } catch (e) {
      setSavedPath(`error: ${(e as Error).message}`);
    }
  };

  // Step numbering: keep simple linear count for visible steps.
  const visibleSteps: Step[] = ["mode", "accountId", "apiToken", "routingMode", "model", "confirm"];
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
        {step === "mode" && (
          <>
            <Text>How do you want to run kimiflare?</Text>
            <Text color={theme.info.color}>
              Use ↑/↓ to navigate, Enter to select.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text color={modePickIdx === 0 ? theme.palette.primary : undefined}>
                {modePickIdx === 0 ? "› " : "  "}
                KimiFlare Cloud — 5,000,000 tokens free
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Sign in with GitHub or email. No Cloudflare account needed. Upgrade to Pro when you run out.
              </Text>
              <Text> </Text>
              <Text color={modePickIdx === 1 ? theme.palette.primary : undefined}>
                {modePickIdx === 1 ? "› " : "  "}
                Self-hosted — bring your own Cloudflare account
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Use your Cloudflare Account ID + API token, then pick Workers AI (direct) or AI Gateway.
              </Text>
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

        {step === "routingMode" && (
          <>
            <Text>Choose how to route AI requests</Text>
            <Text color={theme.info.color}>
              Use ↑/↓ to navigate, Enter to select.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text color={routingPickIdx === 0 ? theme.palette.primary : undefined}>
                {routingPickIdx === 0 ? "› " : "  "}
                Workers AI (direct) — fastest, no gateway overhead
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Recommended for the best terminal experience. Uses Cloudflare Workers AI directly.
              </Text>
              <Text> </Text>
              <Text color={routingPickIdx === 1 ? theme.palette.primary : undefined}>
                {routingPickIdx === 1 ? "› " : "  "}
                AI Gateway — logs, caching, multi-provider support
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Slightly higher latency, but gives you a dashboard, request logs, and the ability to use non-Workers-AI models later.
              </Text>
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
            {!aiGatewayId && useGateway === false && (
              <Text color={theme.palette.success}>
                Routing: Workers AI (direct) ✓
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

        {step === "billingChoice" && pickedEntry && (
          <Box marginTop={1}>
            <BillingChooser model={pickedEntry} onPick={handleBillingChoice} />
          </Box>
        )}

        {step === "cloudAuth" && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={theme.accent}>
              Kimiflare Cloud Authentication
            </Text>
            {cloudAuthStatus ? (
              <>
                <Text color={theme.info.color}>
                  1. Open this URL in your browser:
                </Text>
                <Text color={theme.info.color}>{cloudAuthStatus.url}</Text>
                <Box marginTop={1}>
                  <Text color={theme.info.color}>
                    2. Sign in with GitHub or Email
                  </Text>
                </Box>
                <Box marginTop={1}>
                  <Text color={theme.info.color}>
                    User code: <Text bold>{cloudAuthStatus.userCode}</Text>
                  </Text>
                </Box>
                {cloudAuthStatus.polling && (
                  <Text color={theme.muted?.color ?? theme.info.color} dimColor>
                    Waiting for approval…
                  </Text>
                )}
              </>
            ) : (
              <Text color={theme.info.color}>Starting device authentication…</Text>
            )}
            {cloudAuthError && (
              <Box marginTop={1}>
                <Text color={theme.error}>
                  {cloudAuthError}
                </Text>
              </Box>
            )}
          </Box>
        )}

        {step === "unifiedProbe" && pickedEntry && (
          <Box marginTop={1}>
            <UnifiedBillingStatus
              model={pickedEntry}
              accountId={accountId}
              apiToken={apiToken}
              gatewayId={aiGatewayId}
              onResolve={handleProbeResolve}
            />
          </Box>
        )}

        {step === "keyEntry" && pickedEntry && (
          <Box marginTop={1}>
            <KeyEntryModal
              model={pickedEntry}
              accountId={accountId}
              apiToken={apiToken}
              secretsStoreId={secretsStoreId}
              onSave={handleSaveProviderKey}
              onCancel={handleCancelKeyEntry}
            />
          </Box>
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
              {!cloudMode && (
                <>
                  <Text color={theme.info.color}>Account ID: {accountId}</Text>
                  <Text color={theme.info.color}>API Token: {"•".repeat(apiToken.length)}</Text>
                </>
              )}
              <Text color={theme.info.color}>Model: {model}</Text>
              {!cloudMode &&
                (aiGatewayId ? (
                  <Text color={theme.info.color}>AI Gateway: {aiGatewayId}</Text>
                ) : (
                  <Text color={theme.info.color}>Routing: Workers AI (direct)</Text>
                ))}
              {cloudMode && (
                <Text color={theme.info.color}>
                  Billing: KimiFlare Cloud (free 5M tokens, then $10/mo Pro)
                </Text>
              )}
              {unifiedBilling && (
                <Text color={theme.info.color}>
                  Billing: Cloudflare credits (Unified Billing)
                </Text>
              )}
              {Object.keys(providerKeyAliases).length > 0 && (
                <Text color={theme.info.color}>
                  Provider keys: {Object.keys(providerKeyAliases).join(", ")} (in Cloudflare Secrets Store)
                </Text>
              )}
              {Object.keys(providerKeys).length > 0 && (
                <Text color={theme.info.color}>
                  Provider keys: {Object.keys(providerKeys).join(", ")} (local — do not commit ~/.config/kimiflare/config.json)
                </Text>
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
