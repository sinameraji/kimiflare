import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./theme.js";

interface ResumeProgressProps {
  progress: number;
  stage: string;
  theme: Theme;
}

const BAR_WIDTH = 28;
const FULL = "█";
const EMPTY = "░";

export function ResumeProgress({ progress, stage, theme }: ResumeProgressProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = FULL.repeat(filled) + EMPTY.repeat(empty);

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text color={theme.accent} bold>
        Resuming session
      </Text>
      <Box>
        <Text color={theme.accent}>{bar}</Text>
        <Text color={theme.info.color}> {Math.round(clamped)}%</Text>
      </Box>
      {stage ? (
        <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
          {stage}
        </Text>
      ) : null}
    </Box>
  );
}
