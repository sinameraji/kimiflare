/**
 * Terminal + JSON output for cost attribution reports.
 */

import type { CostAttributionReport, CategoryReportEntry, TaskCategory } from "./types.js";

function fmtCost(n: number): string {
  return n === 0 ? "$0.00" : `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function arrow(changePct: number): string {
  if (changePct > 5) return "↑";
  if (changePct < -5) return "↓";
  return "→";
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

function padLeft(str: string, width: number): string {
  return str.padStart(width).slice(-width);
}

function categoryLabel(cat: TaskCategory): string {
  return cat;
}

export function renderTerminal(report: CostAttributionReport): string {
  const lines: string[] = [];
  const catWidth = 22;
  const numWidth = 12;
  const arrWidth = 3;
  const totalWidth = catWidth + 1 + numWidth + 1 + numWidth + 1 + arrWidth;

  lines.push(`Period: ${report.period.start} → ${report.period.end}`);
  lines.push("");

  // Header
  lines.push(
    `${pad("Category", catWidth)} ${padLeft("This period", numWidth)} ${padLeft("Last period", numWidth)} ${pad("", arrWidth)}`,
  );
  lines.push("─".repeat(totalWidth));

  let totalThis = 0;
  let totalLast = 0;

  for (const entry of report.categories) {
    totalThis += entry.thisPeriod.cost;
    totalLast += entry.lastPeriod.cost;
    const label = pad(categoryLabel(entry.category), catWidth);
    const thisStr = padLeft(fmtCost(entry.thisPeriod.cost), numWidth);
    const lastStr = padLeft(fmtCost(entry.lastPeriod.cost), numWidth);
    const arr = pad(arrow(entry.changePct), arrWidth);
    lines.push(`${label} ${thisStr} ${lastStr} ${arr}`);
  }

  lines.push("─".repeat(totalWidth));
  lines.push(
    `${pad("Total", catWidth)} ${padLeft(fmtCost(totalThis), numWidth)} ${padLeft(fmtCost(totalLast), numWidth)} ${pad("", arrWidth)}`,
  );

  if (report.topSessions.length > 0) {
    lines.push("");
    lines.push("Top sessions this period:");
    for (const s of report.topSessions) {
      const day = new Date(s.date).toLocaleDateString("en-US", { weekday: "short" });
      const cat = s.category;
      const sum = s.summary ? ` — ${s.summary}` : "";
      lines.push(`  ${fmtCost(s.cost).padStart(6)}  ${day}  ${cat}${sum}`);
    }
  }

  // Agent metrics
  if (report.agentMetrics && report.agentMetrics.length > 0) {
    lines.push("");
    lines.push("Per-agent metrics:");
    const roleWidth = 12;
    const sessWidth = 6;
    const costWidth = 10;
    const tokWidth = 10;
    const latWidth = 10;
    const cacheWidth = 8;
    lines.push(
      `${pad("Role", roleWidth)} ${padLeft("Sess", sessWidth)} ${padLeft("Cost", costWidth)} ${padLeft("Tokens", tokWidth)} ${padLeft("Latency", latWidth)} ${padLeft("Cache", cacheWidth)}`,
    );
    lines.push("─".repeat(roleWidth + sessWidth + costWidth + tokWidth + latWidth + cacheWidth + 5));
    for (const m of report.agentMetrics) {
      const role = pad(m.role.slice(0, roleWidth), roleWidth);
      const sess = padLeft(String(m.sessions), sessWidth);
      const cost = padLeft(fmtCost(m.cost), costWidth);
      const tok = padLeft(fmtTokens(m.tokens), tokWidth);
      const lat = padLeft(m.avgLatencyMs ? `${m.avgLatencyMs}ms` : "—", latWidth);
      const cache = padLeft(m.cacheHitRatio ? `${(m.cacheHitRatio * 100).toFixed(0)}%` : "—", cacheWidth);
      lines.push(`${role} ${sess} ${cost} ${tok} ${lat} ${cache}`);
    }
  }

  // Reconciliation line
  lines.push("");
  const rec = report.reconciliation;
  switch (rec.status) {
    case "verified":
      lines.push(`Verified against Cloudflare: ✓ (within ${rec.driftPct?.toFixed(1) ?? "0"}%)`);
      break;
    case "drift":
      lines.push(`Verified against Cloudflare: ✗ (drift ${rec.driftPct?.toFixed(1) ?? "?"}%)`);
      break;
    case "error":
      lines.push(`Cloudflare reconciliation: ⚠ ${rec.message ?? "API error"}`);
      break;
    case "local-only":
      lines.push("Local-only report (Cloudflare reconciliation skipped).");
      break;
  }

  return lines.join("\n");
}

export function renderJson(report: CostAttributionReport): string {
  return JSON.stringify(report, null, 2);
}
