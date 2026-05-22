import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  onAction: (action: string) => void;
  onDone: () => void;
}

export function SkillsPicker({ onAction, onDone }: Props) {
  const theme = useTheme();
  const items = [
    { label: "  List skills", value: "list", key: "list" },
    { label: "  Add skill…", value: "add", key: "add" },
    { label: "  Edit skill…", value: "edit", key: "edit" },
    { label: "  Delete skill…", value: "delete", key: "delete" },
    { label: "  Enable skill…", value: "enable", key: "enable" },
    { label: "  Disable skill…", value: "disable", key: "disable" },
    { label: "  (close)", value: "__close__", key: "close" },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Skills
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
