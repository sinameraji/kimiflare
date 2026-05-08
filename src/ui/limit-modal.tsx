import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";
import { Frame } from "./frame.js";

export type LimitDecision = "continue" | "stop";

interface Props {
  limit: number;
  onDecide: (decision: LimitDecision) => void;
}

export function LimitModal({ limit, onDecide }: Props) {
  const theme = useTheme();
  const items = [
    { label: "Continue", value: "continue" as const },
    { label: "Stop", value: "stop" as const },
  ];

  return (
    <Frame borderColor={theme.error} padX={1}>
      <Text color={theme.error} bold>
        Tool-call limit reached ({limit})
      </Text>
      <Text dimColor>
        This session has made {limit} tool calls. What would you like to do?
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onDecide(item.value)}
        />
      </Box>
    </Frame>
  );
}
