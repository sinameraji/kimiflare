import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { ToolView, type ToolEventState } from "./tool-view.js";
import { MD } from "./markdown.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import { humanizeInfo, humanizeMemory, humanizeMeta, type IntentTier } from "./narrator.js";
import { CloudQuotaMessage } from "./cloud-quota-message.js";

export type ChatEvent =
  | { kind: "user"; key: string; text: string; images?: string[]; queued?: boolean; turnId?: number }
  | {
      kind: "assistant";
      key: string;
      id: number;
      text: string;
      reasoning: string;
      streaming: boolean;
      turnId?: number;
    }
  | ({ kind: "tool"; key: string; turnId?: number } & ToolEventState)
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

function toolSignature(name: string, args: string): string {
  return `${name}:${args}`;
}

// ── Turn grouping ────────────────────────────────────────────────────────────

interface TurnGroup {
  turnId: number;
  events: ChatEvent[];
  hasActive: boolean;
  reasoning: string;
}

export function groupByTurn(events: ChatEvent[]): TurnGroup[] {
  const map = new Map<number, ChatEvent[]>();
  const reasoningMap = new Map<number, string>();
  let ungroupedCounter = 0;

  for (const e of events) {
    const tid = e.kind === "user" || e.kind === "assistant" || e.kind === "tool" ? (e.turnId ?? -1) : -2;
    const key = tid === -2 ? --ungroupedCounter : tid;
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);

    if (e.kind === "assistant" && e.reasoning && tid >= 0) {
      reasoningMap.set(tid, (reasoningMap.get(tid) ?? "") + e.reasoning);
    }
  }

  const sorted = [...map.entries()].sort((a, b) => {
    const aKey = a[0];
    const bKey = b[0];
    if (aKey < 0 && bKey < 0) return bKey - aKey;
    if (aKey < 0) return 1;
    if (bKey < 0) return -1;
    return aKey - bKey;
  });

  return sorted.map(([turnId, evts]) => ({
    turnId: turnId < 0 && turnId !== -1 ? -1 : turnId,
    events: evts,
    hasActive: evts.some((e) => e.kind === "assistant" && e.streaming),
    reasoning: turnId >= 0 ? (reasoningMap.get(turnId) ?? "") : "",
  }));
}

// ── Diff aggregation ─────────────────────────────────────────────────────────

interface DiffSummary {
  files: number;
  added: number;
  removed: number;
}

export function aggregateDiffs(events: ChatEvent[]): DiffSummary | null {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;

  for (const e of events) {
    if (e.kind !== "tool" || !e.render?.diff) continue;
    const { path, before, after } = e.render.diff;
    files.add(path);

    const bLines = (before ?? "").split("\n");
    const aLines = (after ?? "").split("\n");
    const bCounts = new Map<string, number>();
    const aCounts = new Map<string, number>();

    for (const l of bLines) bCounts.set(l, (bCounts.get(l) ?? 0) + 1);
    for (const l of aLines) aCounts.set(l, (aCounts.get(l) ?? 0) + 1);

    for (const [line, bCount] of bCounts) {
      const aCount = aCounts.get(line) ?? 0;
      if (bCount > aCount) removed += bCount - aCount;
    }
    for (const [line, aCount] of aCounts) {
      const bCount = bCounts.get(line) ?? 0;
      if (aCount > bCount) added += aCount - bCount;
    }
  }

  if (files.size === 0) return null;
  return { files: files.size, added, removed };
}

// ── Reason block ─────────────────────────────────────────────────────────────

function ReasonBlock({
  reasoning,
  expanded,
}: {
  reasoning: string;
  expanded: boolean;
}) {
  const theme = useTheme();
  if (!expanded) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.reasoning.color}>
        thinking...{" "}
        {reasoning.length > 8000 ? reasoning.slice(0, 8000) + "..." : reasoning}
      </Text>
    </Box>
  );
}

// ── Diff summary ─────────────────────────────────────────────────────────────

function DiffSummaryLine({ summary }: { summary: DiffSummary }) {
  const theme = useTheme();
  return (
    <Box marginLeft={2} marginTop={1}>
      <Text color={theme.info.color}>
        {summary.files} {summary.files === 1 ? "file" : "files"} changed:{" "}
        <Text color={theme.palette.success}>+{summary.added}</Text>{" "}
        <Text color={theme.palette.error}>-{summary.removed}</Text>
      </Text>
    </Box>
  );
}

// ── Main ChatView ────────────────────────────────────────────────────────────

export const ChatView = React.memo(function ChatView({ events, showReasoning, verbose, intentTier }: Props) {
  const theme = useTheme();
  const groups = React.useMemo(() => groupByTurn(events), [events]);

  // Detect repetitive tool calls (>= 3 identical signatures)
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

  return (
    <Box flexDirection="column">
      {groups.map((group, gi) => {
        const isGrouped = group.turnId > 0;
        const isSecondGroupOnward = isGrouped && gi > 0;
        return (
          <Box key={`turn_${group.turnId}_${gi}`} flexDirection="column">
            {isSecondGroupOnward && (
              <Box marginY={1}>
                <Text color={theme.info.color}>
                  {"-".repeat(40)}
                </Text>
              </Box>
            )}
            <TurnGroupContent
              group={group}
              showReasoning={showReasoning}
              repeatedSigs={repeatedSigs}
              verbose={verbose}
              intentTier={intentTier}
            />
          </Box>
        );
      })}
    </Box>
  );
});

// ── TurnGroupContent ─────────────────────────────────────────────────────────

const TurnGroupContent = React.memo(function TurnGroupContent({
  group,
  showReasoning,
  repeatedSigs,
  verbose,
  intentTier,
}: {
  group: TurnGroup;
  showReasoning: boolean;
  repeatedSigs: Set<string>;
  verbose?: boolean;
  intentTier?: IntentTier;
}) {
  const theme = useTheme();
  const { turnId, events, hasActive, reasoning } = group;
  const isGrouped = turnId > 0;
  const [reasoningExpanded, setReasoningExpanded] = React.useState(false);
  const diffSummary = React.useMemo(() => aggregateDiffs(events), [events]);

  React.useEffect(() => {
    if (showReasoning && hasActive) setReasoningExpanded(true);
  }, [showReasoning, hasActive]);

  React.useEffect(() => {
    if (!showReasoning) setReasoningExpanded(false);
  }, [showReasoning]);

  return (
    <Box flexDirection="column">
      {events.map((e, i) => {
        const prev = events[i - 1];
        const showSeparator = !!(
          !isGrouped && e.kind === "user" && prev && (prev.kind === "assistant" || prev.kind === "tool")
        );
        return (
          <Box key={e.key} flexDirection="column">
            {showSeparator && (
              <Box marginY={1}>
                <Text color={theme.info.color}>
                  {"-".repeat(40)}
                </Text>
              </Box>
            )}
            <EventView evt={e} showReasoning={showReasoning} verbose={verbose} repeatedSigs={repeatedSigs} intentTier={intentTier} />
          </Box>
        );
      })}
      {isGrouped && diffSummary && (
        <DiffSummaryLine summary={diffSummary} />
      )}
      {isGrouped && reasoning && (
        <Box marginLeft={2} marginTop={1}>
          <ReasonBlock
            reasoning={reasoning}
            expanded={reasoningExpanded || showReasoning}
          />
        </Box>
      )}
    </Box>
  );
});

// ── EventView ────────────────────────────────────────────────────────────────

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
    if (evt.queued) {
      const mutedColor = theme.muted?.color ?? theme.info.color;
      return (
        <Box flexDirection="column">
          <Box>
            <Text italic color={mutedColor}>
              ...{" "}
            </Text>
            <Text italic color={mutedColor}>
              {evt.text}
            </Text>
            <Text italic color={mutedColor}>
              {" "}(queued)
            </Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={theme.user}>
            &gt;{" "}
          </Text>
          <Text bold>{evt.text}</Text>
        </Box>
        {evt.images && evt.images.length > 0 && (
          <Box paddingLeft={2}>
            <Text color={theme.info.color}>
              [img] {evt.images.join(", ")}
            </Text>
          </Box>
        )}
      </Box>
    );
  }
  if (evt.kind === "assistant") {
    return (
      <Box flexDirection="column" paddingLeft={2}>
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
      <Text color={theme.info.color}>
        . {humanizeInfo(evt.text, intentTier)}
      </Text>
    );
  }
  if (evt.kind === "memory") {
    return (
      <Text color={theme.info.color}>
        {humanizeMemory(evt.text, intentTier)}
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
