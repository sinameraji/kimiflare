import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";
import type { ModelEntry, ModelProvider } from "../models/registry.js";
import { probeUnifiedBilling, type ProbeResult } from "../agent/probe-unified-billing.js";

const PROVIDER_NAME: Record<ModelProvider, string> = {
  "workers-ai": "Cloudflare Workers AI",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI Studio",
  "openai-compatible": "your provider",
};

interface Props {
  model: ModelEntry;
  accountId: string;
  apiToken: string;
  gatewayId: string;
  onResolve: (result: "enabled" | "fallback-byok" | "cancelled") => void;
}

type Phase =
  | { kind: "probing" }
  | { kind: "success" }
  | { kind: "needs-setup"; message: string }
  | { kind: "other-error"; message: string };

export function UnifiedBillingStatus({
  model,
  accountId,
  apiToken,
  gatewayId,
  onResolve,
}: Props) {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "probing" });
  const [attempt, setAttempt] = useState(0);
  const name = PROVIDER_NAME[model.provider];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r: ProbeResult = await probeUnifiedBilling({
        accountId,
        apiToken,
        gatewayId,
        model: model.id,
      });
      if (cancelled) return;
      if (r.ok) {
        setPhase({ kind: "success" });
        // Brief flash of the success state, then resolve.
        setTimeout(() => onResolve("enabled"), 700);
      } else if (r.reason === "needs-setup") {
        setPhase({ kind: "needs-setup", message: r.message });
      } else {
        setPhase({ kind: "other-error", message: r.message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // re-run whenever `attempt` changes (Retry pressed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useInput((_input, key) => {
    if (key.escape) onResolve("cancelled");
  });

  if (phase.kind === "probing") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
        <Text color={theme.accent} bold>
          Enabling unified billing for {name}…
        </Text>
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor>
            Sending a 1-token test request through your AI Gateway. This takes a moment.
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase.kind === "success") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
        <Text color={theme.accent} bold>
          ✓ done — {name} billed via your Cloudflare credits.
        </Text>
      </Box>
    );
  }

  if (phase.kind === "needs-setup") {
    const items = [
      { label: "I've enabled it — try again", value: "retry" as const },
      { label: `Use my own ${name} API key instead`, value: "byok" as const },
      { label: "Cancel", value: "cancel" as const },
    ];
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
        <Text color={theme.accent} bold>
          {name} needs Cloudflare credits before Unified Billing can pay for it.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Step-by-step (Unified Billing is implicit — adding credits IS enabling it):</Text>
          <Text>  1. Open this URL in your browser:</Text>
          <Text color={theme.accent} underline>
            {`     https://dash.cloudflare.com/${accountId}/ai/ai-gateway`}
          </Text>
          <Text>  2. On the AI Gateway page, find the <Text bold>"Credits Available"</Text> card.</Text>
          <Text>  3. Click <Text bold>"Manage"</Text>, add a payment method if needed.</Text>
          <Text>  4. Click <Text bold>"Top-up credits"</Text> and confirm.</Text>
          <Text>  5. Come back here and pick <Text bold>"I've enabled it — try again"</Text>.</Text>
          <Box marginTop={1}>
            <Text color={theme.muted?.color ?? theme.info.color} dimColor>
              Credits are one account-wide pool. Confirmed providers: OpenAI &
              Anthropic. Others (Google, Groq, xAI) may not be supported yet —
              the retry will tell you.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted?.color ?? theme.info.color} dimColor>
              ⚠ Don't toggle "Authenticated Gateway" on the per-gateway Settings
              page — that's a different feature and will break kimi-code's auth.
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "retry") setAttempt((a) => a + 1);
              else if (item.value === "byok") onResolve("fallback-byok");
              else onResolve("cancelled");
            }}
          />
        </Box>
      </Box>
    );
  }

  // other-error
  const items = [
    { label: "Retry", value: "retry" as const },
    { label: `Use my own ${name} API key instead`, value: "byok" as const },
    { label: "Cancel", value: "cancel" as const },
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
      <Text color={theme.accent} bold>
        Couldn't reach your AI Gateway.
      </Text>
      <Box marginTop={1}>
        <Text color={theme.info.color}>{phase.message}</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "retry") setAttempt((a) => a + 1);
            else if (item.value === "byok") onResolve("fallback-byok");
            else onResolve("cancelled");
          }}
        />
      </Box>
    </Box>
  );
}
