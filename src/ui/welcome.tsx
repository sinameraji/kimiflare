import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import { buildWelcome } from "./greetings.js";

interface Props {
  accountId?: string;
  cloudMode?: boolean;
  gitBranch?: string | null;
  lastSessionTopic?: string | null;
}

export function Welcome({ accountId, cloudMode, gitBranch, lastSessionTopic }: Props) {
  const theme = useTheme();
  const now = new Date();
  const { headline, suggestions } = buildWelcome({
    gitBranch: gitBranch ?? null,
    lastSessionTopic: lastSessionTopic ?? null,
    hour: now.getHours(),
    day: now.getDay(),
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.accent}>
          kimiflare
        </Text>
        <Text color={theme.info.color} >
          {"  "}{headline}
        </Text>
      </Box>
      {accountId && !cloudMode && (
        <Box marginBottom={1}>
          <Text color={theme.info.color} >
            {"  "}Check your Cloudflare billing: https://dash.cloudflare.com/{accountId}/billing/billable-usage
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {suggestions.map((s, i) => (
          <Box key={i}>
            <Text color={theme.info.color} >
              {"  "}›{" "}
            </Text>
            <Text color={theme.user}>{s}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color} >
          Type a message or /help for commands · ctrl-c to exit · shift+tab to cycle modes
        </Text>
      </Box>
      <Box>
        <Text color={theme.info.color} >
          Tip: type /hello to send feedback to the creator
        </Text>
      </Box>
    </Box>
  );
}
