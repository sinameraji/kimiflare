import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { Theme } from "./theme.js";

interface Props {
  themes: Theme[];
  current: Theme;
  onPick: (theme: Theme | null) => void;
  onPreview?: (theme: Theme) => void;
}

export function ThemePicker({ themes, current, onPick, onPreview }: Props) {
  const items = themes.map((t) => ({
    label: t.label,
    value: t.name,
    key: t.name,
  }));
  items.push({ label: "(cancel)", value: "__cancel__", key: "__cancel__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={current.accent} paddingX={1}>
      <Text color={current.accent} bold>
        Pick a theme
      </Text>
      <Text color={current.info.color} dimColor={false}>
        Arrow keys to preview, Enter to confirm.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onHighlight={(item) => {
            if (item.value !== "__cancel__") {
              const highlighted = themes.find((t) => t.name === item.value);
              if (highlighted) onPreview?.(highlighted);
            }
          }}
          onSelect={(item) => {
            if (item.value === "__cancel__") return onPick(null);
            const picked = themes.find((t) => t.name === item.value) ?? null;
            onPick(picked);
          }}
          itemComponent={({ label, isSelected }) => {
            const theme = themes.find((t) => t.label === label);
            const color = theme?.accent ?? current.accent;
            return (
              <Box>
                <Text color={color} bold={isSelected} dimColor={!isSelected}>
                  {label}
                </Text>
              </Box>
            );
          }}
        />
      </Box>
    </Box>
  );
}
