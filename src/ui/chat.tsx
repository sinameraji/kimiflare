import React from "react";
import { Box, Text } from "ink";
import { ToolView, type ToolEventState } from "./tool-view.js";
import type { Theme } from "./theme.js";

export type ChatEvent =
  | { kind: "user"; key: string; text: string }
  | {
      kind: "assistant";
      key: string;
      id: number;
      text: string;
      reasoning: string;
      streaming: boolean;
    }
  | ({ kind: "tool"; key: string } & ToolEventState)
  | { kind: "info"; key: string; text: string }
  | { kind: "error"; key: string; text: string };

interface Props {
  events: ChatEvent[];
  showReasoning: boolean;
  theme: Theme;
  verbose?: boolean;
}

export function ChatView({ events, showReasoning, theme, verbose }: Props) {
  return (
    <Box flexDirection="column">
      {events.map((e) => (
        <EventView key={e.key} evt={e} showReasoning={showReasoning} theme={theme} verbose={verbose} />
      ))}
    </Box>
  );
}

function EventView({ evt, showReasoning, theme, verbose }: { evt: ChatEvent; showReasoning: boolean; theme: Theme; verbose?: boolean }) {
  if (evt.kind === "user") {
    return (
      <Box marginY={0}>
        <Text color={theme.user}>› </Text>
        <Text>{evt.text}</Text>
      </Box>
    );
  }
  if (evt.kind === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        {showReasoning && evt.reasoning ? (
          <Box flexDirection="column" marginLeft={2}>
            <Text color={theme.reasoning.color} dimColor={theme.reasoning.dim}>
              ✧ thinking: {evt.reasoning.length > 400 ? evt.reasoning.slice(0, 400) + "…" : evt.reasoning}
            </Text>
          </Box>
        ) : null}
        {evt.text ? (
          theme.assistant ? <Text color={theme.assistant}>{evt.text}</Text> : <Text>{evt.text}</Text>
        ) : null}
      </Box>
    );
  }
  if (evt.kind === "tool") {
    return <ToolView evt={evt} verbose={verbose} />;
  }
  if (evt.kind === "info") {
    return (
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        {evt.text}
      </Text>
    );
  }
  return <Text color={theme.error}>! {evt.text}</Text>;
}
