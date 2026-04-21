import React from "react";
import { Box, Text } from "ink";
import { createTwoFilesPatch } from "diff";

interface Props {
  path: string;
  before: string;
  after: string;
  maxLines?: number;
}

export function DiffView({ path, before, after, maxLines = 40 }: Props) {
  const patch = createTwoFilesPatch(path, path, before, after, "", "", { context: 2 });
  const lines = patch.split("\n").slice(4); // drop the `Index:` + header block
  const truncated = lines.length > maxLines ? lines.slice(0, maxLines) : lines;

  return (
    <Box flexDirection="column">
      {truncated.map((line, i) => <DiffLine key={i} line={line} />)}
      {lines.length > maxLines && (
        <Text color="gray">... ({lines.length - maxLines} more lines)</Text>
      )}
    </Box>
  );
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return <Text color="green">{line}</Text>;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return <Text color="red">{line}</Text>;
  }
  if (line.startsWith("@@")) {
    return <Text color="cyan">{line}</Text>;
  }
  return <Text color="gray">{line}</Text>;
}
