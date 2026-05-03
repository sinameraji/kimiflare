import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { CustomCommand } from "../commands/types.js";
import { useTheme } from "./theme-context.js";

interface Props {
  commands: CustomCommand[];
  title: string;
  onPick: (cmd: CustomCommand | null) => void;
}

export function CommandPicker({ commands, title, onPick }: Props) {
  const theme = useTheme();
  const items = commands.map((cmd) => ({
    label: `/${cmd.name.padEnd(20)} ${cmd.description ?? ""}`,
    value: cmd,
    key: cmd.name,
  }));
  items.push({ label: "← Cancel", value: null as unknown as CustomCommand, key: "__cancel__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {title}
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.key === "__cancel__") {
              onPick(null);
            } else {
              onPick(item.value as CustomCommand);
            }
          }}
        />
      </Box>
    </Box>
  );
}
