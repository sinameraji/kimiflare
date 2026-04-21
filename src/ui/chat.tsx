import React from "react";
import { Box, Text } from "ink";
import { ToolView, type ToolEventState } from "./tool-view.js";

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
}

export function ChatView({ events, showReasoning }: Props) {
  return (
    <Box flexDirection="column">
      {events.map((e) => (
        <EventView key={e.key} evt={e} showReasoning={showReasoning} />
      ))}
    </Box>
  );
}

function EventView({ evt, showReasoning }: { evt: ChatEvent; showReasoning: boolean }) {
  if (evt.kind === "user") {
    return (
      <Box marginY={0}>
        <Text color="cyan">› </Text>
        <Text>{evt.text}</Text>
      </Box>
    );
  }
  if (evt.kind === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        {showReasoning && evt.reasoning ? (
          <Box flexDirection="column" marginLeft={2}>
            <Text color="gray" dimColor>
              ✧ thinking: {evt.reasoning.length > 400 ? evt.reasoning.slice(0, 400) + "…" : evt.reasoning}
            </Text>
          </Box>
        ) : null}
        {evt.text ? <Text>{evt.text}</Text> : null}
      </Box>
    );
  }
  if (evt.kind === "tool") {
    return <ToolView evt={evt} />;
  }
  if (evt.kind === "info") {
    return (
      <Text color="gray" dimColor>
        {evt.text}
      </Text>
    );
  }
  return <Text color="red">! {evt.text}</Text>;
}
