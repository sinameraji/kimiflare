import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./theme.js";

interface Props {
  theme: Theme;
  accountId?: string;
}

const SUGGESTIONS = [
  "Explain this codebase",
  "Find and fix a bug",
  "Refactor a file",
];

export function Welcome({ theme, accountId }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.accent}>
          kimiflare
        </Text>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          {"  "}Ready when you are.
        </Text>
      </Box>
      {accountId && (
        <Box marginBottom={1}>
          <Text color={theme.info.color} dimColor={theme.info.dim}>
            {"  "}Check your Cloudflare billing: https://dash.cloudflare.com/{accountId}/billing/billable-usage
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {SUGGESTIONS.map((s, i) => (
          <Box key={i}>
            <Text color={theme.info.color} dimColor={theme.info.dim}>
              {"  "}›{" "}
            </Text>
            <Text color={theme.user}>{s}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          Type a message or /help for commands · ctrl-c to exit · shift+tab to cycle modes
        </Text>
      </Box>
      <Box>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          Tip: type /hello to send feedback to the creator
        </Text>
      </Box>
      <Box>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          Join our community: https://discord.gg/aEuAUHNTK5 (type /community to open)
        </Text>
      </Box>
    </Box>
  );
}
