import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import { buildWelcome } from "./greetings.js";

interface Props {
  accountId?: string;
  gitBranch?: string | null;
  lastSessionTopic?: string | null;
}

export function Welcome({ accountId, gitBranch, lastSessionTopic }: Props) {
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
          {headline}
        </Text>
        {gitBranch && (
          <Text color={theme.info.color}>
            {" "}· {gitBranch}
          </Text>
        )}
      </Box>

      {suggestions.length > 0 && (
        <Box flexDirection="column">
          {suggestions.map((s, i) => (
            <Text key={i} color={theme.info.color} dimColor>
              {s}
            </Text>
          ))}
        </Box>
      )}

    </Box>
  );
}
