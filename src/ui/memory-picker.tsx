import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import type { MemoryManager } from "../memory/manager.js";
import type { HybridResult } from "../memory/schema.js";

interface Props {
  enabled: boolean;
  memoryManager: MemoryManager | null;
  onAction: (action: string) => void;
  onDone: () => void;
}

type Screen = "menu" | "search" | "confirm-clear";

export function MemoryPicker({ enabled, memoryManager, onAction, onDone }: Props) {
  const theme = useTheme();
  const [screen, setScreen] = useState<Screen>("menu");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HybridResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useInput((_, key) => {
    if (key.escape) {
      if (screen === "search" || screen === "confirm-clear") {
        setScreen("menu");
        setQuery("");
        setResults([]);
        setSearched(false);
      } else {
        onDone();
      }
    }
  });

  const runSearch = useCallback(
    async (q: string) => {
      if (!memoryManager || !q.trim()) return;
      setSearching(true);
      try {
        const res = await memoryManager.recall({ text: q.trim(), limit: 10 });
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setSearched(true);
      }
    },
    [memoryManager],
  );

  if (screen === "confirm-clear") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          ⚠️  Clear All Memories
        </Text>
        <Text color={theme.info.color}>
          This will permanently delete every stored memory. This cannot be undone.
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Yes, clear everything", value: "yes", key: "yes" },
              { label: "No, keep my memories", value: "no", key: "no" },
            ]}
            onSelect={(item) => {
              if (item.value === "yes") {
                onAction("clear");
              }
              onDone();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (screen === "search") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Search Memories
        </Text>
        <Text color={theme.info.color} dimColor={false}>
          Type a query and press Enter. Esc to go back.
        </Text>
        <Box marginTop={1}>
          <CustomTextInput
            value={query}
            onChange={setQuery}
            onSubmit={(q) => runSearch(q)}
            focus
          />
        </Box>
        {searching && (
          <Box marginTop={1}>
            <Text color={theme.info.color}>Searching…</Text>
          </Box>
        )}
        {searched && !searching && results.length === 0 && (
          <Box marginTop={1}>
            <Text color={theme.info.color}>No memories found.</Text>
          </Box>
        )}
        {results.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.accent} bold>
              Results ({results.length})
            </Text>
            {results.map((r, i) => (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text color={theme.info.color} dimColor={false}>
                  #{i + 1} · {r.memory.category} · importance {r.memory.importance}
                </Text>
                <Text>
                  {r.memory.content.length > 120
                    ? r.memory.content.slice(0, 120) + "…"
                    : r.memory.content}
                </Text>
                <Text color={theme.info.color} dimColor={false}>
                  score: {r.combinedScore.toFixed(3)} · {new Date(r.memory.createdAt).toLocaleDateString()}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  const items = [
    { label: enabled ? "● Disable memory" : "● Enable memory", value: enabled ? "off" : "on", key: "toggle" },
    { label: "  Show memory stats", value: "stats", key: "stats" },
    { label: "  Clear all memories", value: "clear", key: "clear" },
    { label: "  Search memories…", value: "search", key: "search" },
    { label: "  (close)", value: "__close__", key: "close" },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Memory
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to close.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__close__") {
              onDone();
            } else if (item.value === "clear") {
              setScreen("confirm-clear");
            } else if (item.value === "search") {
              setScreen("search");
              setQuery("");
              setResults([]);
              setSearched(false);
            } else {
              onAction(item.value as string);
              onDone();
            }
          }}
        />
      </Box>
    </Box>
  );
}
