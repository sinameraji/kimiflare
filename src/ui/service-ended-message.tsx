import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";

interface Props {
  endedAt?: string;
}

export function ServiceEndedMessage({ endedAt }: Props) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={theme.accent}>
        KimiFlare Cloud has reached its maximum budget across all users.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.info.color}>
          The free credits period has ended{endedAt ? ` at ${new Date(endedAt).toLocaleString()}` : ""}.
        </Text>
        <Text color={theme.info.color}>
          Thank you for using KimiFlare!
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>To continue using KimiFlare, switch to Bring Your Own Key mode:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={theme.info.color}>
            → Set API token: kimiflare config set-key &lt;your-key&gt;
          </Text>
          <Text color={theme.info.color}>
            → Set account ID: kimiflare config set-account &lt;your-account-id&gt;
          </Text>
          <Text color={theme.info.color}>
            → Get a token: https://dash.cloudflare.com/profile/api-tokens
          </Text>
          <Text color={theme.info.color}>
            → Or re-run kimiflare and select "BYOK — bring your own Cloudflare key"
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
          You can no longer send messages or authenticate via KimiFlare Cloud.
        </Text>
      </Box>
    </Box>
  );
}
