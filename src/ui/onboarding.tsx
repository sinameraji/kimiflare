import { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { ModelPicker } from "./model-picker.js";
import { BillingChooser, type BillingChoice } from "./billing-chooser.js";
import { UnifiedBillingStatus } from "./unified-billing-status.js";
import { KeyEntryModal, type KeyResult } from "./key-entry-modal.js";
import { isUnifiedEligible, getModel, routeFor, type ModelEntry } from "../models/registry.js";
import {
  saveConfig,
  DEFAULT_MODEL,
  DEFAULT_CLOUD_MODEL,
  type KimiConfig,
  type CloudflareOAuthConfig,
} from "../config.js";
import { openBrowser } from "./app-helpers.js";
import { useTheme } from "./theme-context.js";
import {
  listGateways,
  createGateway,
  probeGateway,
  AiGatewayError,
  type Gateway,
} from "../cloud/ai-gateway-api.js";
import { isCloudModeAvailable } from "../cloud/availability.js";
import {
  loginWithCloudflare,
  listCloudflareAccounts,
  whoAmI,
  isCloudflareLoginConfigured,
  CF_OAUTH_CLIENT_ID,
  type CloudflareAccount,
} from "../cloud/cloudflare-oauth.js";

interface Props {
  onDone: (cfg: KimiConfig) => void;
  onCancel?: () => void;
}

type Step =
  | "mode"
  | "auth"
  | "oauth"
  | "accountPick"
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
  | "cloudModel"
  | "billingChoice"
  | "cloudAuth"
  | "unifiedProbe"
  | "keyEntry"
  | "confirm";

export function Onboarding({ onDone, onCancel }: Props) {
  const theme = useTheme();
  // KimiFlare Cloud is temporarily hidden (src/cloud/availability.ts): while
  // hidden the wizard starts directly at the BYOK "connect your Cloudflare
  // account" step instead of the Cloud-vs-Self-hosted mode picker.
  const [step, setStep] = useState<Step>(isCloudModeAvailable() ? "mode" : "auth");
  const [modePickIdx, setModePickIdx] = useState(0);
  // Default to "Log in with Cloudflare" when this build carries an OAuth
  // client id; otherwise pre-select the manual token path so nobody lands on
  // a dead button.
  const oauthConfigured = isCloudflareLoginConfigured();
  const [authPickIdx, setAuthPickIdx] = useState(oauthConfigured ? 0 : 1);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  // "Log in with Cloudflare" (OAuth) state.
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthPhase, setOauthPhase] = useState<"idle" | "waiting" | "accounts">("idle");
  const [oauthState, setOauthState] = useState<CloudflareOAuthConfig | null>(null);
  const [oauthAbort, setOauthAbort] = useState<AbortController | null>(null);
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [accountPickIdx, setAccountPickIdx] = useState(0);
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
        if (!key.escape) return;
        // Esc while waiting on the browser: cancel the OAuth flow and drop
        // back to the auth-method picker instead of quitting the wizard.
        if (step === "oauth") {
          oauthAbort?.abort();
          setOauthAbort(null);
          setOauthPhase("idle");
          setStep("auth");
          return;
        }
        if (onCancel) onCancel();
      },
      [onCancel, step, oauthAbort],
    ),
  );

  // On the Cloud auth screen, Enter opens the sign-in URL in the browser.
  useInput(
    (_input, key) => {
      if (step !== "cloudAuth") return;
      if (key.return && cloudAuthStatus?.url) {
        openBrowser(cloudAuthStatus.url);
      }
    },
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
          setStep("auth");
        }
      }
    },
  );

  // Arrow-key navigation on the auth-method picker (Log in with Cloudflare vs API token).
  useInput(
    (input, key) => {
      if (step !== "auth") return;
      const total = 2;
      if (key.upArrow) {
        setAuthPickIdx((i) => (i - 1 + total) % total);
      } else if (key.downArrow) {
        setAuthPickIdx((i) => (i + 1) % total);
      } else if (key.return) {
        if (authPickIdx === 0) {
          startCloudflareLogin();
        } else {
          setStep("accountId");
        }
      } else if (input === "m" || input === "M") {
        setStep("accountId");
      }
    },
  );

  // On the OAuth waiting screen: Enter re-opens the browser, "m" falls back to manual token entry.
  useInput(
    (input, key) => {
      if (step !== "oauth") return;
      if (key.return) {
        if (oauthError) {
          startCloudflareLogin();
        } else if (oauthUrl) {
          openBrowser(oauthUrl);
        }
      } else if (input === "m" || input === "M") {
        oauthAbort?.abort();
        setOauthAbort(null);
        setOauthPhase("idle");
        setStep("accountId");
      }
    },
  );

  // Arrow-key navigation on the account picker (only shown for multi-account users).
  useInput(
    (_input, key) => {
      if (step !== "accountPick") return;
      const total = accounts.length;
      if (total === 0) return;
      if (key.upArrow) {
        setAccountPickIdx((i) => (i - 1 + total) % total);
      } else if (key.downArrow) {
        setAccountPickIdx((i) => (i + 1) % total);
      } else if (key.return) {
        const picked = accounts[accountPickIdx];
        if (picked) {
          setAccountId(picked.id);
          setOauthState((prev) => (prev ? { ...prev, accountName: picked.name } : prev));
          setStep("routingMode");
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
    // Manual path: forget any half-finished OAuth session.
    setOauthState(null);
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

  // "Log in with Cloudflare": OAuth + PKCE via the browser. On success we hold
  // the access token as apiToken (the rest of the app is none the wiser) and
  // keep the refresh token in cloudflareOAuth so it can rotate silently.
  const startCloudflareLogin = () => {
    oauthAbort?.abort();
    const ac = new AbortController();
    setOauthAbort(ac);
    setOauthError(null);
    setOauthUrl(null);
    setOauthPhase("waiting");
    setStep("oauth");
    void (async () => {
      try {
        const tokens = await loginWithCloudflare({
          signal: ac.signal,
          onAuthUrl: (url) => {
            setOauthUrl(url);
            openBrowser(url);
          },
        });
        if (ac.signal.aborted) return;
        setOauthPhase("accounts");
        setApiToken(tokens.accessToken);
        const [me, list] = await Promise.all([whoAmI(tokens.accessToken), listCloudflareAccounts(tokens.accessToken)]);
        if (ac.signal.aborted) return;
        const state: CloudflareOAuthConfig = {
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          clientId: CF_OAUTH_CLIENT_ID,
          email: me?.email,
        };
        if (list.length === 0) {
          setOauthError(
            "Signed in, but this Cloudflare user has no accounts kimiflare can use. Create one at dash.cloudflare.com and try again.",
          );
          setOauthPhase("idle");
          return;
        }
        setAccounts(list);
        if (list.length === 1) {
          const only = list[0]!;
          setAccountId(only.id);
          setOauthState({ ...state, accountName: only.name });
          setStep("routingMode");
        } else {
          setOauthState(state);
          setAccountPickIdx(0);
          setStep("accountPick");
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        setOauthPhase("idle");
        setOauthError(err instanceof Error ? err.message : String(err));
      }
    })();
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
          setModel(DEFAULT_CLOUD_MODEL);
          setStep("cloudModel");
        })
        .catch((err) => {
          setCloudAuthError(err instanceof Error ? err.message : String(err));
        });
    });
  };

  const handleModelPick = (picked: ModelEntry | null) => {
    // Esc / cancel in the picker → keep the current default and skip straight to confirm.
    if (!picked) {
      setStep("confirm");
      return;
    }
    setModel(picked.id);
    setPickedEntry(picked);
    // Cloud model picker: the user already chose Cloud mode, so just confirm.
    if (cloudMode) {
      setStep("confirm");
      return;
    }
    // Self-hosted routing:
    //   workers-ai       → nothing more to set up → confirm
    //   cf-catalog       → paid from AI Gateway credits, no key possible → confirm
    //   unified-eligible → ask billing mode (Cloudflare credits / BYOK)
    //   BYOK-only        → straight to key entry
    if (picked.provider === "workers-ai" || routeFor(picked) === "cf-catalog") {
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
    const provider = pickedEntry.provider as "anthropic" | "openai" | "google" | "moonshotai" | "openai-compatible";
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
      ...(oauthState ? { cloudflareOAuth: oauthState } : {}),
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

  const CLOUD_MODEL_IDS = [
    "moonshotai/kimi-k3",
    "@cf/moonshotai/kimi-k2.7-code",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/moonshotai/kimi-k2.5",
  ];
  const cloudModels = CLOUD_MODEL_IDS.map((id) => getModel(id)).filter((m): m is ModelEntry => !!m);

  // Step numbering: keep simple linear count for visible steps.
  const visibleSteps: Step[] = isCloudModeAvailable()
    ? ["mode", "auth", "routingMode", "model", "confirm"]
    : ["auth", "routingMode", "model", "confirm"];
  const stepAlias: Partial<Record<Step, Step>> = {
    oauth: "auth",
    accountPick: "auth",
    accountId: "auth",
    apiToken: "auth",
    gatewayLoading: "routingMode",
    gatewayPick: "routingMode",
    gatewayCreate: "routingMode",
    gatewayScopeError: "routingMode",
    gatewayManual: "routingMode",
    gatewayProbing: "routingMode",
    cloudModel: "model",
    billingChoice: "model",
    unifiedProbe: "model",
    keyEntry: "model",
    cloudAuth: "mode",
  };
  const stepForCount = stepAlias[step] ?? step;
  const stepIndex = Math.max(1, visibleSteps.indexOf(stepForCount) + 1);
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

        {step === "auth" && (
          <>
            <Text>Connect your Cloudflare account</Text>
            <Text color={theme.info.color}>
              Use ↑/↓ to navigate, Enter to select.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text color={authPickIdx === 0 ? theme.palette.primary : undefined}>
                {authPickIdx === 0 ? "› " : "  "}
                Log in with Cloudflare  {oauthConfigured ? "(recommended)" : "(not configured in this build)"}
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Opens your browser. Cloudflare asks you to approve kimiflare once — no API token to create, no Account ID to copy.
              </Text>
              <Text> </Text>
              <Text color={authPickIdx === 1 ? theme.palette.primary : undefined}>
                {authPickIdx === 1 ? "› " : "  "}
                Paste an API token
              </Text>
              <Text color={theme.info.color} dimColor>
                {"    "}Create a token at dash.cloudflare.com/profile/api-tokens (Workers AI:Read, AI Gateway:Read/Edit), then enter your Account ID + token.
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={theme.info.color} dimColor>
                Everything runs in your own Cloudflare account — kimiflare never sees your credentials on a server.
              </Text>
            </Box>
          </>
        )}

        {step === "oauth" && (
          <Box flexDirection="column">
            <Text bold color={theme.accent}>
              Log in with Cloudflare
            </Text>
            {oauthError ? (
              <>
                <Box marginTop={1}>
                  <Text color={theme.error}>{oauthError}</Text>
                </Box>
                <Box marginTop={1}>
                  <Text color={theme.info.color}>
                    Press <Text bold color={theme.accent}>Enter</Text> to try again · <Text bold color={theme.accent}>m</Text> to paste an API token instead · <Text bold color={theme.accent}>Esc</Text> to go back
                  </Text>
                </Box>
              </>
            ) : oauthPhase === "accounts" ? (
              <Box marginTop={1}>
                <Text color={theme.info.color}>✓ Approved. Looking up your Cloudflare accounts…</Text>
              </Box>
            ) : (
              <>
                <Box marginTop={1}>
                  <Text color={theme.info.color}>
                    {oauthUrl ? "Waiting for you to approve kimiflare in your browser…" : "Starting sign-in…"}
                  </Text>
                </Box>
                {oauthUrl && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text color={theme.info.color}>
                      If the browser didn't open, press <Text bold color={theme.accent}>Enter</Text> to open it again, or visit:
                    </Text>
                    <Text color={theme.info.color} dimColor wrap="wrap">
                      {oauthUrl}
                    </Text>
                  </Box>
                )}
                <Box marginTop={1}>
                  <Text color={theme.info.color} dimColor>
                    <Text bold>m</Text> paste an API token instead · <Text bold>Esc</Text> go back
                  </Text>
                </Box>
              </>
            )}
          </Box>
        )}

        {step === "accountPick" && (
          <>
            <Text>Which Cloudflare account should kimiflare use?</Text>
            <Text color={theme.info.color}>
              Use ↑/↓ to navigate, Enter to select.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {accounts.map((acct, i) => (
                <Text key={acct.id} color={i === accountPickIdx ? theme.palette.primary : undefined}>
                  {i === accountPickIdx ? "› " : "  "}
                  {acct.name}
                  <Text color={theme.info.color} dimColor>{"  "}{acct.id}</Text>
                </Text>
              ))}
            </Box>
          </>
        )}

        {step === "accountId" && (
          <>
            <Text>Enter your Cloudflare Account ID</Text>
            <Text color={theme.info.color}>
              Find it in the dashboard sidebar or the URL: dash.cloudflare.com/&lt;account-id&gt;
            </Text>
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

        {step === "cloudModel" && (
          <>
            <Text>Pick a Kimi model for KimiFlare Cloud</Text>
            <Text color={theme.info.color} dimColor>
              K3 runs through Cloudflare AI Gateway; K2.7/2.6/2.5 run on Workers AI.
            </Text>
            <Box marginTop={1}>
              <ModelPicker current={model} onPick={handleModelPick} models={cloudModels} />
            </Box>
            <Box marginTop={1}>
              <Text color={theme.info.color} dimColor>
                Tip: Esc keeps the default ({DEFAULT_CLOUD_MODEL}) and continues.
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
                  1. Press <Text bold color={theme.accent}>Enter</Text> to open this URL in your browser:
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
              {!cloudMode && oauthState && (
                <>
                  <Text color={theme.info.color}>
                    Cloudflare: signed in{oauthState.email ? ` as ${oauthState.email}` : ""} (Log in with Cloudflare)
                  </Text>
                  <Text color={theme.info.color}>
                    Account: {oauthState.accountName ? `${oauthState.accountName}  ` : ""}{accountId}
                  </Text>
                </>
              )}
              {!cloudMode && !oauthState && (
                <>
                  <Text color={theme.info.color}>Account ID: {accountId}</Text>
                  <Text color={theme.info.color}>API Token: {"•".repeat(Math.min(apiToken.length, 40))}</Text>
                </>
              )}
              {!cloudMode && <Text color={theme.info.color}>Model: {model}</Text>}
              {!cloudMode &&
                (aiGatewayId ? (
                  <Text color={theme.info.color}>AI Gateway: {aiGatewayId}</Text>
                ) : (
                  <Text color={theme.info.color}>Routing: Workers AI (direct)</Text>
                ))}
              {cloudMode && (
                <Text color={theme.info.color}>
                  Model: {model}
                </Text>
              )}
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
