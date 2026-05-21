import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import { verifyApiTokenForWorkersAi } from "../cloud/verify-token.js";

interface Props {
  accountId: string;
  /** What the original failure was, surfaced verbatim above the input so the user
   *  understands which token Cloudflare rejected. */
  reason: string;
  /** Receives the verified token. Caller is responsible for persisting cfg + retry. */
  onSave: (newToken: string) => void;
  /** Closes the modal without changing anything. */
  onCancel: () => void;
}

function maskPreview(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

type Phase =
  | { kind: "collecting"; inlineError: string | null }
  | { kind: "verifying" }
  | { kind: "scope-error"; message: string }
  | { kind: "rejected"; message: string };

/**
 * Opens in response to a Cloudflare auth failure on a Workers AI call. Lets
 * the user paste an updated API token without leaving the TUI. We verify the
 * pasted token against /user/tokens/verify plus a minimal Workers AI probe
 * before saving — a token that passes /tokens/verify but lacks Workers AI
 * scope would just bounce the user back to the same modal on the next turn.
 */
export function TokenUpdateModal({ accountId, reason, onSave, onCancel }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "collecting", inlineError: null });

  useInput((input, key) => {
    if (key.escape && phase.kind === "collecting") {
      onCancel();
      return;
    }
    if (key.ctrl && input === "r" && phase.kind === "collecting") {
      setReveal((r) => !r);
    }
  });

  const verifyAndSave = async (raw: string) => {
    setPhase({ kind: "verifying" });
    const result = await verifyApiTokenForWorkersAi(accountId, raw);
    if (result.ok) {
      onSave(raw);
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

  if (phase.kind === "verifying") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.accent} bold>
          Verifying token with Cloudflare…
        </Text>
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor>
            Checking the token is active and carries Workers AI permission.
          </Text>
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
          <Box marginTop={1} flexDirection="column">
            <Text>
              Edit this token at{" "}
              <Text color={theme.accent} underline>
                https://dash.cloudflare.com/profile/api-tokens
              </Text>{" "}
              and add the{" "}
              <Text bold>Workers AI</Text> permission (Read is enough). Then paste it again below.
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
      <Box marginTop={1} flexDirection="column">
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
          We verify with /user/tokens/verify and a 1-token Workers AI probe before saving. The new
          value replaces apiToken in your config file (mode 600). Do not commit it.
        </Text>
      </Box>
    </Box>
  );
}
