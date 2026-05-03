import React, { useState } from "react";
import { Box, Text, useWindowSize } from "ink";
import SelectInput from "ink-select-input";
import type { SessionSummary } from "../sessions.js";
import { DEFAULT_THEME as theme } from "./theme.js";

interface Props {
  sessions: SessionSummary[];
  onPick: (session: SessionSummary | null) => void;
}

const HEADER_ROWS = 5; // title + subtitle + border padding + margin
const FOOTER_ROWS = 2; // cancel + bottom padding
const MIN_PAGE_SIZE = 5;

export function ResumePicker({ sessions, onPick }: Props) {
  const { rows } = useWindowSize();
  const [page, setPage] = useState(0);

  const pageSize = Math.max(MIN_PAGE_SIZE, rows - HEADER_ROWS - FOOTER_ROWS);
  const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

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

  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, sessions.length);
  const pageSessions = sessions.slice(start, end);

  const items = pageSessions.map((s) => ({
    label: `${formatDate(s.updatedAt)}  ·  ${s.messageCount} msgs  ·  ${s.firstPrompt}`,
    value: s.id,
  }));

  if (safePage > 0) {
    items.push({ label: "← previous page", value: "__prev__" });
  }
  if (safePage < totalPages - 1) {
    items.push({ label: "→ next page", value: "__next__" });
  }
  items.push({ label: "(cancel)", value: "__cancel__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Resume a session
      </Text>
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        Arrow keys to select, Enter to confirm. Page {safePage + 1} of {totalPages} ({sessions.length} total)
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__cancel__") return onPick(null);
            if (item.value === "__prev__") return setPage((p) => Math.max(0, p - 1));
            if (item.value === "__next__") return setPage((p) => Math.min(totalPages - 1, p + 1));
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
