import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import {
  verifyApiTokenForWorkersAi,
  diagnoseCurrentToken,
} from "../cloud/verify-token.js";

interface Props {
  accountId: string;
  /** Current saved token, used for the on-mount diagnostic. */
  currentToken: string;
  /** Current saved gateway id, if any. */
  gatewayId?: string;
  /** Verbatim text from the original failure (HTTP status + code), shown for
   *  context so the user knows what kimiflare actually saw. */
  reason: string;
  /** Receives a freshly verified token. Caller persists cfg + retries. */
  onSave: (newToken: string) => void;
  /** Called when the user picks "I've turned Authenticated Gateway off" so
   *  the caller can re-fire the failed turn without changing the token. */
  onRetryWithCurrentToken: () => void;
  /** Closes the modal without changing anything. */
  onCancel: () => void;
}

function maskPreview(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

type Phase =
  | { kind: "diagnosing" }
  | { kind: "collecting"; inlineError: string | null }
  | { kind: "verifying" }
  | { kind: "scope-error"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "authenticated-gateway"; message: string };

/**
 * Opens in response to a Cloudflare auth failure on a Workers AI call. On
 * mount we diagnose the *currently saved* token against both the direct
 * Workers AI endpoint and (when configured) the gateway URL so we can tell
 * apart "token is wrong, paste a new one" from "token is fine but the
 * gateway is rejecting it because Authenticated Gateway is on".
 */
export function TokenUpdateModal({
  accountId,
  currentToken,
  gatewayId,
  reason,
  onSave,
  onRetryWithCurrentToken,
  onCancel,
}: Props) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "diagnosing" });

  // Diagnose the current token once when the modal opens. If it's actually
  // working now (e.g. the user already toggled Authenticated Gateway off
  // before opening kimiflare), we tell them to just retry; if the gateway is
  // the problem, we skip the paste step and show the gateway recovery; if
  // the token genuinely doesn't work, we ask for a new one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await diagnoseCurrentToken(accountId, currentToken, gatewayId);
      if (cancelled) return;
      if (r.ok) {
        // Strange but possible: a transient CF blip caused the original turn
        // to fail but the token actually works now. Offer to retry without
        // touching anything.
        setPhase({ kind: "authenticated-gateway", message: "Current token now works against Cloudflare. The original failure looks transient." });
        return;
      }
      if (r.reason === "authenticated-gateway") {
        setPhase({ kind: "authenticated-gateway", message: r.message });
        return;
      }
      if (r.reason === "missing-workers-ai-scope") {
        setPhase({ kind: "scope-error", message: r.message });
        return;
      }
      setPhase({ kind: "collecting", inlineError: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, currentToken, gatewayId]);

  useInput((input, key) => {
    if (key.escape && (phase.kind === "collecting" || phase.kind === "authenticated-gateway")) {
      onCancel();
      return;
    }
    if (key.ctrl && input === "r" && phase.kind === "collecting") {
      setReveal((r) => !r);
    }
  });

  const verifyAndSave = async (raw: string) => {
    setPhase({ kind: "verifying" });
    const result = await verifyApiTokenForWorkersAi(accountId, raw, gatewayId);
    if (result.ok) {
      onSave(raw);
      return;
    }
    if (result.reason === "authenticated-gateway") {
      // Pasting a different account token won't help — gateway needs a
      // gateway-specific token (which kimiflare doesn't yet support). Surface
      // the recovery for that case instead of looping the user.
      setPhase({ kind: "authenticated-gateway", message: result.message });
      return;
    }
    if (result.reason === "missing-workers-ai-scope") {
      setPhase({ kind: "scope-error", message: result.message });
      return;
    }
    setPhase({ kind: "rejected", message: result.message });
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPhase({ kind: "collecting", inlineError: "Paste a token, or press Esc to cancel." });
      return;
    }
    void verifyAndSave(trimmed);
  };

  if (phase.kind === "diagnosing" || phase.kind === "verifying") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.accent} bold>
          {phase.kind === "diagnosing"
            ? "Checking what Cloudflare is rejecting…"
            : "Verifying token with Cloudflare…"}
        </Text>
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor>
            {phase.kind === "diagnosing"
              ? "Testing the current token against the Workers AI direct API and the configured AI Gateway to figure out which side is the problem."
              : "Checking the token is active and carries Workers AI permission."}
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase.kind === "authenticated-gateway") {
    const settingsUrl = gatewayId
      ? `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/ai/ai-gateway/${encodeURIComponent(gatewayId)}/settings`
      : "https://dash.cloudflare.com/?to=/:account/ai/ai-gateway";
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.accent} bold>
          Your AI Gateway has "Authenticated Gateway" turned on
        </Text>
        <Box marginTop={1}>
          <Text color={theme.info.color}>{phase.message}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            "Authenticated Gateway" makes the gateway reject the account API token unless every
            request also carries a <Text bold>gateway-specific token</Text> in
            {" "}
            <Text bold>cf-aig-authorization</Text>. kimiflare doesn't issue or send a
            gateway-specific token yet, so this toggle has to be{" "}
            <Text bold>off</Text> for Workers AI calls to route through the gateway.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>To fix:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              1. Open <Text color={theme.accent} underline>{settingsUrl}</Text>
            </Text>
            <Text>2. Find <Text bold>Authenticated Gateway</Text> and turn it off</Text>
            <Text>
              3. Leave <Text bold>Authentication</Text> (the separate UB-related toggle) as it is
            </Text>
            <Text>4. Press Enter below to retry the failed turn</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor>
            Enter to retry  ·  Esc to cancel
          </Text>
        </Box>
        <Box height={0} overflow="hidden">
          <CustomTextInput value="" onChange={() => {}} onSubmit={onRetryWithCurrentToken} focus />
        </Box>
      </Box>
    );
  }

  if (phase.kind === "scope-error" || phase.kind === "rejected") {
    const isScope = phase.kind === "scope-error";
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.accent} bold>
          {isScope ? "Token is valid but missing a permission" : "Cloudflare rejected this token"}
        </Text>
        <Box marginTop={1}>
          <Text color={theme.info.color}>{phase.message}</Text>
        </Box>
        {isScope && (
          <Box marginTop={1}>
            <Text>
              Edit this token at{" "}
              <Text color={theme.accent} underline>
                https://dash.cloudflare.com/profile/api-tokens
              </Text>{" "}
              and add the <Text bold>Workers AI</Text> permission (Read is enough). Then paste it
              again below.
            </Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.info.color}>API token:</Text>
          {reveal ? (
            <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
          ) : (
            <Box flexDirection="column">
              <Text>{maskPreview(value) || " "}</Text>
              <Box height={0} overflow="hidden">
                <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
              </Box>
            </Box>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor>
            Enter to retry  ·  Ctrl+R to {reveal ? "hide" : "reveal"}  ·  Esc to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // phase === "collecting"
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={2}
      paddingY={1}
    >
      <Text color={theme.accent} bold>
        Cloudflare authentication failed
      </Text>
      <Box marginTop={1}>
        <Text color={theme.info.color}>{reason}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          The Cloudflare API token saved in <Text bold>~/.config/kimiflare/config.json</Text> was
          rejected. Most common causes:
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>• The token is missing the <Text bold>Workers AI</Text> permission</Text>
          <Text>• The token has been revoked or rotated on Cloudflare</Text>
          <Text>• The account id and token are from different accounts</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text>
          Paste an updated token below. Create or review tokens at{" "}
          <Text color={theme.accent} underline>
            https://dash.cloudflare.com/profile/api-tokens
          </Text>
          .
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.info.color}>API token:</Text>
        {reveal ? (
          <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
        ) : (
          <Box flexDirection="column">
            <Text>{maskPreview(value) || " "}</Text>
            <Box height={0} overflow="hidden">
              <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
            </Box>
          </Box>
        )}
      </Box>
      {phase.inlineError && (
        <Box marginTop={1}>
          <Text color="red">{phase.inlineError}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor>
          Enter to verify &amp; save  ·  Ctrl+R to {reveal ? "hide" : "reveal"}  ·  Esc to cancel
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor>
          We verify with /user/tokens/verify and a 1-token Workers AI probe (direct + through the
          gateway when configured) before saving.
        </Text>
      </Box>
    </Box>
  );
}
