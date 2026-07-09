import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";

interface Props {
  used: number;
  limit: number;
  expiresAt?: string;
  onUpgrade?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CloudQuotaMessage({ used, limit, onUpgrade }: Props) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={theme.accent}>
        You've run out of free credits.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          → KimiFlare Pro: <Text bold>$10/month for 50M tokens</Text>
          {onUpgrade ? <Text color={theme.info.color}>  ·  type /upgrade</Text> : null}
        </Text>
        <Text>
          → Or self-host with your own Cloudflare account: <Text color={theme.info.color}>kimiflare config set-key &lt;your-key&gt;</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
          Used: {formatTokens(used)} / {formatTokens(limit)} tokens.
        </Text>
      </Box>
    </Box>
  );
}
