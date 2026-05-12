import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

export type LimitDecision = "continue" | "stop";

interface Props {
  limit: number;
  onDecide: (decision: LimitDecision) => void;
  title?: string;
  description?: string;
}

export function LimitModal({ limit, onDecide, title, description }: Props) {
  const theme = useTheme();
  const items = [
    { label: "Continue", value: "continue" as const },
    { label: "Stop", value: "stop" as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.error} paddingX={1}>
      <Text color={theme.error} bold>
        {title ?? `Tool-call limit reached (${limit})`}
      </Text>
      <Text dimColor>
        {description ?? `This session has made ${limit} tool calls. What would you like to do?`}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onDecide(item.value)}
        />
      </Box>
    </Box>
  );
}
