import React from "react";
import { Box, Text, Static } from "ink";
import Spinner from "ink-spinner";
import { ToolView, type ToolEventState } from "./tool-view.js";
import { MD } from "./markdown.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import { humanizeInfo, humanizeMemory, humanizeMeta, type IntentTier } from "./narrator.js";
import { CloudQuotaMessage } from "./cloud-quota-message.js";

export type ChatEvent =
  | { kind: "user"; key: string; text: string; images?: string[] }
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
  | { kind: "error"; key: string; text: string }
  | { kind: "memory"; key: string; text: string }
  | {
      kind: "meta";
      key: string;
      intentTier?: "light" | "medium" | "heavy";
      skillsActive?: number;
      memoryRecalled?: boolean;
    }
  | {
      kind: "cloud_quota_exhausted";
      key: string;
      used: number;
      limit: number;
      expiresAt: string;
    };

interface Props {
  events: ChatEvent[];
  showReasoning: boolean;
  verbose?: boolean;
  intentTier?: IntentTier;
}

interface StaticItem {
  id: string;
  evt: ChatEvent;
  showSeparator: boolean;
}

function toolSignature(name: string, args: string): string {
  return `${name}:${args}`;
}

export const ChatView = React.memo(function ChatView({ events, showReasoning, verbose, intentTier }: Props) {
  const theme = useTheme();
  const finalized: StaticItem[] = [];
  const active: ChatEvent[] = [];

  // Detect repetitive tool calls in this turn (≥3 identical signatures)
  const toolCounts = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool") {
      const sig = toolSignature(e.name, e.args);
      toolCounts.set(sig, (toolCounts.get(sig) ?? 0) + 1);
    }
  }
  const repeatedSigs = new Set<string>();
  for (const [sig, count] of toolCounts) {
    if (count >= 3) repeatedSigs.add(sig);
  }

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
                <Text color={theme.info.color} >
                  {"─".repeat(40)}
                </Text>
              </Box>
            )}
            <EventView evt={item.evt} showReasoning={showReasoning} verbose={verbose} repeatedSigs={repeatedSigs} intentTier={intentTier} />
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
                <Text color={theme.info.color} >
                  {"─".repeat(40)}
                </Text>
              </Box>
            )}
            <EventView evt={e} showReasoning={showReasoning} verbose={verbose} repeatedSigs={repeatedSigs} intentTier={intentTier} />
          </Box>
        );
      })}
    </Box>
  );
});

const EventView = React.memo(function EventView({
  evt,
  showReasoning,
  verbose,
  repeatedSigs,
  intentTier,
}: {
  evt: ChatEvent;
  showReasoning: boolean;
  verbose?: boolean;
  repeatedSigs?: Set<string>;
  intentTier?: IntentTier;
}) {
  const theme = useTheme();
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
            <Text color={theme.info.color} >
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
        {showReasoning && evt.reasoning ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.reasoning.color}>
              thinking…{" "}
              {evt.reasoning.length > 400 ? evt.reasoning.slice(0, 400) + "…" : evt.reasoning}
            </Text>
          </Box>
        ) : null}
        {evt.text ? <MD text={evt.text} /> : null}
        {evt.streaming && (
          <Text color={theme.spinner}>
            <Spinner type="dots" />
          </Text>
        )}
      </Box>
    );
  }
  if (evt.kind === "tool") {
    const isRepeated = repeatedSigs?.has(toolSignature(evt.name, evt.args)) ?? false;
    return <ToolView evt={evt} verbose={verbose} isRepeated={isRepeated} intentTier={intentTier} />;
  }
  if (evt.kind === "info") {
    return (
      <Text color={theme.info.color} >
        · {humanizeInfo(evt.text, intentTier)}
      </Text>
    );
  }
  if (evt.kind === "memory") {
    return (
      <Text color={theme.info.color} >
        ◈ {humanizeMemory(evt.text, intentTier)}
      </Text>
    );
  }
  if (evt.kind === "cloud_quota_exhausted") {
    return (
      <CloudQuotaMessage
        used={evt.used}
        limit={evt.limit}
        expiresAt={evt.expiresAt}
      />
    );
  }
  if (evt.kind === "meta") {
    const metaParts: { label: string; value?: string | number }[] = [];
    if (evt.skillsActive !== undefined && evt.skillsActive > 0) {
      metaParts.push({ label: `skill${evt.skillsActive === 1 ? "" : "s"} ready`, value: evt.skillsActive });
    }
    if (evt.memoryRecalled) {
      metaParts.push({ label: "memory recalled" });
    }
    const metaText = humanizeMeta(metaParts, intentTier ?? evt.intentTier);
    if (!metaText) return null;
    return (
      <Text color={theme.info.color} dimColor>
        {metaText}
      </Text>
    );
  }
  return (
    <Text color={theme.error}>
      ! {evt.text}
    </Text>
  );
});
