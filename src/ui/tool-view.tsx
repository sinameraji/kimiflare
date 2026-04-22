import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { DiffView } from "./diff-view.js";
import { collapsePathsInText } from "../util/paths.js";

export interface ToolEventState {
  id: string;
  name: string;
  args: string;
  status: "running" | "done" | "error";
  result?: string;
  render?: { title: string; body?: string; diff?: { path: string; before: string; after: string } };
  expanded?: boolean;
}

interface Props {
  evt: ToolEventState;
  verbose?: boolean;
}

export function ToolView({ evt, verbose }: Props) {
  const statusIcon =
    evt.status === "running" ? (
      <Text color="gray">
        <Spinner type="dots" />
      </Text>
    ) : evt.status === "error" ? (
      <Text color="red">✗</Text>
    ) : (
      <Text color="green">✓</Text>
    );
  const title = evt.render?.title ?? `${evt.name}(${compactArgs(evt.args)})`;
  const expand = Boolean(evt.expanded || verbose);
  const lines = evt.result ? evt.result.split("\n") : [];
  const showLimit = verbose ? 200 : 20;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        {statusIcon}{" "}
        <Text color="gray">{title}</Text>
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
          borderColor="gray"
          paddingX={1}
        >
          {lines.slice(0, showLimit).map((l, i) => (
            <Text key={i} color="gray" dimColor>
              {l}
            </Text>
          ))}
          {lines.length > showLimit && (
            <Text color="gray" dimColor>
              … ({lines.length - showLimit} more lines)
            </Text>
          )}
        </Box>
      ) : null}
      {evt.result && !expand && evt.status !== "running" ? (
        <Text color="gray" dimColor>
          {"  "}{firstLine(evt.result)}
        </Text>
      ) : null}
    </Box>
  );
}

function compactArgs(raw: string): string {
  const collapsed = collapsePathsInText(raw, process.cwd());
  const s = collapsed.replace(/\s+/g, " ");
  return s.length <= 80 ? s : s.slice(0, 80) + "…";
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length <= 120 ? line : line.slice(0, 120) + "…";
}
