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
  const visible = items.slice(0, VISIBLE_LIMIT);
  const hasMore = items.length > VISIBLE_LIMIT;

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
        {visible.map((item, i) => {
          const isSelected = i === selectedIndex;
          const label = item.isDirectory ? `${item.name}/` : item.name;
          return (
            <Text key={item.name + i} color={isSelected ? theme.accent : undefined} bold={isSelected}>
              {isSelected ? "› " : "  "}
              {label}
            </Text>
          );
        })}
        {hasMore && (
          <Text color={theme.info.color} dimColor>
            … and {items.length - VISIBLE_LIMIT} more
          </Text>
        )}
      </Box>
    </Box>
  );
}
