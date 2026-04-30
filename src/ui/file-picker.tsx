import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./theme.js";

export interface FilePickerItem {
  name: string;
  isDirectory: boolean;
}

interface Props {
  items: FilePickerItem[];
  selectedIndex: number;
  theme: Theme;
  query: string;
}

const VISIBLE_LIMIT = 12;

export function FilePicker({ items, selectedIndex, theme, query }: Props) {
  // Scroll the visible window so the selected item is always in view.
  // Keep the selected item at the bottom edge when scrolling down.
  let startIndex = 0;
  if (selectedIndex >= VISIBLE_LIMIT) {
    startIndex = selectedIndex - VISIBLE_LIMIT + 1;
  }
  const visible = items.slice(startIndex, startIndex + VISIBLE_LIMIT);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = items.length > startIndex + VISIBLE_LIMIT;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {query ? `Files matching "${query}"` : "Mention a file"}
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to cancel.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {visible.length === 0 && (
          <Text color={theme.info.color} dimColor>
            No matches
          </Text>
        )}
        {hasMoreAbove && (
          <Text color={theme.info.color} dimColor>
            … {startIndex} more above
          </Text>
        )}
        {visible.map((item, i) => {
          const actualIndex = startIndex + i;
          const isSelected = actualIndex === selectedIndex;
          const label = item.isDirectory ? `${item.name}/` : item.name;
          return (
            <Text key={item.name} color={isSelected ? theme.accent : undefined} bold={isSelected}>
              {isSelected ? "› " : "  "}
              {label}
            </Text>
          );
        })}
        {hasMoreBelow && (
          <Text color={theme.info.color} dimColor>
            … {items.length - (startIndex + VISIBLE_LIMIT)} more below
          </Text>
        )}
      </Box>
    </Box>
  );
}
