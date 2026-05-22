import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  enabled: boolean;
  onAction: (action: string) => void;
  onDone: () => void;
}

export function MemoryPicker({ enabled, onAction, onDone }: Props) {
  const theme = useTheme();
  const items = [
    { label: enabled ? "● Disable memory" : "● Enable memory", value: enabled ? "off" : "on", key: "toggle" },
    { label: "  Show memory stats", value: "stats", key: "stats" },
    { label: "  Clear all memories", value: "clear", key: "clear" },
    { label: "  Search memories…", value: "search", key: "search" },
    { label: "  (close)", value: "__close__", key: "close" },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Memory
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to close.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__close__") {
              onDone();
            } else {
              onAction(item.value as string);
            }
          }}
        />
      </Box>
    </Box>
  );
}
