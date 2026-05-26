import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { MODES, modeDescription, type Mode } from "../mode.js";
import { useTheme } from "./theme-context.js";

interface Props {
  current: Mode;
  onPick: (mode: Mode | null) => void;
  multiAgentEnabled?: boolean;
}

export function ModePicker({ current, onPick, multiAgentEnabled }: Props) {
  const theme = useTheme();
  const availableModes = multiAgentEnabled ? MODES : MODES.filter((m) => m !== "multi-agent-experimental");
  const items = availableModes.map((m) => ({
    label: `${m === current ? "● " : "  "}${modeDescription(m)}`,
    value: m,
    key: m,
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Select mode
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to cancel.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onPick(item.value as Mode)}
        />
      </Box>
    </Box>
  );
}
