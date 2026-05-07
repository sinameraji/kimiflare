import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

export interface FilePickerItem {
  name: string;
  isDirectory: boolean;
}

interface Props {
  items: FilePickerItem[];
  selectedIndex: number;
  query: string;
  recentFiles?: Set<string>;
}

const VISIBLE_LIMIT = 12;

export function FilePicker({ items, selectedIndex, query, recentFiles }: Props) {
  const theme = useTheme();
  // Scroll the visible window so the selected item is always in view.
  let startIndex = 0;
  if (selectedIndex >= VISIBLE_LIMIT) {
    startIndex = selectedIndex - VISIBLE_LIMIT + 1;
  }
  const visible = items.slice(startIndex, startIndex + VISIBLE_LIMIT);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = items.length > startIndex + VISIBLE_LIMIT;

  // Count how many recent files are in the visible slice
  const recentInVisible = visible.filter((item) => recentFiles?.has(item.name)).length;
  const hasRecentSection = recentInVisible > 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {query ? `Files matching "${query}"` : "Mention a file"}
      </Text>
      <Text color={theme.info.color} dimColor>
        ↑↓ navigate · Enter pick · Esc cancel
      </Text>
      <Box marginTop={1} flexDirection="column">
        {visible.length === 0 && (
          <Text color={theme.info.color}>
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
          const isRecent = recentFiles?.has(item.name);
          const label = item.isDirectory ? `${item.name}/` : item.name;
          const isFirstRecent = isRecent && (i === 0 || !recentFiles?.has(visible[i - 1]?.name ?? ""));
          const isFirstNonRecentAfterRecent = !isRecent && (i > 0 && recentFiles?.has(visible[i - 1]?.name ?? ""));
          return (
            <Box key={item.name} flexDirection="column">
              {hasRecentSection && isFirstRecent && (
                <Text color={theme.palette.success} bold>
                  {"  "}Recent
                </Text>
              )}
              {hasRecentSection && isFirstNonRecentAfterRecent && (
                <Text color={theme.info.color} dimColor>
                  {"  "}All files
                </Text>
              )}
              <Text color={isSelected ? theme.accent : isRecent ? theme.palette.success : undefined} bold={isSelected || isRecent}>
                {isSelected ? "› " : isRecent ? "→ " : "  "}
                {isRecent ? "↻ " : ""}
                {label}
              </Text>
            </Box>
          );
        })}
        {hasMoreBelow && (
          <Text color={theme.info.color} dimColor>
            … {items.length - (startIndex + VISIBLE_LIMIT)} more below
          </Text>
        )}
        {hasRecentSection && (
          <Box marginTop={1}>
            <Text color={theme.info.color} dimColor>
              ↻ = recently used
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
