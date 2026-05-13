import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

export type LimitDecision = "continue" | "stop";
export type LoopDecision = "continue" | "stop" | "synthesize";

interface Props<T extends string = LimitDecision> {
  limit: number;
  onDecide: (decision: T) => void;
  title?: string;
  description?: string;
  items?: Array<{ label: string; value: T }>;
}

export function LimitModal<T extends string = LimitDecision>({ limit, onDecide, title, description, items }: Props<T>) {
  const theme = useTheme();
  const defaultItems = [
    { label: "Continue", value: "continue" as T },
    { label: "Stop", value: "stop" as T },
  ];
  const selectItems = items ?? defaultItems;

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
          items={selectItems}
          onSelect={(item) => onDecide(item.value)}
        />
      </Box>
    </Box>
  );
}
