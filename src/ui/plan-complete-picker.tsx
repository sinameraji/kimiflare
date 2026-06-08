import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

export type PlanCompleteChoice = "auto" | "edit" | "continue";

interface Props {
  onPick: (choice: PlanCompleteChoice | null) => void;
}

export function PlanCompletePicker({ onPick }: Props) {
  const theme = useTheme();
  const items = [
    { label: "▸ Execute this plan and accept changes (auto mode)", value: "auto" as const, key: "auto" },
    { label: "▸ Start building and ask for permission (edit mode)", value: "edit" as const, key: "edit" },
    { label: "▸ Continue planning / ask a question", value: "continue" as const, key: "continue" },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Plan complete — what next?
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to cancel.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onPick(item.value)}
          onHighlight={() => {}}
        />
      </Box>
    </Box>
  );
}
