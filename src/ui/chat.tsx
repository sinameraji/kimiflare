import React from "react";
import { Box, Text, Static } from "ink";
import Spinner from "ink-spinner";
import { ToolView, type ToolEventState } from "./tool-view.js";
import { MD } from "./markdown.js";
import type { Theme } from "./theme.js";

export type ChatEvent =
  | { kind: "user"; key: string; text: string; images?: string[] }
  | {
      kind: "assistant";
      key: string;
      id: number;
      text: string;
      reasoning: string;
      streaming: boolean;
      /** Agent role that produced this message (e.g., "research", "coding"). */
      agentRole?: string;
    }
  | ({ kind: "tool"; key: string } & ToolEventState)
  | { kind: "info"; key: string; text: string }
  | { kind: "error"; key: string; text: string }
  | { kind: "memory"; key: string; text: string };

interface Props {
  events: ChatEvent[];
  showReasoning: boolean;
  theme: Theme;
  verbose?: boolean;
}

interface StaticItem {
  id: string;
  evt: ChatEvent;
  showSeparator: boolean;
}

export const ChatView = React.memo(function ChatView({ events, showReasoning, theme, verbose }: Props) {
  const finalized: StaticItem[] = [];
  const active: ChatEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const isStreaming = e.kind === "assistant" && e.streaming;
    if (isStreaming) {
      active.push(e);
    } else {
      const prev = events[i - 1];
      const showSeparator = !!(
        e.kind === "user" && prev && (prev.kind === "assistant" || prev.kind === "tool")
      );
      finalized.push({ id: e.key, evt: e, showSeparator });
    }
  }

  return (
    <Box flexDirection="column">
      <Static items={finalized}>
        {(item) => (
          <Box key={item.id} flexDirection="column">
            {item.showSeparator && (
              <Box marginY={1}>
                <Text color={theme.info.color} dimColor={theme.info.dim}>
                  {"─".repeat(40)}
                </Text>
              </Box>
            )}
            <EventView evt={item.evt} showReasoning={showReasoning} theme={theme} verbose={verbose} />
          </Box>
        )}
      </Static>
      {active.map((e, i) => {
        const prevEvt = i > 0 ? active[i - 1] : finalized[finalized.length - 1]?.evt;
        const showSeparator =
          e.kind === "user" && prevEvt && (prevEvt.kind === "assistant" || prevEvt.kind === "tool");
        return (
          <Box key={e.key} flexDirection="column">
            {showSeparator && (
              <Box marginY={1}>
                <Text color={theme.info.color} dimColor={theme.info.dim}>
                  {"─".repeat(40)}
                </Text>
              </Box>
            )}
            <EventView evt={e} showReasoning={showReasoning} theme={theme} verbose={verbose} />
          </Box>
        );
      })}
    </Box>
  );
});

const EventView = React.memo(function EventView({
  evt,
  showReasoning,
  theme,
  verbose,
}: {
  evt: ChatEvent;
  showReasoning: boolean;
  theme: Theme;
  verbose?: boolean;
}) {
  if (evt.kind === "user") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={theme.user}>
            ›{" "}
          </Text>
          <Text bold>{evt.text}</Text>
        </Box>
        {evt.images && evt.images.length > 0 && (
          <Box paddingLeft={2}>
            <Text color={theme.info.color} dimColor={theme.info.dim}>
              🖼️ {evt.images.join(", ")}
            </Text>
          </Box>
        )}
      </Box>
    );
  }
  if (evt.kind === "assistant") {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {evt.agentRole && (
          <Box marginBottom={1}>
            <Text color={theme.info.color} dimColor={theme.info.dim}>
              ◆ {evt.agentRole} agent
            </Text>
          </Box>
        )}
        {showReasoning && evt.reasoning ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.reasoning.color} dimColor={theme.reasoning.dim}>
              thinking…{" "}
              {evt.reasoning.length > 400 ? evt.reasoning.slice(0, 400) + "…" : evt.reasoning}
            </Text>
          </Box>
        ) : null}
        {evt.text ? <MD text={evt.text} theme={theme} streaming={evt.streaming} /> : null}
        {evt.streaming && (
          <Text color={theme.spinner}>
            <Spinner type="dots" />
          </Text>
        )}
      </Box>
    );
  }
  if (evt.kind === "tool") {
    return <ToolView evt={evt} verbose={verbose} />;
  }
  if (evt.kind === "info") {
    return (
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        · {evt.text}
      </Text>
    );
  }
  if (evt.kind === "memory") {
    return (
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        ◈ {evt.text}
      </Text>
    );
  }
  return (
    <Text color={theme.error}>
      ! {evt.text}
    </Text>
  );
});
