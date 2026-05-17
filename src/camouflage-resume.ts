/**
 * `kimiflare resume` — first real-world driver of Camouflage's SelectList
 * primitive (CC-1). Lists recent sessions in the current cwd and renders
 * them via Camouflage's SelectList overlay. Prints the chosen session id
 * to stdout. Actual resume semantics (loading the chosen session into a
 * new agent run) is intentionally not wired here — that's KimiFlare-
 * specific and will land in a follow-up. This subcommand validates the
 * round-trip end-to-end against real session data.
 */

import { mount, selectList } from "camouflage";
import { listSessions, type SessionSummary } from "./sessions.js";

export interface CamouflageResumeOpts {
  limit?: number;
  camouflageBin?: string;
}

export async function runCamouflageResume(opts: CamouflageResumeOpts = {}): Promise<void> {
  const sessions = await listSessions(opts.limit ?? 20, process.cwd());

  if (sessions.length === 0) {
    process.stderr.write("kimiflare resume: no saved sessions for this cwd.\n");
    process.exitCode = 0;
    return;
  }

  let cam;
  try {
    cam = await mount({
      bin: opts.camouflageBin,
      renderToTerminal: true,
    });
  } catch (err) {
    process.stderr.write(
      `kimiflare resume: failed to launch Camouflage renderer.\n${err instanceof Error ? err.message : err}\n`,
    );
    process.exitCode = 2;
    return;
  }

  // Seed a minimal session so the picker isn't floating on an empty
  // transcript. Skip the StatusUpdate cosmetics — the SelectList is the
  // entire UI here.
  cam.send("SessionStarted", {});

  const resp = await selectList(cam, {
    id: "resume-picker",
    prompt: `Resume which session? (${sessions.length} found in ${process.cwd()})`,
    options: sessions.map((s: SessionSummary) => ({
      value: s.id,
      label: optionLabel(s),
      description: `${s.messageCount} msgs · ${s.id.slice(0, 8)}`,
    })),
    allow_filter: true,
    allow_cancel: true,
  });

  cam.send("SessionEnded", {});
  await cam.close().catch(() => {});

  // Final output goes to stdout so it can be captured / piped.
  if (resp.cancelled) {
    process.stdout.write("cancelled\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`${resp.value}\n`);
  }
}

function optionLabel(s: SessionSummary): string {
  const when = formatRelative(s.updatedAt);
  const title = (s.title ?? s.firstPrompt ?? "(no title)").trim().replace(/\s+/g, " ");
  const truncated = title.length > 80 ? `${title.slice(0, 77)}…` : title;
  return `${when}  ${truncated}`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMin = (Date.now() - t) / 60_000;
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${Math.round(diffMin)}m ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / (60 * 24))}d ago`;
}
