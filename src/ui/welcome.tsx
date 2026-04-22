import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./theme.js";

interface Props {
  theme: Theme;
}

const SUGGESTIONS = [
  "Explain this codebase",
  "Find and fix a bug",
  "Refactor a file",
];

export function Welcome({ theme }: Props) {
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
    </Box>
  );
}
