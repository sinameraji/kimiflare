import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { DiffView } from "./diff-view.js";

export interface ToolEventState {
  id: string;
  name: string;
  args: string;
  status: "running" | "done" | "error";
  result?: string;
  render?: { title: string; body?: string; diff?: { path: string; before: string; after: string } };
  expanded?: boolean;
}

export function ToolView({ evt }: { evt: ToolEventState }) {
  const statusIcon =
    evt.status === "running" ? <Spinner type="dots" /> : evt.status === "error" ? <Text color="red">✗</Text> : <Text color="green">✓</Text>;
  const title = evt.render?.title ?? `${evt.name}(${compactArgs(evt.args)})`;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        {statusIcon} <Text color="magenta">{title}</Text>
      </Text>
      {evt.render?.diff ? (
        <Box marginLeft={2}>
          <DiffView {...evt.render.diff} />
        </Box>
      ) : null}
      {evt.result && evt.expanded ? (
        <Box marginLeft={2} flexDirection="column">
          {evt.result.split("\n").slice(0, 20).map((l, i) => (
            <Text key={i} color="gray">{l}</Text>
          ))}
          {evt.result.split("\n").length > 20 && (
            <Text color="gray">... ({evt.result.split("\n").length - 20} more lines)</Text>
          )}
        </Box>
      ) : null}
      {evt.result && !evt.expanded && evt.status !== "running" ? (
        <Text color="gray">  {firstLine(evt.result)}</Text>
      ) : null}
    </Box>
  );
}

function compactArgs(raw: string): string {
  const s = raw.replace(/\s+/g, " ");
  return s.length <= 80 ? s : s.slice(0, 80) + "…";
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length <= 120 ? line : line.slice(0, 120) + "…";
}
