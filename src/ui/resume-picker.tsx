import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { SessionSummary } from "../sessions.js";
import type { Theme } from "./theme.js";

interface Props {
  sessions: SessionSummary[];
  onPick: (session: SessionSummary | null) => void;
  theme: Theme;
}

export function ResumePicker({ sessions, onPick, theme }: Props) {
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Resume a session
        </Text>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          No saved sessions yet. Press Enter to dismiss.
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={[{ label: "(back)", value: "__cancel__" }]}
            onSelect={() => onPick(null)}
          />
        </Box>
      </Box>
    );
  }

  const items = sessions.map((s) => ({
    label: `${formatDate(s.updatedAt)}  ·  ${s.messageCount} msgs  ·  ${s.firstPrompt}`,
    value: s.id,
  }));
  items.push({ label: "(cancel)", value: "__cancel__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Resume a session
      </Text>
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        Arrow keys to select, Enter to confirm.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__cancel__") return onPick(null);
            const picked = sessions.find((s) => s.id === item.value) ?? null;
            onPick(picked);
          }}
        />
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
