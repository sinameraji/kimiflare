import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Usage } from "../agent/messages.js";
import type { GatewayMeta } from "../agent/client.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
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
  /** Active model id (shown in status bar). */
  model?: string;
  gatewayMeta?: GatewayMeta | null;
  codeMode?: boolean;
  cloudMode?: boolean;
  cloudBudget?: { remaining: number; limit: number } | null;
  /** Number of skills active this turn */
  skillsActive?: number;
  /** Whether memory was recalled this turn */
  memoryRecalled?: boolean;
  phase?: TurnPhase;
  currentTool?: string | null;
  lastActivityAt?: number | null;
  kimiMdStale?: boolean;
  gitBranch?: string | null;
  intentTier?: IntentTier;
}

export function StatusBar({ usage, sessionUsage, thinking, turnStartedAt, mode, contextLimit, model, gatewayMeta, codeMode, cloudMode, cloudBudget, skillsActive, memoryRecalled, phase, currentTool, lastActivityAt, kimiMdStale, gitBranch, intentTier }: Props) {
  const theme = useTheme();
  const [now, setNow] = useState(Date.now());
  const modeColor =
    mode === "plan" ? theme.modeBadge.plan : mode === "auto" ? theme.modeBadge.auto : theme.modeBadge.edit;
  const warn = usage && usage.prompt_tokens / contextLimit >= 0.8;

  useEffect(() => {
    if (!thinking || turnStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [thinking, turnStartedAt]);

  const elapsed = turnStartedAt !== null ? formatElapsed(now - turnStartedAt) : null;

  const idleParts: string[] = [];
  if (gitBranch) idleParts.push(gitBranch);
  if (model) idleParts.push(shortenModelId(model));
  if (cloudMode) idleParts.push("CLOUD");
  if (codeMode) idleParts.push("CODE");

  const metaParts: string[] = [];
  if (skillsActive !== undefined && skillsActive > 0) {
    metaParts.push(`${skillsActive} skill${skillsActive === 1 ? "" : "s"}`);
  }
  if (memoryRecalled) {
    metaParts.push("memory");
  }

  const phaseLabel = phase === "generating"
    ? humanizePhase("generating", intentTier)
    : phase === "executing"
      ? `${humanizePhase("executing", intentTier)} ${currentTool ?? ""}`
      : phase === "waiting"
        ? humanizePhase("waiting", intentTier)
        : humanizePhase("generating", intentTier);
  const idleMs = lastActivityAt && thinking ? now - lastActivityAt : 0;
  const idleLabel = idleMs > 30_000 ? ` (idle ${formatElapsed(Math.floor(idleMs / 1000))})` : "";

  const thinkingText = metaParts.length > 0
    ? `${phaseLabel}${elapsed ? ` · ${elapsed}` : ""}${idleLabel} · ${metaParts.join(" · ")}`
    : `${phaseLabel}${elapsed ? ` · ${elapsed}` : ""}${idleLabel}`;

  const readyText = idleParts.length > 0
    ? `${idleParts.join(" · ")} · ready`
    : "ready";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={modeColor} bold>
          [{mode}]
        </Text>
        <Text> </Text>
        {thinking ? (
          <Text color={theme.spinner}>
            <Spinner type="dots2" />{" "}
            {thinkingText}
          </Text>
        ) : (
          <Text color={theme.info.color} >
            {readyText}
          </Text>
        )}
      </Box>
      {usage && (
        <Box>
          <Text color={theme.info.color} >
            {buildRightParts(usage, contextLimit, sessionUsage, gatewayMeta, cloudMode, cloudBudget, model).join("  ·  ")}
          </Text>
          {sessionUsage?.reconcilePending ? (
            <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
              {" "}
              <Spinner type="dots" />
            </Text>
          ) : null}
          {warn ? (
            <Text color={theme.warn} bold>
              {"  ·  "}/compact recommended
            </Text>
          ) : null}
          {kimiMdStale ? (
            <Text color={theme.warn} bold>
              {"  ·  "}⚠ KIMI.md stale · run /init
            </Text>
          ) : null}
        </Box>
      )}
      {!thinking && (
        <Box>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim}>
            tip: shift+tab cycles mode
          </Text>
        </Box>
      )}
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
  model?: string,
): string[] {
  const pct = Math.round((usage.prompt_tokens / contextLimit) * 100);
  const parts: string[] = [];
  if (sessionUsage) {
    const cached = sessionUsage.cachedTokens;
    parts.push(`in ${sessionUsage.promptTokens}${cached ? ` (${cached} cached)` : ""}`);
    parts.push(`ctx ${pct}%`);
    // ≈ prefix signals the cost is still the local estimate; once Gateway
    // reconciles the turn, the prefix and accompanying spinner go away.
    const prefix = sessionUsage.reconcilePending ? "≈$" : "$";
    if (cloudMode) {
      parts.push(`\x1b[9m${prefix}${sessionUsage.cost.toFixed(2)}\x1b[29m`);
    } else {
      parts.push(`${prefix}${sessionUsage.cost.toFixed(2)}`);
    }
    if (typeof sessionUsage.lastTurnMs === "number") {
      parts.push(formatDuration(sessionUsage.lastTurnMs));
    }
  } else {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    // Pass the current model so pricing.ts uses that provider's rates instead
    // of falling back to Kimi K2.6's hardcoded constants — otherwise an Opus
    // turn (\$15 in / \$75 out per Mtok) shows up as if it cost Kimi rates.
    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, cached, model);
    parts.push(`in ${usage.prompt_tokens}${cached ? ` (${cached} cached)` : ""}`);
    parts.push(`ctx ${pct}%`);
    if (cloudMode) {
      parts.push(`\x1b[9m$${cost.total.toFixed(2)}\x1b[29m`);
    } else {
      parts.push(`$${cost.total.toFixed(2)}`);
    }
  }
  if (cloudMode && cloudBudget) {
    parts.push(`${formatTokens(cloudBudget.remaining)}/${formatTokens(cloudBudget.limit)} tokens`);
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

export function formatGatewayCacheStatus(gatewayMeta?: GatewayMeta | null): string | null {
  const status = gatewayMeta?.cacheStatus?.trim();
  if (!status) return null;
  // Suppress "miss" — the gateway returns MISS on every uncached request,
  // including when caching isn't configured at all, so it'd otherwise read
  // like a constant failure. Hits (and other non-miss statuses like
  // REVALIDATED / BYPASS) are still surfaced — those are the useful signals.
  if (status.toUpperCase() === "MISS") return null;
  return `AI Gateway · cache ${status.toLowerCase()}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Shorten a model id for the status bar: drop the provider prefix and keep
 *  the recognizable tail. "@cf/moonshotai/kimi-k2.6" → "kimi-k2.6",
 *  "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6". */
export function shortenModelId(id: string): string {
  if (id.startsWith("@")) {
    const parts = id.split("/");
    return parts[parts.length - 1] ?? id;
  }
  const slash = id.indexOf("/");
  if (slash === -1) return id;
  return id.slice(slash + 1);
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
