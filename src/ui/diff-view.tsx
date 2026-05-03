import React from "react";
import { Box, Text } from "ink";
import { createTwoFilesPatch } from "diff";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

interface Props {
  path: string;
  before: string;
  after: string;
  maxLines?: number;
}

export function DiffView({ path, before, after, maxLines = 40 }: Props) {
  const theme = useTheme();
  const patch = createTwoFilesPatch(path, path, before, after, "", "", { context: 2 });
  const raw = patch.split("\n").slice(4);
  const lines = raw.filter((l) => {
    if (l.startsWith("--- ") || l.startsWith("+++ ")) return false;
    if (l.startsWith("\\ No newline at end of file")) return false;
    return true;
  });

  const diffStats = countChanges(lines);
  const hideHeader =
    diffStats.changed <= 3 && diffStats.context <= 3 && diffStats.hunks <= 1;
  const filtered = hideHeader
    ? lines.filter((l) => !l.startsWith("@@"))
    : lines;

  const truncated = filtered.length > maxLines ? filtered.slice(0, maxLines) : filtered;

  return (
    <Box flexDirection="column">
      {truncated.map((line, i) => <DiffLine key={i} line={line} />)}
      {filtered.length > maxLines && (
        <Text color={theme.info.color} >... ({filtered.length - maxLines} more lines)</Text>
      )}
    </Box>
  );
}

function countChanges(lines: string[]): { changed: number; context: number; hunks: number } {
  let changed = 0;
  let context = 0;
  let hunks = 0;
  for (const l of lines) {
    if (l.startsWith("@@")) hunks++;
    else if (l.startsWith("+") || l.startsWith("-")) changed++;
    else if (l.trim().length > 0) context++;
  }
  return { changed, context, hunks };
}

function DiffLine({ line }: { line: string }) {
  const theme = useTheme();
  if (line.startsWith("+")) return <Text color={theme.palette.success}>{line}</Text>;
  if (line.startsWith("-")) return <Text color={theme.palette.error}>{line}</Text>;
  if (line.startsWith("@@")) return <Text color={theme.palette.secondary}>{line}</Text>;
  return <Text color={theme.info.color} >{line}</Text>;
}
