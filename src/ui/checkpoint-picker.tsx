import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { SessionSummary, Checkpoint } from "../sessions.js";
import { useTheme } from "./theme-context.js";

interface Props {
  session: SessionSummary;
  checkpoints: Checkpoint[];
  onPick: (checkpointId: string | null) => void;
}

export function CheckpointPicker({ session, checkpoints, onPick }: Props) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onPick(null);
      return;
    }
  });

  const items = [
    {
      label: `Resume from beginning (${session.messageCount} msgs)`,
      value: "__start__",
    },
    ...checkpoints.map((cp) => ({
      label: `Resume from: "${cp.label}" — turn ${cp.turnIndex} · ${formatDate(cp.timestamp)}`,
      value: cp.id,
    })),
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {session.firstPrompt.slice(0, 50)}
      </Text>
      <Text color={theme.info.color}>
        {session.messageCount} turns · {checkpoints.length} checkpoint{checkpoints.length === 1 ? "" : "s"}
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
            if (item.value === "__start__") {
              onPick("__start__");
            } else {
              onPick(item.value);
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color}>q: cancel / go back</Text>
      </Box>
    </Box>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
