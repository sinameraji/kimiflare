import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import { buildWelcome } from "./greetings.js";

interface WelcomeProps {
  showFeedbackPrompt?: boolean;
}

export function Welcome({ showFeedbackPrompt }: WelcomeProps) {
  const theme = useTheme();
  const now = new Date();
  const { headline } = buildWelcome({
    hour: now.getHours(),
    day: now.getDay(),
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.accent}>
          {headline}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={theme.info.color} dimColor>
          Type / for commands
        </Text>
      </Box>

      {showFeedbackPrompt && (
        <Box>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
            �� How do you like the new version? You can send me a small feedback using /hello.
          </Text>
        </Box>
      )}
    </Box>
  );
}
