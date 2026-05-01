import React from "react";
import { Box, Text } from "ink";
import { createTwoFilesPatch } from "diff";
import type { Theme } from "./theme.js";

interface Props {
  path: string;
  before: string;
  after: string;
  maxLines?: number;
  theme: Theme;
}

export function DiffView({ path, before, after, maxLines = 40, theme }: Props) {
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
      {truncated.map((line, i) => (
        <DiffLine key={i} line={line} theme={theme} />
      ))}
      {filtered.length > maxLines && (
        <Text color={theme.muted.color} dimColor={theme.muted.dim}>
          ... ({filtered.length - maxLines} more lines)
        </Text>
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

function DiffLine({ line, theme }: { line: string; theme: Theme }) {
  if (line.startsWith("+")) return <Text color={theme.diffAdded}>{line}</Text>;
  if (line.startsWith("-")) return <Text color={theme.diffRemoved}>{line}</Text>;
  if (line.startsWith("@@")) return <Text color={theme.diffMeta}>{line}</Text>;
  return <Text color={theme.muted.color} dimColor={theme.muted.dim}>{line}</Text>;
}
