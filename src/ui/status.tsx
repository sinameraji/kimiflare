import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Usage } from "../agent/messages.js";
import type { GatewayMeta } from "../agent/client.js";
import { useTheme } from "./theme-context.js";
import { useTerminal } from "./layout.js";
import type { Mode } from "../mode.js";
import { calculateCost } from "../pricing.js";
import type { DailyUsage } from "../usage-tracker.js";
import { humanizePhase, type IntentTier } from "./narrator.js";

export type TurnPhase = "generating" | "executing" | "waiting";

interface Props {
  usage: Usage | null;
  sessionUsage?: DailyUsage | null;
  thinking: boolean;
  turnStartedAt: number | null;
  mode: Mode;
  contextLimit: number;
  gatewayMeta?: GatewayMeta | null;
  codeMode?: boolean;
  cloudMode?: boolean;
  cloudBudget?: { remaining: number; limit: number } | null;
  skillsActive?: number;
  memoryRecalled?: boolean;
  phase?: TurnPhase;
  currentTool?: string | null;
  lastActivityAt?: number | null;
  kimiMdStale?: boolean;
  gitBranch?: string | null;
  intentTier?: IntentTier;
}

export function StatusBar({
  usage,
  sessionUsage,
  thinking,
  turnStartedAt,
  mode,
  contextLimit,
  gatewayMeta,
  codeMode,
  cloudMode,
  cloudBudget,
  skillsActive,
  memoryRecalled,
  phase,
  currentTool,
  lastActivityAt,
  kimiMdStale,
  gitBranch,
  intentTier,
}: Props) {
  const theme = useTheme();
  const { cols, truncate } = useTerminal();
  const [now, setNow] = useState(Date.now());

  const modeColor =
    mode === "plan"
      ? theme.modeBadge.plan
      : mode === "auto"
        ? theme.modeBadge.auto
        : theme.modeBadge.edit;

  useEffect(() => {
    if (!thinking || turnStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [thinking, turnStartedAt]);

  const elapsed =
    turnStartedAt !== null ? formatElapsed(now - turnStartedAt) : null;

  const phaseLabel =
    phase === "generating"
      ? humanizePhase("generating", intentTier)
      : phase === "executing"
        ? `${humanizePhase("executing", intentTier)} ${currentTool ?? ""}`
        : phase === "waiting"
          ? humanizePhase("waiting", intentTier)
          : humanizePhase("generating", intentTier);

  const idleMs = lastActivityAt && thinking ? now - lastActivityAt : 0;
  const idleLabel =
    idleMs > 30_000 ? ` (idle ${formatElapsed(Math.floor(idleMs / 1000))})` : "";

  // -- Left side: mode + status --
  const metaParts: string[] = [];
  if (skillsActive !== undefined && skillsActive > 0) {
    metaParts.push(`${skillsActive} skill${skillsActive === 1 ? "" : "s"}`);
  }
  if (memoryRecalled) metaParts.push("memory");

  const thinkingBody = metaParts.length > 0
    ? `${phaseLabel}${elapsed ? ` · ${elapsed}` : ""}${idleLabel} · ${metaParts.join(" · ")}`
    : `${phaseLabel}${elapsed ? ` · ${elapsed}` : ""}${idleLabel}`;

  const idleParts: string[] = [];
  if (gitBranch) idleParts.push(gitBranch);
  if (cloudMode) idleParts.push("CLOUD");
  if (codeMode) idleParts.push("CODE");

  const readyBody = idleParts.length > 0
    ? `${idleParts.join(" · ")} · ready`
    : "ready";

  // -- Right side: usage --
  let usageText = "";
  if (usage) {
    const parts = buildRightParts(
      usage,
      contextLimit,
      sessionUsage,
      gatewayMeta,
      cloudMode,
      cloudBudget,
    );
    usageText = parts.join("  ·  ");
  }
  if (kimiMdStale) usageText += `${usageText ? "  ·  " : ""}! KIMI.md stale`;

  // -- Assemble single line --
  const body = thinking ? thinkingBody : readyBody;
  const leftWidth = mode.length + 3 + body.length;
  const full = usageText
    ? `${mode}  ·  ${body}${" ".repeat(Math.max(1, cols - leftWidth - usageText.length - 3))}·  ${usageText}`
    : `${mode}  ·  ${body}`;

  const line = truncate(full, cols);

  return (
    <Box>
      <Text color={modeColor} bold>
        {line.slice(0, mode.length)}
      </Text>
      <Text>{line.slice(mode.length)}</Text>
    </Box>
  );
}

export function buildRightParts(
  usage: Usage,
  contextLimit: number,
  sessionUsage?: DailyUsage | null,
  gatewayMeta?: GatewayMeta | null,
  cloudMode?: boolean,
  cloudBudget?: { remaining: number; limit: number } | null,
): string[] {
  const pct = Math.round((usage.prompt_tokens / contextLimit) * 100);
  const parts: string[] = [];
  if (sessionUsage) {
    const cached = sessionUsage.cachedTokens;
    parts.push(
      `in ${sessionUsage.promptTokens}${cached ? ` (${cached} cached)` : ""}`,
    );
    parts.push(`ctx ${pct}%`);
    if (cloudMode) {
      parts.push(`\x1b[9m$${sessionUsage.cost.toFixed(2)}\x1b[29m`);
    } else {
      parts.push(`$${sessionUsage.cost.toFixed(2)}`);
    }
  } else {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const cost = calculateCost(
      usage.prompt_tokens,
      usage.completion_tokens,
      cached,
    );
    parts.push(`in ${usage.prompt_tokens}${cached ? ` (${cached} cached)` : ""}`);
    parts.push(`ctx ${pct}%`);
    if (cloudMode) {
      parts.push(`\x1b[9m$${cost.total.toFixed(2)}\x1b[29m`);
    } else {
      parts.push(`$${cost.total.toFixed(2)}`);
    }
  }
  if (cloudMode && cloudBudget) {
    parts.push(
      `${formatTokens(cloudBudget.remaining)}/${formatTokens(cloudBudget.limit)} tokens`,
    );
  }
  const gatewayCache = formatGatewayCacheStatus(gatewayMeta);
  if (gatewayCache) parts.push(gatewayCache);
  return parts;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatGatewayCacheStatus(
  gatewayMeta?: GatewayMeta | null,
): string | null {
  const status = gatewayMeta?.cacheStatus?.trim();
  return status ? `AI Gateway · cache ${status.toLowerCase()}` : null;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
