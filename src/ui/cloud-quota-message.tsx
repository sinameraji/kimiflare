import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";

interface Props {
  used: number;
  limit: number;
  expiresAt: string;
  onUpgrade?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CloudQuotaMessage({ used, limit, expiresAt, onUpgrade }: Props) {
  const theme = useTheme();

  const expires = expiresAt ? new Date(expiresAt) : null;
  const start = expires
    ? new Date(expires.getTime() - 7 * 24 * 60 * 60 * 1000)
    : null;

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dateRange = start && expires ? `${fmt(start)} → ${fmt(expires)}` : "this week";

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={theme.accent}>
        You've used your free allocation for this week.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.info.color}>
          Free tier ran from {dateRange}, courtesy of Cloudflare
        </Text>
        <Text color={theme.info.color}>
          Workers AI credits. Thanks for trying kimiflare.
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Upgrade to KimiFlare Pro:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={theme.info.color}>
            → $10/month founding-user price
          </Text>
          <Text color={theme.info.color}>
            → Includes ~50M tokens/month (usage allowance)
          </Text>
          <Text color={theme.info.color}>
            → No Cloudflare account needed
          </Text>
        </Box>
        {onUpgrade ? (
          <Box marginTop={1}>
            <Text bold color={theme.accent}>
              Press Enter or run /upgrade to subscribe
            </Text>
          </Box>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Keep going with your own Cloudflare API key:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={theme.info.color}>
            → Set one: kimiflare config set-key &lt;your-key&gt;
          </Text>
          <Text color={theme.info.color}>
            → Get one: https://dash.cloudflare.com/profile/api-tokens
          </Text>
          <Text color={theme.info.color}>
            → Pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
          </Text>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
            (~$0.95/M input tokens, ~$4.00/M output tokens)
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
          Used: {formatTokens(used)} / {formatTokens(limit)} tokens this week.
        </Text>
      </Box>
    </Box>
  );
}
