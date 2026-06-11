import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "./theme-context.js";

interface PeriodOption {
  label: string;
  days: number;
}

const PERIODS: PeriodOption[] = [
  { label: "Past 24 hours", days: 1 },
  { label: "Past 7 days", days: 7 },
  { label: "Past 30 days", days: 30 },
];

interface Props {
  owner: string;
  repo: string;
  onGenerate: (owner: string, repo: string, days: number) => void;
  onCancel: () => void;
}

export function ChangelogImagePicker({ owner, repo, onGenerate, onCancel }: Props) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const option = PERIODS[selectedIndex];
      if (option) {
        onGenerate(owner, repo, option.days);
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(PERIODS.length - 1, i + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Changelog Image: {owner}/{repo}
      </Text>
      <Text color={theme.info.color} dimColor>
        Select a time period to summarize
      </Text>
      <Box marginTop={1} flexDirection="column">
        {PERIODS.map((period, i) => {
          const isSelected = i === selectedIndex;
          const marker = isSelected ? "▸" : " ";
          return (
            <Box key={period.label}>
              <Text color={isSelected ? theme.accent : theme.info.color} bold={isSelected}>
                {marker} {period.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          ↑↓ navigate · Enter select · Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
