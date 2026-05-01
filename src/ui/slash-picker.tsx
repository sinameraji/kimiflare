import React from "react";
import { Box, Text } from "ink";
import type { SlashItem } from "../commands/types.js";
import type { Theme } from "./theme.js";

interface Props {
  items: SlashItem[];
  selectedIndex: number;
  theme: Theme;
  query: string;
}

const VISIBLE_LIMIT = 7;
const NAME_COL_MIN_WIDTH = 18;
const NAME_DESC_GAP = 2;

function sourceBadge(source: SlashItem["source"]): string {
  if (source === "builtin") return "";
  if (source === "project") return "project";
  return "global";
}

function commandLabel(item: SlashItem): string {
  return `/${item.name}${item.argHint ? ` ${item.argHint}` : ""}`;
}

export function SlashPicker({ items, selectedIndex, theme, query }: Props) {
  let startIndex = 0;
  if (selectedIndex >= VISIBLE_LIMIT) {
    startIndex = selectedIndex - VISIBLE_LIMIT + 1;
  }
  const visible = items.slice(startIndex, startIndex + VISIBLE_LIMIT);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = items.length > startIndex + VISIBLE_LIMIT;
  // Pad to the longest visible label so descriptions align across rows.
  const longestLabel = visible.reduce((m, it) => Math.max(m, commandLabel(it).length), 0);
  const nameColWidth = Math.max(NAME_COL_MIN_WIDTH, longestLabel + NAME_DESC_GAP);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {query ? `Commands matching "/${query}"` : "Slash commands"}
      </Text>
      <Text color={theme.info.color}>
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
          const nameCol = commandLabel(item).padEnd(nameColWidth);
          const badge = sourceBadge(item.source);
          return (
            <Text key={item.name} color={isSelected ? theme.accent : undefined} bold={isSelected}>
              {isSelected ? "› " : "  "}
              {nameCol}
              <Text color={theme.info.color} dimColor>
                {item.description}
                {badge && `  [${badge}]`}
              </Text>
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
