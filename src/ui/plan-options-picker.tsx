import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { PlanOption } from "../tools/registry.js";
import { useTheme } from "./theme-context.js";

interface Props {
  options: PlanOption[];
  onPick: (option: PlanOption | null) => void;
}

export function PlanOptionsPicker({ options, onPick }: Props) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onPick(null);
      return;
    }
  });

  const items = [
    ...options.map((opt, i) => ({
      label: `${i + 1}. ${opt.label}`,
      value: String(i),
    })),
    {
      label: "Chat about this",
      value: "__chat__",
    },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Choose a plan to start fresh with
      </Text>
      <Text color={theme.info.color}>
        {options.length} option{options.length === 1 ? "" : "s"} available
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          initialIndex={selectedIndex}
          onHighlight={(item) => {
            const idx = items.findIndex((i) => i.value === item.value);
            if (idx >= 0) setSelectedIndex(idx);
          }}
          onSelect={(item) => {
            if (item.value === "__chat__") {
              onPick(null);
              return;
            }
            const opt = options[Number(item.value)];
            if (opt) {
              onPick(opt);
            } else {
              onPick(null);
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color}>q / Esc: cancel</Text>
      </Box>
    </Box>
  );
}
