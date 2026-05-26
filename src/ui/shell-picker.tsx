import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  current: string | undefined;
  onPick: (shell: string | null) => void;
}

const SHELLS = [
  { label: "auto — detect from environment", value: "auto" },
  { label: "bash", value: "bash" },
  { label: "cmd.exe (Windows)", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
];

export function ShellPicker({ current, onPick }: Props) {
  const theme = useTheme();
  const items = SHELLS.map((s) => ({
    label: `${s.value === (current ?? "auto") ? "● " : "  "}${s.label}`,
    value: s.value,
    key: s.value,
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Select shell
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to cancel.
      </Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onPick(item.value as string)} />
      </Box>
    </Box>
  );
}
