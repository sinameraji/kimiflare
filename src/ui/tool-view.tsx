import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { DiffView } from "./diff-view.js";
import { collapsePathsInText } from "../util/paths.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

export interface ToolEventState {
  id: string;
  name: string;
  args: string;
  status: "running" | "done" | "error";
  result?: string;
  render?: { title: string; body?: string; diff?: { path: string; before: string; after: string } };
  expanded?: boolean;
  startedAt?: number;
}

interface Props {
  evt: ToolEventState;
  verbose?: boolean;
  isRepeated?: boolean;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 1) return "<1s";
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export const ToolView = React.memo(function ToolView({ evt, verbose, isRepeated }: Props) {
  const theme = useTheme();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (evt.startedAt === undefined) return;
    if (evt.status !== "running") {
      setNow(Date.now());
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [evt.status, evt.startedAt]);

  const statusIcon =
    evt.status === "running" ? (
      <Text color={theme.info.color} >
        <Spinner type="dots" />
      </Text>
    ) : evt.status === "error" ? (
      <Text color={theme.palette.error}>✗</Text>
    ) : (
      <Text color={theme.palette.success}>✓</Text>
    );
  let title = evt.render?.title ?? `${evt.name}(${compactArgs(evt.args)})`;
  if (evt.startedAt !== undefined) {
    title += ` · ${formatElapsed(now - evt.startedAt)}`;
  }
  const expand = Boolean(evt.expanded || verbose);
  const lines = evt.result ? evt.result.split("\n") : [];
  const showLimit = verbose ? 200 : 20;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        {statusIcon}{" "}
        <Text color={theme.info.color}>{title}</Text>
        {isRepeated ? (
          <Text color={theme.warn}> ⚠ repeated</Text>
        ) : null}
      </Text>
      {evt.render?.diff ? (
        <Box marginLeft={2}>
          <DiffView {...evt.render.diff} />
        </Box>
      ) : null}
      {evt.result && expand ? (
        <Box
          marginLeft={2}
          marginTop={1}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.info.color}
          paddingX={1}
        >
          {lines.slice(0, showLimit).map((l, i) => (
            <Text key={i} color={theme.info.color}>
              {l}
            </Text>
          ))}
          {lines.length > showLimit && (
            <Text color={theme.info.color}>
              … ({lines.length - showLimit} more lines)
            </Text>
          )}
        </Box>
      ) : null}
      {evt.result && !expand && evt.status !== "running" ? (
        <Text color={theme.info.color}>
          {"  "}{firstLine(evt.result)}
        </Text>
      ) : null}
    </Box>
  );
});

function compactArgs(raw: string): string {
  const collapsed = collapsePathsInText(raw, process.cwd());
  const s = collapsed.replace(/\s+/g, " ");
  return s.length <= 80 ? s : s.slice(0, 80) + "…";
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length <= 120 ? line : line.slice(0, 120) + "…";
}
